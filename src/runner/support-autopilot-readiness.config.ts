import path from "node:path";
import { fileURLToPath } from "node:url";

type Environment = Record<string, string | undefined>;

export interface SupportAutopilotReadinessConfig {
  codexExecutablePath?: string;
  codexHome?: string;
  configurationBlockers: string[];
  credentialBlobPath?: string;
  mcpLauncherPath?: string;
  nodeExecutablePath?: string;
  plaintextTokenPresent: boolean;
  privacyAttestationExpiresAt?: string;
  privacyAttestationId?: string;
  privacyAttestationPath?: string;
  processTimeoutMs: number;
  runtimeDir?: string;
}

const ATTESTATION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{1,126}[a-z0-9])$/;
const DEFAULT_PROCESS_TIMEOUT_MS = 120_000;

export function loadSupportAutopilotReadinessConfig(
  environment: Environment = process.env,
  repositoryRoot = fileURLToPath(new URL("../../", import.meta.url)),
): SupportAutopilotReadinessConfig {
  const blockers: string[] = [];
  const codexExecutablePath = diagnosticPath(
    environment,
    "SUPPORT_AUTOPILOT_CODEX_EXECUTABLE",
    "codex_executable",
    blockers,
  );
  const codexHome = diagnosticPath(
    environment,
    "SUPPORT_AUTOPILOT_CODEX_HOME",
    "codex_home",
    blockers,
  );
  const runtimeDir = diagnosticPath(
    environment,
    "SUPPORT_AUTOPILOT_RUNTIME_DIR",
    "runtime",
    blockers,
  );
  const credentialBlobPath = diagnosticPath(
    environment,
    "SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH",
    "credential_blob",
    blockers,
  );
  const privacyAttestationPath = diagnosticPath(
    environment,
    "SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_PATH",
    "privacy_attestation",
    blockers,
  );
  const mcpLauncherPath = diagnosticPath(
    environment,
    "SUPPORT_AUTOPILOT_MCP_LAUNCHER_PATH",
    "mcp_launcher",
    blockers,
  );
  const nodeExecutablePath = diagnosticPath(
    environment,
    "SUPPORT_AUTOPILOT_NODE_EXECUTABLE",
    "node_executable",
    blockers,
  );
  const privacyAttestationId = diagnosticAttestationId(environment, blockers);
  const privacyAttestationExpiresAt = diagnosticExpiry(environment, blockers);
  const processTimeoutMs = diagnosticTimeout(environment, blockers);
  const plaintextTokenPresent = environment.SUPPORT_AUTOPILOT_SERVICE_TOKEN !== undefined
    || environment.ADMIN_API_TOKEN !== undefined;
  if (plaintextTokenPresent) {
    blockers.push("plaintext_token_present");
  }

  if (codexExecutablePath?.toLowerCase().includes("\\windowsapps\\")) {
    blockers.push("codex_executable_invalid");
  }
  if (codexHome && isWithin(codexHome, repositoryRoot)) {
    blockers.push("codex_home_not_isolated");
  }
  if (runtimeDir && isWithin(runtimeDir, repositoryRoot)) {
    blockers.push("runtime_not_isolated");
  }
  if (credentialBlobPath && [runtimeDir, codexHome, repositoryRoot]
    .filter((value): value is string => value !== undefined)
    .some((parent) => isWithin(credentialBlobPath, parent))) {
    blockers.push("credential_blob_not_isolated");
  }
  if (privacyAttestationPath && [runtimeDir, repositoryRoot]
    .filter((value): value is string => value !== undefined)
    .some((parent) => isWithin(privacyAttestationPath, parent))) {
    blockers.push("privacy_attestation_not_isolated");
  }

  return {
    codexExecutablePath,
    codexHome,
    configurationBlockers: [...new Set(blockers)].sort(),
    credentialBlobPath,
    mcpLauncherPath,
    nodeExecutablePath,
    plaintextTokenPresent,
    privacyAttestationExpiresAt,
    privacyAttestationId,
    privacyAttestationPath,
    processTimeoutMs,
    runtimeDir,
  };
}

function diagnosticPath(
  environment: Environment,
  key: string,
  blockerPrefix: string,
  blockers: string[],
): string | undefined {
  const value = environment[key];
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    blockers.push(`${blockerPrefix}_not_configured`);
    return undefined;
  }
  if (!path.win32.isAbsolute(value) || value.includes("\0")) {
    blockers.push(`${blockerPrefix}_invalid`);
    return undefined;
  }
  return path.win32.normalize(value);
}

function diagnosticAttestationId(
  environment: Environment,
  blockers: string[],
): string | undefined {
  const value = environment.SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_ID;
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    blockers.push("privacy_attestation_id_not_configured");
    return undefined;
  }
  if (!ATTESTATION_ID_PATTERN.test(value)) {
    blockers.push("privacy_attestation_id_invalid");
    return undefined;
  }
  return value;
}

function diagnosticExpiry(
  environment: Environment,
  blockers: string[],
): string | undefined {
  const value = environment.SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_EXPIRES_AT;
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    blockers.push("privacy_attestation_expiry_not_configured");
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    blockers.push("privacy_attestation_expiry_invalid");
    return undefined;
  }
  return value;
}

function diagnosticTimeout(environment: Environment, blockers: string[]): number {
  const raw = environment.SUPPORT_AUTOPILOT_PROCESS_TIMEOUT_MS;
  if (raw === undefined) {
    return DEFAULT_PROCESS_TIMEOUT_MS;
  }
  if (!/^\d+$/.test(raw)) {
    blockers.push("process_timeout_invalid");
    return DEFAULT_PROCESS_TIMEOUT_MS;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 30_000 || value > 1_799_999) {
    blockers.push("process_timeout_invalid");
    return DEFAULT_PROCESS_TIMEOUT_MS;
  }
  return value;
}

function isWithin(candidate: string, parent: string): boolean {
  const relative = path.win32.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..\\") && relative !== "..");
}
