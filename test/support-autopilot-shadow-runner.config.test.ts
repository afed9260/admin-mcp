import { describe, expect, it } from "vitest";
import { loadSupportAutopilotShadowRunnerConfig } from "../src/runner/support-autopilot-shadow-runner.config.js";

const baseEnvironment = {
  SUPPORT_AUTOPILOT_SHADOW_RUNNER_ENABLED: "true",
  SUPPORT_AUTOPILOT_CODEX_EXECUTABLE: "C:\\Tools\\codex\\codex.exe",
  SUPPORT_AUTOPILOT_CODEX_HOME: "C:\\ServiceData\\codex-home",
  SUPPORT_AUTOPILOT_RUNTIME_DIR: "C:\\ServiceData\\runtime",
  SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: "C:\\ServiceSecrets\\support-token.dpapi",
  SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_PATH: "C:\\ServiceData\\privacy.json",
  SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_ID: "support-privacy-v1",
  SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_EXPIRES_AT: "2026-08-30T00:00:00.000Z",
  SUPPORT_AUTOPILOT_WORKER_ID: "support-shadow.1",
  SUPPORT_AUTOPILOT_DAILY_BUDGET: "25",
  SUPPORT_AUTOPILOT_PROCESS_TIMEOUT_MS: "1200000",
  SUPPORT_AUTOPILOT_BUDGET_STATE_PATH: "C:\\ServiceData\\budget.json",
  SUPPORT_AUTOPILOT_MCP_LAUNCHER_PATH: "C:\\ServiceApp\\dist\\runner\\support-autopilot-mcp-launcher.js",
  SUPPORT_AUTOPILOT_NODE_EXECUTABLE: "C:\\Program Files\\nodejs\\node.exe",
  ADMIN_API_BASE_URL: "https://admin.example.test/new-admin",
};

describe("loadSupportAutopilotShadowRunnerConfig", () => {
  it("is dormant unless the exact enable flag is true", () => {
    expect(loadSupportAutopilotShadowRunnerConfig({})).toEqual({ enabled: false });
    expect(loadSupportAutopilotShadowRunnerConfig({
      SUPPORT_AUTOPILOT_SHADOW_RUNNER_ENABLED: "TRUE",
    })).toEqual({ enabled: false });
  });

  it("loads a bounded enabled configuration", () => {
    expect(loadSupportAutopilotShadowRunnerConfig(baseEnvironment, "C:\\repo")).toMatchObject({
      dailyBudget: 25,
      enabled: true,
      processTimeoutMs: 1_200_000,
      workerId: "support-shadow.1",
    });
  });

  it.each([
    ["plaintext token", { SUPPORT_AUTOPILOT_SERVICE_TOKEN: "forbidden" }],
    ["WindowsApps Codex", { SUPPORT_AUTOPILOT_CODEX_EXECUTABLE: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\codex.exe" }],
    ["relative Codex", { SUPPORT_AUTOPILOT_CODEX_EXECUTABLE: ".\\codex.exe" }],
    ["relative home", { SUPPORT_AUTOPILOT_CODEX_HOME: ".\\home" }],
    ["invalid worker", { SUPPORT_AUTOPILOT_WORKER_ID: "UPPER CASE" }],
    ["zero budget", { SUPPORT_AUTOPILOT_DAILY_BUDGET: "0" }],
    ["lease-length timeout", { SUPPORT_AUTOPILOT_PROCESS_TIMEOUT_MS: "1800000" }],
    ["credential in runtime", { SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: "C:\\ServiceData\\runtime\\token.dpapi" }],
    ["credential in repository", { SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: "C:\\repo\\token.dpapi" }],
    ["non-https backend", { ADMIN_API_BASE_URL: "http://admin.example.test" }],
  ])("rejects %s", (_name, override) => {
    expect(() => loadSupportAutopilotShadowRunnerConfig({
      ...baseEnvironment,
      ...override,
    }, "C:\\repo")).toThrow();
  });
});
