import { readdir, readFile, stat } from "node:fs/promises";
import {
  readSingleCodexCommandOutput,
  type CodexProcessRunner,
} from "./codex-process-runner.js";
import {
  assertChatGptLoginOutput,
  assertCodexVersionOutput,
  assertSupportAutopilotMcpProfile,
} from "./codex-profile-validation.js";
import { assertSupportPrivacyAttestation } from "./support-privacy-attestation.js";
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
  "--config", "mcp_servers.support-autopilot.default_tools_approval_mode=\"approve\"",
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
    assertSupportPrivacyAttestation(raw, {
      attestationId: this.config.privacyAttestationId,
      expiresAt: this.config.privacyAttestationExpiresAt,
    }, now);
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
      environment: {
        adminApiBaseUrl: this.config.adminApiBaseUrl,
        credentialBlobPath: this.config.credentialBlobPath,
      },
      mcpEntryPath: this.config.mcpLauncherPath,
      nodeExecutablePath: this.config.nodeExecutablePath,
    });
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
      if (item.type !== "mcp_tool_call") {
        continue;
      }
      if (
        item.server !== "support-autopilot"
        || item.tool !== "get_support_automation_health"
        || !(item.error === null || item.error === undefined)
      ) {
        throw new Error("unexpected smoke tool");
      }
      if (event.type === "item.started" && item.status === "in_progress") {
        continue;
      }
      if (event.type === "item.completed" && item.status === "completed") {
        healthCalls += 1;
        continue;
      }
      throw new Error("unexpected smoke tool");
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
