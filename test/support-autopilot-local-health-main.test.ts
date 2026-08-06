import { describe, expect, it, vi } from "vitest";
import {
  runSupportAutopilotLocalHealth,
} from "../src/runner/support-autopilot-local-health-main.js";
import type { SupportAutopilotShadowRunnerConfig } from "../src/runner/support-autopilot-shadow-runner.config.js";

const enabledConfig: Extract<SupportAutopilotShadowRunnerConfig, { enabled: true }> = {
  adminApiBaseUrl: "https://malikbot.ru/new-admin",
  budgetStatePath: "C:\\support-autopilot\\state\\budget.json",
  codexExecutablePath: "C:\\tools\\codex.exe",
  codexHome: "C:\\support-autopilot\\codex-home",
  credentialBlobPath: "C:\\support-autopilot\\credentials\\support-autopilot.dpapi",
  dailyBudget: 20,
  enabled: true,
  mcpLauncherPath: "C:\\support-autopilot\\admin-mcp\\scripts\\launch-admin-mcp.ps1",
  nodeExecutablePath: "C:\\tools\\node.exe",
  privacyAttestationExpiresAt: "2026-09-01T00:00:00.000Z",
  privacyAttestationId: "support-privacy-1",
  privacyAttestationPath: "C:\\support-autopilot\\state\\privacy.json",
  processTimeoutMs: 120_000,
  runtimeDir: "C:\\support-autopilot\\runtime",
  workerId: "windows-shadow-1",
};

const validHealth = {
  activeLeases: 0,
  claimsEnabled: true,
  deadLetters: 0,
  deliveryUnknownCount: 0,
  generatedAt: "2026-08-06T09:00:00.000Z",
  jobCreationEnabled: true,
  oldestPendingAgeMs: null,
  pendingJobs: 2,
  privacyAttestationId: "support-privacy-1",
  privacyGatePassed: true,
  retryWaitJobs: 0,
  runnerLastSeenAt: "2026-08-06T08:59:59.000Z",
  runnerReady: true,
  shadowModeEnabled: true,
};

describe("runSupportAutopilotLocalHealth", () => {
  it("reads the DPAPI token and returns only sanitized queue counters", async () => {
    const get = vi.fn().mockResolvedValue(validHealth);
    const apiClientFactory = vi.fn().mockReturnValue({ get });
    const read = vi.fn().mockResolvedValue("raw-service-token");

    await expect(runSupportAutopilotLocalHealth({}, {
      apiClientFactory,
      loadConfig: () => enabledConfig,
      secretProvider: { read },
    })).resolves.toEqual({
      activeLeases: 0,
      pendingJobs: 2,
      reachable: true,
    });

    expect(read).toHaveBeenCalledWith(enabledConfig.credentialBlobPath);
    expect(apiClientFactory).toHaveBeenCalledWith(enabledConfig, "raw-service-token");
    expect(get).toHaveBeenCalledWith("/support-automation/health");
  });

  it("rejects missing or additional provider response fields", async () => {
    for (const response of [
      { ...validHealth, activeLeases: undefined },
      { ...validHealth, rawToken: "forbidden" },
    ]) {
      await expect(runSupportAutopilotLocalHealth({}, {
        apiClientFactory: () => ({ get: vi.fn().mockResolvedValue(response) }),
        loadConfig: () => enabledConfig,
        secretProvider: { read: vi.fn().mockResolvedValue("raw-service-token") },
      })).rejects.toThrow("SUPPORT_AUTOPILOT_LOCAL_HEALTH_FAILED");
    }
  });

  it("collapses credential and provider errors without leaking their messages", async () => {
    for (const dependencies of [
      {
        apiClientFactory: vi.fn(),
        loadConfig: () => enabledConfig,
        secretProvider: { read: vi.fn().mockRejectedValue(new Error("raw-service-token")) },
      },
      {
        apiClientFactory: () => ({
          get: vi.fn().mockRejectedValue(new Error("provider body with raw-service-token")),
        }),
        loadConfig: () => enabledConfig,
        secretProvider: { read: vi.fn().mockResolvedValue("raw-service-token") },
      },
    ]) {
      const error = await runSupportAutopilotLocalHealth({}, dependencies)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("SUPPORT_AUTOPILOT_LOCAL_HEALTH_FAILED");
      expect((error as Error).message).not.toContain("raw-service-token");
      expect((error as Error).message).not.toContain("provider body");
    }
  });

  it("fails closed when the shadow runner is disabled", async () => {
    await expect(runSupportAutopilotLocalHealth({}, {
      loadConfig: () => ({ enabled: false }),
    })).rejects.toThrow("SUPPORT_AUTOPILOT_LOCAL_HEALTH_FAILED");
  });
});
