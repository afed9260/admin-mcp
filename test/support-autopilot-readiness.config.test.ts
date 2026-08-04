import { describe, expect, it } from "vitest";
import {
  loadSupportAutopilotReadinessConfig,
} from "../src/runner/support-autopilot-readiness.config.js";

const environment = {
  SUPPORT_AUTOPILOT_CODEX_EXECUTABLE: "C:\\Tools\\codex.exe",
  SUPPORT_AUTOPILOT_CODEX_HOME: "C:\\SupportAutopilot\\codex-home",
  SUPPORT_AUTOPILOT_RUNTIME_DIR: "C:\\SupportAutopilot\\runtime",
  SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: "C:\\SupportSecrets\\credential.dpapi",
  SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_PATH: "C:\\SupportAutopilot\\state\\privacy.json",
  SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_ID: "support-privacy-v1",
  SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_EXPIRES_AT: "2026-08-30T00:00:00.000Z",
  SUPPORT_AUTOPILOT_MCP_LAUNCHER_PATH: "C:\\repo\\dist\\runner\\support-autopilot-mcp-launcher.js",
  SUPPORT_AUTOPILOT_NODE_EXECUTABLE: "C:\\Program Files\\nodejs\\node.exe",
  SUPPORT_AUTOPILOT_PROCESS_TIMEOUT_MS: "120000",
};

describe("loadSupportAutopilotReadinessConfig", () => {
  it("loads the existing non-secret production path settings", () => {
    const result = loadSupportAutopilotReadinessConfig(environment, "C:\\repo");

    expect(result.configurationBlockers).toEqual([]);
    expect(result.processTimeoutMs).toBe(120_000);
    expect(result.plaintextTokenPresent).toBe(false);
    expect(result.codexExecutablePath).toBe(environment.SUPPORT_AUTOPILOT_CODEX_EXECUTABLE);
    expect(result.credentialBlobPath).toBe(environment.SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH);
  });

  it("uses a bounded default process timeout", () => {
    const { SUPPORT_AUTOPILOT_PROCESS_TIMEOUT_MS: _omitted, ...withoutTimeout } = environment;
    expect(loadSupportAutopilotReadinessConfig(withoutTimeout, "C:\\repo").processTimeoutMs)
      .toBe(120_000);
  });

  it("turns absent and invalid values into stable blockers", () => {
    const result = loadSupportAutopilotReadinessConfig({
      SUPPORT_AUTOPILOT_CODEX_EXECUTABLE: ".\\codex.exe",
      SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_EXPIRES_AT: "not-a-date",
      SUPPORT_AUTOPILOT_PROCESS_TIMEOUT_MS: "0",
    }, "C:\\repo");

    expect(result.configurationBlockers).toEqual(expect.arrayContaining([
      "codex_executable_invalid",
      "codex_home_not_configured",
      "credential_blob_not_configured",
      "mcp_launcher_not_configured",
      "node_executable_not_configured",
      "privacy_attestation_expiry_invalid",
      "privacy_attestation_id_not_configured",
      "privacy_attestation_not_configured",
      "process_timeout_invalid",
      "runtime_not_configured",
    ]));
    expect(result.codexExecutablePath).toBeUndefined();
    expect(result.processTimeoutMs).toBe(120_000);
  });

  it("reports path isolation violations", () => {
    const result = loadSupportAutopilotReadinessConfig({
      ...environment,
      SUPPORT_AUTOPILOT_CODEX_HOME: "C:\\repo\\codex-home",
      SUPPORT_AUTOPILOT_RUNTIME_DIR: "C:\\repo\\runtime",
      SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: "C:\\repo\\runtime\\credential.dpapi",
      SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_PATH: "C:\\repo\\privacy.json",
    }, "C:\\repo");

    expect(result.configurationBlockers).toEqual(expect.arrayContaining([
      "codex_home_not_isolated",
      "credential_blob_not_isolated",
      "privacy_attestation_not_isolated",
      "runtime_not_isolated",
    ]));
  });

  it("rejects shared runner directories and state files", () => {
    const result = loadSupportAutopilotReadinessConfig({
      ...environment,
      SUPPORT_AUTOPILOT_CODEX_HOME: "C:\\SupportAutopilot\\shared",
      SUPPORT_AUTOPILOT_RUNTIME_DIR: "C:\\SupportAutopilot\\shared",
      SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: "C:\\SupportSecrets\\shared-state",
      SUPPORT_AUTOPILOT_PRIVACY_ATTESTATION_PATH: "C:\\SupportSecrets\\shared-state",
    }, "C:\\repo");

    expect(result.configurationBlockers).toEqual(expect.arrayContaining([
      "codex_home_not_isolated",
      "credential_blob_not_isolated",
      "privacy_attestation_not_isolated",
      "runtime_not_isolated",
    ]));
  });

  it.each([
    ["SUPPORT_AUTOPILOT_SERVICE_TOKEN", "service-secret"],
    ["ADMIN_API_TOKEN", "admin-secret"],
  ])("records only the presence of %s", (key, secret) => {
    const result = loadSupportAutopilotReadinessConfig({
      ...environment,
      [key]: secret,
    }, "C:\\repo");

    expect(result.plaintextTokenPresent).toBe(true);
    expect(result.configurationBlockers).toContain("plaintext_token_present");
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
