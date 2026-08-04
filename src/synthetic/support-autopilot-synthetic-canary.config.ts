import path from "node:path";
import { fileURLToPath } from "node:url";

type Environment = Record<string, string | undefined>;

export type SupportAutopilotSyntheticCanaryConfig =
  | { enabled: false }
  | {
    codexExecutablePath: string;
    codexHome: string;
    enabled: true;
    mcpEntryPath: string;
    nodeExecutablePath: string;
    processTimeoutMs: number;
    runtimeDir: string;
    workerId: string;
  };

const FORBIDDEN_PRODUCTION_KEYS = [
  "ADMIN_API_BASE_URL",
  "ADMIN_API_TOKEN",
  "SUPPORT_AUTOPILOT_SERVICE_TOKEN",
  "SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH",
] as const;
const WORKER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{1,62}[a-z0-9])$/;

export function loadSupportAutopilotSyntheticCanaryConfig(
  environment: Environment = process.env,
  repositoryRoot = fileURLToPath(new URL("../../", import.meta.url)),
): SupportAutopilotSyntheticCanaryConfig {
  if (environment.SUPPORT_AUTOPILOT_SYNTHETIC_CANARY_ENABLED !== "true") {
    return { enabled: false };
  }
  if (FORBIDDEN_PRODUCTION_KEYS.some((key) => environment[key] !== undefined)) {
    throw new Error("Production configuration is forbidden");
  }

  const codexExecutablePath = absolutePath(
    environment,
    "SUPPORT_AUTOPILOT_SYNTHETIC_CODEX_EXECUTABLE",
  );
  const codexHome = absolutePath(environment, "SUPPORT_AUTOPILOT_SYNTHETIC_CODEX_HOME");
  const mcpEntryPath = absolutePath(
    environment,
    "SUPPORT_AUTOPILOT_SYNTHETIC_MCP_ENTRY_PATH",
  );
  const nodeExecutablePath = absolutePath(
    environment,
    "SUPPORT_AUTOPILOT_SYNTHETIC_NODE_EXECUTABLE",
  );
  const runtimeDir = absolutePath(environment, "SUPPORT_AUTOPILOT_SYNTHETIC_RUNTIME_DIR");
  const workerId = required(environment, "SUPPORT_AUTOPILOT_SYNTHETIC_WORKER_ID");
  const processTimeoutMs = boundedInteger(
    environment,
    "SUPPORT_AUTOPILOT_SYNTHETIC_PROCESS_TIMEOUT_MS",
    30_000,
    600_000,
  );

  if (codexExecutablePath.toLowerCase().includes("\\windowsapps\\")) {
    throw new Error("Standalone Codex CLI is required");
  }
  if (!WORKER_ID_PATTERN.test(workerId)) {
    throw new Error("SUPPORT_AUTOPILOT_SYNTHETIC_WORKER_ID is invalid");
  }
  if (isWithin(codexHome, repositoryRoot) || isWithin(runtimeDir, repositoryRoot)) {
    throw new Error("Synthetic CODEX_HOME and runtime must be outside the repository");
  }
  if (isWithin(codexHome, runtimeDir) || isWithin(runtimeDir, codexHome)) {
    throw new Error("Synthetic CODEX_HOME and runtime must be isolated");
  }

  return {
    codexExecutablePath,
    codexHome,
    enabled: true,
    mcpEntryPath,
    nodeExecutablePath,
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

function isWithin(candidate: string, parent: string): boolean {
  const relative = path.win32.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..\\") && relative !== "..");
}
