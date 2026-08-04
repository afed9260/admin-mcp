import path from "node:path";

export interface SupportAutopilotMcpProfileExpectation {
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
      || !(transport.env === null || (isRecord(transport.env) && Object.keys(transport.env).length === 0))
      || !(transport.env_vars === undefined || (Array.isArray(transport.env_vars) && transport.env_vars.length === 0))
    ) {
      throw new Error("invalid profile");
    }
  } catch {
    throw new Error("CODEX_MCP_PROFILE_INVALID");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameWindowsPath(value: unknown, expected: string): boolean {
  return typeof value === "string"
    && path.win32.normalize(value).toLowerCase() === path.win32.normalize(expected).toLowerCase();
}
