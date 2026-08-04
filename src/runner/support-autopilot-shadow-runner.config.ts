import path from "node:path";
import { fileURLToPath } from "node:url";

type Environment = Record<string, string | undefined>;

export type SupportAutopilotShadowRunnerConfig =
  | { enabled: false }
  | {
    adminApiBaseUrl: string;
    budgetStatePath: string;
    codexExecutablePath: string;
    codexHome: string;
    credentialBlobPath: string;
    dailyBudget: number;
    enabled: true;
    mcpLauncherPath: string;
    nodeExecutablePath: string;
    privacyAttestationExpiresAt: string;
    privacyAttestationId: string;
    privacyAttestationPath: string;
    processTimeoutMs: number;
    runtimeDir: string;
    workerId: string;
  };

const WORKER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{1,62}[a-z0-9])$/;
const ATTESTATION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{1,126}[a-z0-9])$/;

export function loadSupportAutopilotShadowRunnerConfig(
  environment: Environment = process.env,
  repositoryRoot = fileURLToPath(new URL("../../", import.meta.url)),
): SupportAutopilotShadowRunnerConfig {
  if (environment.SUPPORT_AUTOPILOT_SHADOW_RUNNER_ENABLED !== "true") {
    return { enabled: false };
  }
  if (environment.SUPPORT_AUTOPILOT_SERVICE_TOKEN !== undefined) {
    throw new Error("SUPPORT_AUTOPILOT_SERVICE_TOKEN must not be present in runner environment");
  }

  const codexExecutablePath = absolutePath(environment, "SUPPORT_AUTOPILOT_CODEX_EXECUTABLE");
  const codexHome = absolutePath(environment, "SUPPORT_AUTOPILOT_CODEX_HOME");
  const runtimeDir = absolutePath(environment, "SUPPORT_AUTOPILOT_RUNTIME_DIR");
  const credentialBlobPath = absolutePath(
    environment,
    "SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH",
  );
  const privacyAttestationPath = absolutePath(
    environment,
    "SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_PATH",
  );
  const budgetStatePath = absolutePath(environment, "SUPPORT_AUTOPILOT_BUDGET_STATE_PATH");
  const mcpLauncherPath = absolutePath(environment, "SUPPORT_AUTOPILOT_MCP_LAUNCHER_PATH");
  const nodeExecutablePath = absolutePath(environment, "SUPPORT_AUTOPILOT_NODE_EXECUTABLE");
  const workerId = required(environment, "SUPPORT_AUTOPILOT_WORKER_ID");
  const privacyAttestationId = required(
    environment,
    "SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_ID",
  );
  const privacyAttestationExpiresAt = canonicalIso(
    required(environment, "SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_EXPIRES_AT"),
    "SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_EXPIRES_AT",
  );
  const dailyBudget = boundedInteger(
    environment,
    "SUPPORT_AUTOPILOT_DAILY_BUDGET",
    1,
    100,
  );
  const processTimeoutMs = boundedInteger(
    environment,
    "SUPPORT_AUTOPILOT_PROCESS_TIMEOUT_MS",
    30_000,
    1_799_999,
  );
  const adminApiBaseUrl = httpsUrl(required(environment, "ADMIN_API_BASE_URL"));

  if (codexExecutablePath.toLowerCase().includes("\\windowsapps\\")) {
    throw new Error("Standalone Codex CLI is required");
  }
  if (!WORKER_ID_PATTERN.test(workerId)) {
    throw new Error("SUPPORT_AUTOPILOT_WORKER_ID is invalid");
  }
  if (!ATTESTATION_ID_PATTERN.test(privacyAttestationId)) {
    throw new Error("SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_ID is invalid");
  }
  for (const forbiddenParent of [runtimeDir, codexHome, repositoryRoot]) {
    if (isWithin(credentialBlobPath, forbiddenParent)) {
      throw new Error("Credential blob must be outside repositories and runtime directories");
    }
  }
  if (isWithin(runtimeDir, repositoryRoot) || isWithin(codexHome, repositoryRoot)) {
    throw new Error("CODEX_HOME and runtime must be outside the repository");
  }
  if (
    isWithin(budgetStatePath, runtimeDir)
    || isWithin(privacyAttestationPath, runtimeDir)
    || isWithin(budgetStatePath, repositoryRoot)
    || isWithin(privacyAttestationPath, repositoryRoot)
  ) {
    throw new Error("Runner state and attestation must be outside repositories and runtime");
  }
  if (new Set([
    budgetStatePath.toLowerCase(),
    credentialBlobPath.toLowerCase(),
    privacyAttestationPath.toLowerCase(),
  ]).size !== 3) {
    throw new Error("Runner files must use distinct paths");
  }
  if (new Set([
    codexHome.toLowerCase(),
    runtimeDir.toLowerCase(),
    path.win32.dirname(credentialBlobPath).toLowerCase(),
  ]).size !== 3) {
    throw new Error("Runner directories must be isolated");
  }

  return {
    adminApiBaseUrl,
    budgetStatePath,
    codexExecutablePath,
    codexHome,
    credentialBlobPath,
    dailyBudget,
    enabled: true,
    mcpLauncherPath,
    nodeExecutablePath,
    privacyAttestationExpiresAt,
    privacyAttestationId,
    privacyAttestationPath,
    processTimeoutMs,
    runtimeDir,
    workerId,
  };
}

function required(environment: Environment, key: string): string {
  const value = environment[key];
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function absolutePath(environment: Environment, key: string): string {
  const value = required(environment, key);
  if (!path.win32.isAbsolute(value) || value.includes("\0")) {
    throw new Error(`${key} must be an absolute Windows path`);
  }
  return path.win32.normalize(value);
}

function boundedInteger(
  environment: Environment,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const raw = required(environment, key);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${key} must be an integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} is outside the allowed range`);
  }
  return value;
}

function canonicalIso(value: string, key: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${key} must be a canonical ISO timestamp`);
  }
  return value;
}

function httpsUrl(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("ADMIN_API_BASE_URL must be a credential-free HTTPS URL");
  }
  return parsed.href.replace(/\/$/, "");
}

function isWithin(candidate: string, parent: string): boolean {
  const relative = path.win32.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..\\") && relative !== "..");
}
