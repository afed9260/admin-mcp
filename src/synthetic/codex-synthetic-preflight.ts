import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { CodexProcessRunner, CodexProcessResult } from "../runner/codex-process-runner.js";
import type { SupportAutopilotSyntheticCanaryConfig } from "./support-autopilot-synthetic-canary.config.js";

type EnabledConfig = Extract<SupportAutopilotSyntheticCanaryConfig, { enabled: true }>;

export class CodexSyntheticPreflight {
  constructor(
    private readonly config: EnabledConfig,
    private readonly processRunner: CodexProcessRunner,
  ) {}

  async run(): Promise<{ outcome: "ready" }> {
    try {
      await this.assertFilesystem();
      await this.assertVersion();
      await this.assertChatGptLogin();
      await this.assertMcpAllowlist();
      return { outcome: "ready" };
    } catch {
      throw new Error("SUPPORT_AUTOPILOT_SYNTHETIC_PREFLIGHT_FAILED");
    }
  }

  private async assertFilesystem(): Promise<void> {
    const [codex, node, mcpEntry, runtime, home] = await Promise.all([
      stat(this.config.codexExecutablePath),
      stat(this.config.nodeExecutablePath),
      stat(this.config.mcpEntryPath),
      stat(this.config.runtimeDir),
      stat(this.config.codexHome),
    ]);
    if (
      !codex.isFile()
      || !node.isFile()
      || !mcpEntry.isFile()
      || !runtime.isDirectory()
      || !home.isDirectory()
      || (await readdir(this.config.runtimeDir)).length !== 0
    ) {
      throw new Error("invalid synthetic filesystem");
    }
  }

  private async assertVersion(): Promise<void> {
    const result = await this.runCommand(["--version"], 64 * 1024);
    if (!/^codex-cli \d+\.\d+\.\d+(?:[-+][^\r\n]+)?$/.test(this.singleOutput(result))) {
      throw new Error("invalid version");
    }
  }

  private async assertChatGptLogin(): Promise<void> {
    const result = await this.runCommand(["login", "status"], 64 * 1024);
    if (this.singleOutput(result) !== "Logged in using ChatGPT") {
      throw new Error("invalid auth");
    }
  }

  private async assertMcpAllowlist(): Promise<void> {
    const result = await this.runCommand(["mcp", "list", "--json"], 256 * 1024);
    const parsed: unknown = JSON.parse(this.singleOutput(result));
    if (!Array.isArray(parsed) || parsed.length !== 1 || !this.isRecord(parsed[0])) {
      throw new Error("invalid MCP allowlist");
    }
    const server = parsed[0];
    const transport = server.transport;
    if (
      server.name !== "support-autopilot"
      || server.enabled !== true
      || !this.isRecord(transport)
      || transport.type !== "stdio"
      || !this.sameWindowsPath(transport.command, this.config.nodeExecutablePath)
      || !Array.isArray(transport.args)
      || transport.args.length !== 1
      || !this.sameWindowsPath(transport.args[0], this.config.mcpEntryPath)
      || !(transport.cwd === null || transport.cwd === undefined)
      || !(transport.env === null || (this.isRecord(transport.env) && Object.keys(transport.env).length === 0))
      || !(transport.env_vars === undefined || (Array.isArray(transport.env_vars) && transport.env_vars.length === 0))
    ) {
      throw new Error("invalid MCP allowlist");
    }
  }

  private async runCommand(args: string[], maximumBytes: number): Promise<CodexProcessResult> {
    const result = await this.processRunner.run({
      args,
      cwd: this.config.runtimeDir,
      environment: createSyntheticCodexChildEnvironment(this.config),
      executablePath: this.config.codexExecutablePath,
      maxOutputBytes: maximumBytes,
      timeoutMs: Math.min(this.config.processTimeoutMs, 120_000),
    });
    if (result.exitCode !== 0 || result.timedOut) {
      throw new Error("Codex command failed");
    }
    return result;
  }

  private singleOutput(result: CodexProcessResult): string {
    const stdout = result.stdout.trim();
    const stderr = result.stderr.trim();
    if ((stdout && stderr) || (!stdout && !stderr)) {
      throw new Error("ambiguous Codex output");
    }
    return stdout || stderr;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private sameWindowsPath(value: unknown, expected: string): boolean {
    return typeof value === "string"
      && path.win32.normalize(value).toLowerCase() === path.win32.normalize(expected).toLowerCase();
  }
}

export function createSyntheticCodexChildEnvironment(config: EnabledConfig): NodeJS.ProcessEnv {
  return {
    APPDATA: process.env.APPDATA,
    CODEX_HOME: config.codexHome,
    ComSpec: process.env.ComSpec,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
    WINDIR: process.env.WINDIR,
  };
}
