import { readdir, stat } from "node:fs/promises";
import {
  readSingleCodexCommandOutput,
  type CodexProcessRunner,
  type CodexProcessResult,
} from "../runner/codex-process-runner.js";
import {
  assertChatGptLoginOutput,
  assertCodexVersionOutput,
  assertSupportAutopilotMcpProfile,
} from "../runner/codex-profile-validation.js";
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
    assertCodexVersionOutput(readSingleCodexCommandOutput(result));
  }

  private async assertChatGptLogin(): Promise<void> {
    const result = await this.runCommand(["login", "status"], 64 * 1024);
    assertChatGptLoginOutput(readSingleCodexCommandOutput(result));
  }

  private async assertMcpAllowlist(): Promise<void> {
    const result = await this.runCommand(["mcp", "list", "--json"], 256 * 1024);
    assertSupportAutopilotMcpProfile(readSingleCodexCommandOutput(result), {
      mcpEntryPath: this.config.mcpEntryPath,
      nodeExecutablePath: this.config.nodeExecutablePath,
    });
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
