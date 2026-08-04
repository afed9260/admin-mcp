import { describe, expect, it } from "vitest";
import { loadSupportAutopilotSyntheticCanaryConfig } from "../src/synthetic/support-autopilot-synthetic-canary.config.js";

const baseEnvironment = {
  SUPPORT_AUTOPILOT_SYNTHETIC_CANARY_ENABLED: "true",
  SUPPORT_AUTOPILOT_SYNTHETIC_CODEX_EXECUTABLE: "C:\\Tools\\codex\\codex.exe",
  SUPPORT_AUTOPILOT_SYNTHETIC_CODEX_HOME: "C:\\Synthetic\\codex-home",
  SUPPORT_AUTOPILOT_SYNTHETIC_MCP_ENTRY_PATH: "C:\\repo\\dist\\synthetic\\synthetic-support-autopilot-mcp.js",
  SUPPORT_AUTOPILOT_SYNTHETIC_NODE_EXECUTABLE: "C:\\Program Files\\nodejs\\node.exe",
  SUPPORT_AUTOPILOT_SYNTHETIC_PROCESS_TIMEOUT_MS: "120000",
  SUPPORT_AUTOPILOT_SYNTHETIC_RUNTIME_DIR: "C:\\Synthetic\\runtime",
  SUPPORT_AUTOPILOT_SYNTHETIC_WORKER_ID: "support-synthetic.1",
};

describe("loadSupportAutopilotSyntheticCanaryConfig", () => {
  it("stays dormant unless explicitly enabled", () => {
    expect(loadSupportAutopilotSyntheticCanaryConfig({})).toEqual({ enabled: false });
    expect(loadSupportAutopilotSyntheticCanaryConfig({
      ...baseEnvironment,
      SUPPORT_AUTOPILOT_SYNTHETIC_CANARY_ENABLED: "TRUE",
    }, "C:\\repo")).toEqual({ enabled: false });
  });

  it("loads one isolated synthetic profile", () => {
    expect(loadSupportAutopilotSyntheticCanaryConfig(baseEnvironment, "C:\\repo"))
      .toEqual({
        codexExecutablePath: "C:\\Tools\\codex\\codex.exe",
        codexHome: "C:\\Synthetic\\codex-home",
        enabled: true,
        mcpEntryPath: "C:\\repo\\dist\\synthetic\\synthetic-support-autopilot-mcp.js",
        nodeExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
        processTimeoutMs: 120_000,
        runtimeDir: "C:\\Synthetic\\runtime",
        workerId: "support-synthetic.1",
      });
  });

  it.each([
    "ADMIN_API_BASE_URL",
    "ADMIN_API_TOKEN",
    "SUPPORT_AUTOPILOT_SERVICE_TOKEN",
    "SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH",
  ])("rejects forbidden production configuration %s", (key) => {
    expect(() => loadSupportAutopilotSyntheticCanaryConfig({
      ...baseEnvironment,
      [key]: "forbidden",
    }, "C:\\repo")).toThrow("Production configuration is forbidden");
  });

  it.each([
    ["WindowsApps Codex", { SUPPORT_AUTOPILOT_SYNTHETIC_CODEX_EXECUTABLE: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\codex.exe" }],
    ["relative Codex", { SUPPORT_AUTOPILOT_SYNTHETIC_CODEX_EXECUTABLE: ".\\codex.exe" }],
    ["relative Node", { SUPPORT_AUTOPILOT_SYNTHETIC_NODE_EXECUTABLE: ".\\node.exe" }],
    ["relative MCP", { SUPPORT_AUTOPILOT_SYNTHETIC_MCP_ENTRY_PATH: ".\\synthetic-mcp.js" }],
    ["relative home", { SUPPORT_AUTOPILOT_SYNTHETIC_CODEX_HOME: ".\\codex-home" }],
    ["relative runtime", { SUPPORT_AUTOPILOT_SYNTHETIC_RUNTIME_DIR: ".\\runtime" }],
    ["home in repository", { SUPPORT_AUTOPILOT_SYNTHETIC_CODEX_HOME: "C:\\repo\\codex-home" }],
    ["runtime in repository", { SUPPORT_AUTOPILOT_SYNTHETIC_RUNTIME_DIR: "C:\\repo\\runtime" }],
    ["shared home and runtime", {
      SUPPORT_AUTOPILOT_SYNTHETIC_CODEX_HOME: "C:\\Synthetic\\shared",
      SUPPORT_AUTOPILOT_SYNTHETIC_RUNTIME_DIR: "C:\\Synthetic\\shared",
    }],
    ["invalid worker", { SUPPORT_AUTOPILOT_SYNTHETIC_WORKER_ID: "UPPER CASE" }],
    ["short timeout", { SUPPORT_AUTOPILOT_SYNTHETIC_PROCESS_TIMEOUT_MS: "29999" }],
    ["long timeout", { SUPPORT_AUTOPILOT_SYNTHETIC_PROCESS_TIMEOUT_MS: "600001" }],
    ["fractional timeout", { SUPPORT_AUTOPILOT_SYNTHETIC_PROCESS_TIMEOUT_MS: "120000.5" }],
  ])("rejects %s", (_name, override) => {
    expect(() => loadSupportAutopilotSyntheticCanaryConfig({
      ...baseEnvironment,
      ...override,
    }, "C:\\repo")).toThrow();
  });
});
