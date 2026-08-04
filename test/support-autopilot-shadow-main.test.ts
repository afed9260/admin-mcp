import { describe, expect, it, vi } from "vitest";
import { runSupportAutopilotShadowMain, type SupportAutopilotShadowMainEvent } from "../src/runner/support-autopilot-shadow-main.js";
import type { SupportAutopilotShadowRunnerConfig } from "../src/runner/support-autopilot-shadow-runner.config.js";

const config: Extract<SupportAutopilotShadowRunnerConfig, { enabled: true }> = {
  adminApiBaseUrl: "https://admin.example.test/new-admin",
  budgetStatePath: "C:\\ServiceData\\budget.json",
  codexExecutablePath: "C:\\Tools\\codex.exe",
  codexHome: "C:\\ServiceData\\codex-home",
  credentialBlobPath: "C:\\ServiceSecrets\\token.dpapi",
  dailyBudget: 25,
  enabled: true,
  mcpLauncherPath: "C:\\ServiceApp\\launcher.js",
  nodeExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
  privacyAttestationExpiresAt: "2026-08-30T00:00:00.000Z",
  privacyAttestationId: "support-privacy-v1",
  privacyAttestationPath: "C:\\ServiceData\\privacy.json",
  processTimeoutMs: 1_200_000,
  runtimeDir: "C:\\ServiceData\\runtime",
  workerId: "support-shadow.1",
};

describe("runSupportAutopilotShadowMain", () => {
  it("exits dormant before any side effect when disabled", async () => {
    const preflight = vi.fn();
    await expect(runSupportAutopilotShadowMain({}, {
      loadConfig: () => ({ enabled: false }),
      preflight: { run: preflight },
    })).resolves.toEqual({ outcome: "disabled", ticks: 0 });
    expect(preflight).not.toHaveBeenCalled();
  });

  it("runs preflight, availability, budget, and one worker in order", async () => {
    const order: string[] = [];
    const abort = new AbortController();
    const post = vi.fn(async () => {
      order.push("availability");
      return { retryAfterMs: 5_000, workAvailable: true };
    });
    const events: SupportAutopilotShadowMainEvent[] = [];
    const result = await runSupportAutopilotShadowMain({}, {
      apiClientFactory: () => ({ post }),
      budget: { reserve: vi.fn(async () => { order.push("budget"); return true; }) },
      loadConfig: () => config,
      logger: (event) => events.push(event),
      preflight: { run: vi.fn(async () => { order.push("preflight"); return { outcome: "ready" as const }; }) },
      secretProvider: { read: vi.fn(async () => { order.push("credential"); return "service-secret"; }) },
      signal: abort.signal,
      sleep: vi.fn(async () => { abort.abort(); }),
      worker: { runOne: vi.fn(async () => { order.push("worker"); }) },
    });

    expect(result).toEqual({ outcome: "stopped", ticks: 1 });
    expect(order).toEqual(["preflight", "credential", "availability", "budget", "worker"]);
    expect(post).toHaveBeenCalledWith("/support-automation/work-availability", {
      workerId: "support-shadow.1",
    });
    expect(JSON.stringify(events)).not.toMatch(/service-secret|ticket|message|lease|reply|token/i);
  });

  it("never invokes Codex when the durable daily budget is exhausted", async () => {
    const abort = new AbortController();
    const runOne = vi.fn();
    const events: SupportAutopilotShadowMainEvent[] = [];
    await runSupportAutopilotShadowMain({}, {
      apiClientFactory: () => ({
        post: vi.fn().mockResolvedValue({ retryAfterMs: 5_000, workAvailable: true }),
      }),
      budget: { reserve: vi.fn().mockResolvedValue(false) },
      loadConfig: () => config,
      logger: (event) => events.push(event),
      preflight: { run: vi.fn().mockResolvedValue({ outcome: "ready" }) },
      secretProvider: { read: vi.fn().mockResolvedValue("service-secret") },
      signal: abort.signal,
      sleep: vi.fn(async () => { abort.abort(); }),
      worker: { runOne },
    });

    expect(runOne).not.toHaveBeenCalled();
    expect(events).toEqual(expect.arrayContaining([
      { eventCode: "shadow_daily_budget_exhausted" },
    ]));
  });

  it("does not decrypt credentials when preflight fails", async () => {
    const read = vi.fn();
    await expect(runSupportAutopilotShadowMain({}, {
      loadConfig: () => config,
      preflight: { run: vi.fn().mockRejectedValue(new Error("raw preflight output")) },
      secretProvider: { read },
    })).rejects.toThrow("SUPPORT_AUTOPILOT_SHADOW_MAIN_FAILED");
    expect(read).not.toHaveBeenCalled();
  });
});
