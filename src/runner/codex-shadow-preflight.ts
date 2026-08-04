import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { CodexProcessRunner } from "./codex-process-runner.js";
import type { SupportAutopilotShadowRunnerConfig } from "./support-autopilot-shadow-runner.config.js";

type EnabledConfig = Extract<SupportAutopilotShadowRunnerConfig, { enabled: true }>;

const SMOKE_PROMPT = [
  "Use only the support-autopilot MCP server.",
  "Call get_support_automation_health exactly once, do not call any other tool, then stop.",
  "Do not repeat or summarize the tool result.",
].join(" ");

export const CODEX_RESTRICTED_EXEC_ARGS = [
  "--disable", "shell_tool",
  "--disable", "web_search_request",
  "--disable", "code_mode",
  "--disable", "apps",
  "--disable", "plugins",
  "--disable", "multi_agent",
  "exec",
  "--ephemeral",
  "--json",
  "--sandbox", "read-only",
  "--skip-git-repo-check",
  "--color", "never",
] as const;

export class CodexShadowPreflight {
  constructor(
    private readonly config: EnabledConfig,
    private readonly processRunner: CodexProcessRunner,
  ) {}

  async run(now = new Date()): Promise<{ outcome: "ready" }> {
    try {
      await this.assertFilesystem();
      await this.assertPrivacyAttestation(now);
      await this.assertVersion();
      await this.assertChatGptLogin();
      await this.assertMcpAllowlist();
      await this.assertSmoke();
      return { outcome: "ready" };
    } catch {
      throw new Error("SUPPORT_AUTOPILOT_PREFLIGHT_FAILED");
    }
  }

  private async assertFilesystem(): Promise<void> {
    if (this.config.codexExecutablePath.toLowerCase().includes("\\windowsapps\\")) {
      throw new Error("app-bundled cli");
    }
    const [codex, node, launcher, credential, runtime, home] = await Promise.all([
      stat(this.config.codexExecutablePath),
      stat(this.config.nodeExecutablePath),
      stat(this.config.mcpLauncherPath),
      stat(this.config.credentialBlobPath),
      stat(this.config.runtimeDir),
      stat(this.config.codexHome),
    ]);
    if (
      !codex.isFile()
      || !node.isFile()
      || !launcher.isFile()
      || !credential.isFile()
      || !runtime.isDirectory()
      || !home.isDirectory()
      || (await readdir(this.config.runtimeDir)).length !== 0
    ) {
      throw new Error("invalid runner filesystem");
    }
  }

  private async assertPrivacyAttestation(now: Date): Promise<void> {
    const raw = await readFile(this.config.privacyAttestationPath, "utf8");
    const value: unknown = JSON.parse(raw);
    if (!this.isRecord(value)) {
      throw new Error("invalid attestation");
    }
    const keys = Object.keys(value).sort();
    const expected = [
      "attestationId",
      "dataControlsApproved",
      "expiresAt",
      "modelTrainingDisabled",
      "privacyGateApproved",
      "workspaceType",
    ].sort();
    const expiry = typeof value.expiresAt === "string" ? new Date(value.expiresAt) : null;
    const workspace = value.workspaceType;
    const workspaceApproved = workspace === "business"
      || workspace === "enterprise"
      || workspace === "edu"
      || ((workspace === "plus" || workspace === "pro") && value.modelTrainingDisabled === true);
    if (
      keys.length !== expected.length
      || !keys.every((key, index) => key === expected[index])
      || value.attestationId !== this.config.privacyAttestationId
      || value.expiresAt !== this.config.privacyAttestationExpiresAt
      || !expiry
      || Number.isNaN(expiry.getTime())
      || expiry.toISOString() !== value.expiresAt
      || expiry.getTime() <= now.getTime()
      || value.dataControlsApproved !== true
      || value.privacyGateApproved !== true
      || typeof value.modelTrainingDisabled !== "boolean"
      || !workspaceApproved
    ) {
      throw new Error("invalid attestation");
    }
  }

  private async assertVersion(): Promise<void> {
    const result = await this.runCommand(["--version"], 64 * 1024);
    if (!/^codex-cli \d+\.\d+\.\d+(?:[-+][^\r\n]+)?$/.test(result.stdout.trim())) {
      throw new Error("invalid version");
    }
  }

  private async assertChatGptLogin(): Promise<void> {
    const result = await this.runCommand(["login", "status"], 64 * 1024);
    if (result.stdout.trim() !== "Logged in using ChatGPT") {
      throw new Error("invalid auth");
    }
  }

  private async assertMcpAllowlist(): Promise<void> {
    const result = await this.runCommand(["mcp", "list", "--json"], 256 * 1024);
    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed) || parsed.length !== 1 || !this.isRecord(parsed[0])) {
      throw new Error("invalid mcp allowlist");
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
      || !this.sameWindowsPath(transport.args[0], this.config.mcpLauncherPath)
      || !(transport.cwd === null || transport.cwd === undefined)
      || !(transport.env === null || (this.isRecord(transport.env) && Object.keys(transport.env).length === 0))
      || !(transport.env_vars === undefined || (Array.isArray(transport.env_vars) && transport.env_vars.length === 0))
    ) {
      throw new Error("invalid mcp allowlist");
    }
  }

  private async assertSmoke(): Promise<void> {
    const result = await this.runCommand([
      ...CODEX_RESTRICTED_EXEC_ARGS,
      "--cd", this.config.runtimeDir,
      "-",
    ], 1024 * 1024, SMOKE_PROMPT);
    const lines = result.stdout.split(/\r?\n/).filter(Boolean);
    let healthCalls = 0;
    for (const line of lines) {
      const event: unknown = JSON.parse(line);
      if (!this.isRecord(event) || !this.isRecord(event.item)) {
        continue;
      }
      const item = event.item;
      if (
        event.type === "item.completed"
        && item.type === "mcp_tool_call"
        && item.server === "support-autopilot"
        && item.tool === "get_support_automation_health"
        && item.status === "completed"
        && (item.error === null || item.error === undefined)
      ) {
        healthCalls += 1;
      } else if (item.type === "mcp_tool_call") {
        throw new Error("unexpected smoke tool");
      }
    }
    if (healthCalls !== 1) {
      throw new Error("health smoke missing");
    }
  }

  private async runCommand(args: string[], maximumBytes: number, stdin?: string) {
    const result = await this.processRunner.run({
      args,
      cwd: this.config.runtimeDir,
      environment: createCodexChildEnvironment(this.config),
      executablePath: this.config.codexExecutablePath,
      maxOutputBytes: maximumBytes,
      stdin,
      timeoutMs: Math.min(this.config.processTimeoutMs, 120_000),
    });
    if (result.exitCode !== 0 || result.timedOut) {
      throw new Error("codex command failed");
    }
    return result;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private sameWindowsPath(value: unknown, expected: string): boolean {
    return typeof value === "string"
      && path.win32.normalize(value).toLowerCase() === path.win32.normalize(expected).toLowerCase();
  }
}

export function createCodexChildEnvironment(config: EnabledConfig): NodeJS.ProcessEnv {
  return {
    ADMIN_API_BASE_URL: config.adminApiBaseUrl,
    APPDATA: process.env.APPDATA,
    CODEX_HOME: config.codexHome,
    ComSpec: process.env.ComSpec,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: config.credentialBlobPath,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE,
    WINDIR: process.env.WINDIR,
  };
}
