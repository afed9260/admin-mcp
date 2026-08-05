import path from "node:path";

export interface SupportAutopilotMcpProfileExpectation {
  environment?: {
    adminApiBaseUrl?: string;
    credentialBlobPath: string;
  };
  mcpEntryPath: string;
  nodeExecutablePath: string;
}

export function assertCodexVersionOutput(value: string): void {
  if (!/^codex-cli \d+\.\d+\.\d+(?:[-+][^\r\n]+)?$/.test(value)) {
    throw new Error("CODEX_VERSION_INVALID");
  }
}

export function assertChatGptLoginOutput(value: string): void {
  if (value !== "Logged in using ChatGPT") {
    throw new Error("CODEX_LOGIN_INVALID");
  }
}

export function assertSupportAutopilotMcpProfile(
  raw: string,
  expected: SupportAutopilotMcpProfileExpectation,
): void {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0])) {
      throw new Error("invalid profile");
    }
    const server = parsed[0];
    const transport = server.transport;
    if (
      server.name !== "support-autopilot"
      || server.enabled !== true
      || !isRecord(transport)
      || transport.type !== "stdio"
      || !sameWindowsPath(transport.command, expected.nodeExecutablePath)
      || !Array.isArray(transport.args)
      || transport.args.length !== 1
      || !sameWindowsPath(transport.args[0], expected.mcpEntryPath)
      || !(transport.cwd === null || transport.cwd === undefined)
      || !matchesEnvironment(transport.env, expected.environment)
      || !(transport.env_vars === undefined || (Array.isArray(transport.env_vars) && transport.env_vars.length === 0))
    ) {
      throw new Error("invalid profile");
    }
  } catch {
    throw new Error("CODEX_MCP_PROFILE_INVALID");
  }
}

function matchesEnvironment(
  value: unknown,
  expected: SupportAutopilotMcpProfileExpectation["environment"],
): boolean {
  if (!expected) {
    return value === null || (isRecord(value) && Object.keys(value).length === 0);
  }
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  const exactKeys = [
    "ADMIN_API_BASE_URL",
    "SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH",
  ].sort();
  return keys.length === exactKeys.length
    && keys.every((key, index) => key === exactKeys[index])
    && sameWindowsPath(
      value.SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH,
      expected.credentialBlobPath,
    )
    && (expected.adminApiBaseUrl
      ? value.ADMIN_API_BASE_URL === expected.adminApiBaseUrl
      : isCredentialFreeHttpsUrl(value.ADMIN_API_BASE_URL));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameWindowsPath(value: unknown, expected: string): boolean {
  return typeof value === "string"
    && path.win32.normalize(value).toLowerCase() === path.win32.normalize(expected).toLowerCase();
}

function isCredentialFreeHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}
