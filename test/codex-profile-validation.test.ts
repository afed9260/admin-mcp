import { describe, expect, it } from "vitest";
import {
  assertChatGptLoginOutput,
  assertCodexVersionOutput,
  assertSupportAutopilotMcpProfile,
} from "../src/runner/codex-profile-validation.js";

const expected = {
  mcpEntryPath: "C:\\ServiceApp\\dist\\runner\\support-autopilot-mcp-launcher.js",
  nodeExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
};

const runtimeExpected = {
  ...expected,
  environment: {
    adminApiBaseUrl: "https://admin.example.test/new-admin",
    credentialBlobPath: "C:\\ServiceSecrets\\support-autopilot.dpapi",
  },
};

function profile(transportOverrides: Record<string, unknown> = {}) {
  return JSON.stringify([{
    enabled: true,
    name: "support-autopilot",
    transport: {
      args: [expected.mcpEntryPath],
      command: expected.nodeExecutablePath,
      cwd: null,
      env: null,
      env_vars: ["SUPPORT_AUTOPILOT_WORK_KIND"],
      type: "stdio",
      ...transportOverrides,
    },
  }]);
}

describe("Codex profile validation", () => {
  it("accepts the reviewed standalone version, ChatGPT login, and exact MCP profile", () => {
    expect(() => assertCodexVersionOutput("codex-cli 0.146.0")).not.toThrow();
    expect(() => assertChatGptLoginOutput("Logged in using ChatGPT")).not.toThrow();
    expect(() => assertSupportAutopilotMcpProfile(profile(), expected)).not.toThrow();
  });

  it("accepts only the exact reviewed non-secret production MCP environment", () => {
    expect(() => assertSupportAutopilotMcpProfile(profile({
      env: {
        ADMIN_API_BASE_URL: runtimeExpected.environment.adminApiBaseUrl,
        SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: runtimeExpected.environment.credentialBlobPath,
      },
    }), runtimeExpected)).not.toThrow();
  });

  it.each([
    ["extra key", {
      ADMIN_API_BASE_URL: runtimeExpected.environment.adminApiBaseUrl,
      EXTRA: "forbidden",
      SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: runtimeExpected.environment.credentialBlobPath,
    }],
    ["plaintext token", {
      ADMIN_API_BASE_URL: runtimeExpected.environment.adminApiBaseUrl,
      SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: runtimeExpected.environment.credentialBlobPath,
      SUPPORT_AUTOPILOT_SERVICE_TOKEN: "forbidden",
    }],
    ["wrong URL", {
      ADMIN_API_BASE_URL: "https://other.example.test/new-admin",
      SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: runtimeExpected.environment.credentialBlobPath,
    }],
    ["wrong credential path", {
      ADMIN_API_BASE_URL: runtimeExpected.environment.adminApiBaseUrl,
      SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: "C:\\Other\\token.dpapi",
    }],
  ])("rejects production MCP environment with %s", (_name, env) => {
    expect(() => assertSupportAutopilotMcpProfile(profile({ env }), runtimeExpected))
      .toThrow("CODEX_MCP_PROFILE_INVALID");
  });

  it.each([
    "Codex 0.146.0",
    "codex-cli unknown",
    "codex-cli 0.146.0\nextra",
  ])("rejects malformed version output", (value) => {
    expect(() => assertCodexVersionOutput(value)).toThrow("CODEX_VERSION_INVALID");
  });

  it.each([
    "Logged in using an API key",
    "Logged in using ChatGPT\nextra",
    "",
  ])("rejects non-ChatGPT login output", (value) => {
    expect(() => assertChatGptLoginOutput(value)).toThrow("CODEX_LOGIN_INVALID");
  });

  it.each([
    ["extra server", () => JSON.stringify([...JSON.parse(profile()), ...JSON.parse(profile())])],
    ["wrong command", () => profile({ command: "C:\\Other\\node.exe" })],
    ["wrong entry", () => profile({ args: ["C:\\Other\\launcher.js"] })],
    ["working directory", () => profile({ cwd: "C:\\ServiceApp" })],
    ["configured environment", () => profile({ env: { TOKEN: "hidden" } })],
    ["missing work-kind environment allowlist", () => profile({ env_vars: [] })],
    ["wrong environment allowlist", () => profile({ env_vars: ["PATH"] })],
    ["extra environment allowlist entry", () => profile({
      env_vars: ["SUPPORT_AUTOPILOT_WORK_KIND", "PATH"],
    })],
    ["malformed JSON", () => "not-json"],
  ])("rejects MCP profile with %s", (_name, build) => {
    expect(() => assertSupportAutopilotMcpProfile(build(), expected))
      .toThrow("CODEX_MCP_PROFILE_INVALID");
  });
});
