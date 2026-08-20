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
  level1: {
    actionRequestsByState: {
      approved: { count: 0, oldestAgeMs: null },
      awaiting_owner: { count: 2, oldestAgeMs: null },
      regeneration_pending: { count: 0, oldestAgeMs: null },
      executing: { count: 0, oldestAgeMs: null },
      succeeded: { count: 4, oldestAgeMs: null },
      superseded: { count: 0, oldestAgeMs: null },
      expired: { count: 0, oldestAgeMs: null },
      failed: { count: 1, oldestAgeMs: null },
      delivery_unknown: { count: 0, oldestAgeMs: null },
    },
    automaticOutcomes: {
      approved: 0,
      awaiting_owner: 0,
      regeneration_pending: 0,
      executing: 0,
      succeeded: 3,
      superseded: 0,
      expired: 0,
      failed: 0,
      delivery_unknown: 0,
    },
    initialByState: {
      pending: { count: 2, oldestAgeMs: null },
      leased: { count: 0, oldestAgeMs: null },
      retry_wait: { count: 0, oldestAgeMs: null },
      executing: { count: 0, oldestAgeMs: null },
      completed: { count: 3, oldestAgeMs: null },
      escalated: { count: 1, oldestAgeMs: null },
      dead_letter: { count: 0, oldestAgeMs: null },
      cancelled: { count: 0, oldestAgeMs: null },
    },
  },
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
      automation: {
        jobs: {
          cancelled: 0,
          completed: 3,
          deadLetter: 0,
          escalated: 1,
          executing: 0,
          leased: 0,
          pending: 2,
          retryWait: 0,
        },
        oldestPendingAgeMs: null,
        routes: { automatic: 3, escalation: 1, owner: 2 },
        sends: { deliveryUnknown: 0, failed: 1, sent: 4 },
      },
      claimsEnabled: true,
      gatesReady: true,
      jobCreationEnabled: true,
      pendingJobs: 2,
      privacyGatePassed: true,
      reachable: true,
      runnerFresh: true,
      runnerLastSeenAt: "2026-08-06T08:59:59.000Z",
      runnerReady: true,
      shadowModeEnabled: true,
    });

    expect(read).toHaveBeenCalledWith(enabledConfig.credentialBlobPath);
    expect(apiClientFactory).toHaveBeenCalledWith(enabledConfig, "raw-service-token");
    expect(get).toHaveBeenCalledWith("/support-automation/health");
  });

  it("fails the readiness gate for a stale or future runner heartbeat", async () => {
    for (const runnerLastSeenAt of [
      "2026-08-06T08:58:59.999Z",
      "2026-08-06T09:00:01.000Z",
      null,
    ]) {
      await expect(runSupportAutopilotLocalHealth({}, {
        apiClientFactory: () => ({
          get: vi.fn().mockResolvedValue({ ...validHealth, runnerLastSeenAt }),
        }),
        loadConfig: () => enabledConfig,
        secretProvider: { read: vi.fn().mockResolvedValue("raw-service-token") },
      })).resolves.toMatchObject({
        gatesReady: false,
        runnerFresh: false,
      });
    }
  });

  it("reports false readiness when a server gate or attestation does not match", async () => {
    await expect(runSupportAutopilotLocalHealth({}, {
      apiClientFactory: () => ({
        get: vi.fn().mockResolvedValue({
          ...validHealth,
          claimsEnabled: false,
          privacyAttestationId: "different-attestation",
        }),
      }),
      loadConfig: () => enabledConfig,
      secretProvider: { read: vi.fn().mockResolvedValue("raw-service-token") },
    })).resolves.toMatchObject({
      claimsEnabled: false,
      gatesReady: false,
    });
  });

  it("rejects missing or malformed required provider response fields", async () => {
    for (const response of [
      { ...validHealth, activeLeases: undefined },
      { ...validHealth, claimsEnabled: "true" },
      { ...validHealth, pendingJobs: 999 },
    ]) {
      await expect(runSupportAutopilotLocalHealth({}, {
        apiClientFactory: () => ({ get: vi.fn().mockResolvedValue(response) }),
        loadConfig: () => enabledConfig,
        secretProvider: { read: vi.fn().mockResolvedValue("raw-service-token") },
      })).rejects.toThrow("SUPPORT_AUTOPILOT_LOCAL_HEALTH_FAILED");
    }
  });

  it("accepts additive provider diagnostics without exposing them", async () => {
    const response = {
      ...validHealth,
      customerId: 123,
      ticketId: "must-not-leak",
      oldestQueuedAgeMs: null,
      runnerAgeMs: 1_000,
      runnerFresh: true,
    };

    const result = await runSupportAutopilotLocalHealth({}, {
      apiClientFactory: () => ({ get: vi.fn().mockResolvedValue(response) }),
      loadConfig: () => enabledConfig,
      secretProvider: { read: vi.fn().mockResolvedValue("raw-service-token") },
    });

    expect(result.gatesReady).toBe(true);
    expect(result).not.toHaveProperty("level1");
    expect(result).not.toHaveProperty("oldestQueuedAgeMs");
    expect(result).not.toHaveProperty("runnerAgeMs");
    expect(result).not.toHaveProperty("customerId");
    expect(result).not.toHaveProperty("ticketId");
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
