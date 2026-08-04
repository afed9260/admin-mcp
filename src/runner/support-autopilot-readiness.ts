import { readFile, readdir, stat } from "node:fs/promises";
import {
  assertChatGptLoginOutput,
  assertCodexVersionOutput,
  assertSupportAutopilotMcpProfile,
} from "./codex-profile-validation.js";
import {
  readSingleCodexCommandOutput,
  type CodexProcessResult,
  type CodexProcessRunner,
} from "./codex-process-runner.js";
import type { SupportAutopilotReadinessConfig } from "./support-autopilot-readiness.config.js";
import { assertSupportPrivacyAttestation } from "./support-privacy-attestation.js";

export type SupportAutopilotReadinessCheckId =
  | "codex_cli"
  | "codex_login"
  | "mcp_profile"
  | "runtime"
  | "credential_blob"
  | "privacy_attestation";

export interface SupportAutopilotReadinessReport {
  blockers: string[];
  checks: Array<{
    id: SupportAutopilotReadinessCheckId;
    status: "blocked" | "ready";
  }>;
  outcome: "blocked" | "ready";
}

interface ReadinessFileSystem {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
}

const CHECK_ORDER: SupportAutopilotReadinessCheckId[] = [
  "codex_cli",
  "codex_login",
  "mcp_profile",
  "runtime",
  "credential_blob",
  "privacy_attestation",
];

const defaultFileSystem: ReadinessFileSystem = {
  readFile: (filePath, encoding) => readFile(filePath, encoding),
  readdir: (directoryPath) => readdir(directoryPath),
  stat: (filePath) => stat(filePath),
};

export class SupportAutopilotReadinessDoctor {
  constructor(
    private readonly config: SupportAutopilotReadinessConfig,
    private readonly processRunner: CodexProcessRunner,
    private readonly fileSystem: ReadinessFileSystem = defaultFileSystem,
  ) {}

  async run(now = new Date()): Promise<SupportAutopilotReadinessReport> {
    const blockers = new Set(this.config.configurationBlockers);
    const statuses = new Map<SupportAutopilotReadinessCheckId, "blocked" | "ready">(
      CHECK_ORDER.map((id) => [id, "blocked"]),
    );

    const runtimeReady = await this.checkRuntime(blockers);
    if (runtimeReady) {
      statuses.set("runtime", "ready");
    }
    if (await this.checkCredentialBlob(blockers)) {
      statuses.set("credential_blob", "ready");
    }
    if (await this.checkPrivacyAttestation(blockers, now)) {
      statuses.set("privacy_attestation", "ready");
    }

    const codexExecutableReady = await this.checkFile(
      this.config.codexExecutablePath,
      ["codex_executable_"],
      "codex_executable_unavailable",
      blockers,
    );
    const nodeExecutableReady = await this.checkFile(
      this.config.nodeExecutablePath,
      ["node_executable_"],
      "node_executable_unavailable",
      blockers,
    );
    const mcpLauncherReady = await this.checkFile(
      this.config.mcpLauncherPath,
      ["mcp_launcher_"],
      "mcp_launcher_unavailable",
      blockers,
    );

    if (!this.config.plaintextTokenPresent) {
      const processConfigReady = !this.hasConfigurationBlocker([
        "codex_executable_",
        "codex_home_",
        "process_timeout_",
        "runtime_",
      ]);
      const codexReady = codexExecutableReady
        && runtimeReady
        && processConfigReady
        && await this.checkCodexVersion(blockers);
      if (codexReady) {
        statuses.set("codex_cli", "ready");
      } else if (!codexExecutableReady || !runtimeReady || !processConfigReady) {
        blockers.add("codex_cli_prerequisite_blocked");
      }

      if (codexReady) {
        if (await this.checkCodexLogin(blockers)) {
          statuses.set("codex_login", "ready");
        }
      } else {
        blockers.add("codex_login_prerequisite_blocked");
      }

      const mcpConfigReady = !this.hasConfigurationBlocker([
        "mcp_launcher_",
        "node_executable_",
      ]);
      if (codexReady && nodeExecutableReady && mcpLauncherReady && mcpConfigReady) {
        if (await this.checkMcpProfile(blockers)) {
          statuses.set("mcp_profile", "ready");
        }
      } else {
        blockers.add("mcp_profile_prerequisite_blocked");
      }
    }

    const sortedBlockers = [...blockers].sort();
    return {
      blockers: sortedBlockers,
      checks: CHECK_ORDER.map((id) => ({ id, status: statuses.get(id) ?? "blocked" })),
      outcome: sortedBlockers.length === 0 ? "ready" : "blocked",
    };
  }

  private async checkRuntime(blockers: Set<string>): Promise<boolean> {
    if (this.hasConfigurationBlocker(["codex_home_", "runtime_"])) {
      return false;
    }
    const codexHome = this.config.codexHome;
    const runtimeDir = this.config.runtimeDir;
    if (!codexHome || !runtimeDir) {
      return false;
    }
    let valid = true;
    try {
      if (!(await this.fileSystem.stat(codexHome)).isDirectory()) {
        blockers.add("codex_home_unavailable");
        valid = false;
      }
    } catch {
      blockers.add("codex_home_unavailable");
      valid = false;
    }
    try {
      if (!(await this.fileSystem.stat(runtimeDir)).isDirectory()) {
        blockers.add("runtime_unavailable");
        valid = false;
      } else if ((await this.fileSystem.readdir(runtimeDir)).length !== 0) {
        blockers.add("runtime_not_empty");
        valid = false;
      }
    } catch {
      blockers.add("runtime_unavailable");
      valid = false;
    }
    return valid;
  }

  private async checkCredentialBlob(blockers: Set<string>): Promise<boolean> {
    return this.checkFile(
      this.config.credentialBlobPath,
      ["credential_blob_"],
      "credential_blob_unavailable",
      blockers,
    );
  }

  private async checkPrivacyAttestation(
    blockers: Set<string>,
    now: Date,
  ): Promise<boolean> {
    if (this.hasConfigurationBlocker(["privacy_attestation_", "privacy_attestation_not_"])) {
      return false;
    }
    const filePath = this.config.privacyAttestationPath;
    const attestationId = this.config.privacyAttestationId;
    const expiresAt = this.config.privacyAttestationExpiresAt;
    if (!filePath || !attestationId || !expiresAt) {
      return false;
    }
    let raw: string;
    try {
      raw = await this.fileSystem.readFile(filePath, "utf8");
    } catch {
      blockers.add("privacy_attestation_unavailable");
      return false;
    }
    try {
      assertSupportPrivacyAttestation(raw, { attestationId, expiresAt }, now);
      return true;
    } catch {
      blockers.add("privacy_attestation_invalid");
      return false;
    }
  }

  private async checkFile(
    filePath: string | undefined,
    configurationPrefixes: string[],
    blocker: string,
    blockers: Set<string>,
  ): Promise<boolean> {
    if (!filePath || this.hasConfigurationBlocker(configurationPrefixes)) {
      return false;
    }
    try {
      if (!(await this.fileSystem.stat(filePath)).isFile()) {
        blockers.add(blocker);
        return false;
      }
      return true;
    } catch {
      blockers.add(blocker);
      return false;
    }
  }

  private async checkCodexVersion(blockers: Set<string>): Promise<boolean> {
    try {
      assertCodexVersionOutput(readSingleCodexCommandOutput(
        await this.runCommand(["--version"], 64 * 1024),
      ));
      return true;
    } catch {
      blockers.add("codex_cli_invalid");
      return false;
    }
  }

  private async checkCodexLogin(blockers: Set<string>): Promise<boolean> {
    try {
      assertChatGptLoginOutput(readSingleCodexCommandOutput(
        await this.runCommand(["login", "status"], 64 * 1024),
      ));
      return true;
    } catch {
      blockers.add("codex_login_invalid");
      return false;
    }
  }

  private async checkMcpProfile(blockers: Set<string>): Promise<boolean> {
    try {
      const result = await this.runCommand(["mcp", "list", "--json"], 256 * 1024);
      assertSupportAutopilotMcpProfile(readSingleCodexCommandOutput(result), {
        mcpEntryPath: this.config.mcpLauncherPath!,
        nodeExecutablePath: this.config.nodeExecutablePath!,
      });
      return true;
    } catch {
      blockers.add("mcp_profile_invalid");
      return false;
    }
  }

  private async runCommand(args: string[], maximumBytes: number): Promise<CodexProcessResult> {
    const result = await this.processRunner.run({
      args,
      cwd: this.config.runtimeDir!,
      environment: createReadinessCodexChildEnvironment(this.config),
      executablePath: this.config.codexExecutablePath!,
      maxOutputBytes: maximumBytes,
      timeoutMs: Math.min(this.config.processTimeoutMs, 120_000),
    });
    if (result.exitCode !== 0 || result.timedOut) {
      throw new Error("CODEX_READINESS_COMMAND_FAILED");
    }
    return result;
  }

  private hasConfigurationBlocker(prefixes: string[]): boolean {
    return this.config.configurationBlockers.some(
      (blocker) => prefixes.some((prefix) => blocker.startsWith(prefix)),
    );
  }
}

export function createReadinessCodexChildEnvironment(
  config: SupportAutopilotReadinessConfig,
): NodeJS.ProcessEnv {
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
