import { describe, expect, it, vi } from "vitest";
import { CodexShadowWorker, type CodexShadowWorkerEvent } from "../src/runner/codex-shadow-worker.js";
import type { CodexProcessInput, CodexProcessRunner } from "../src/runner/codex-process-runner.js";
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

function toolEvent(tool: string, status = "completed", error: unknown = null) {
  return JSON.stringify({
    item: { error, server: "support-autopilot", status, tool, type: "mcp_tool_call" },
    type: "item.completed",
  });
}

function runner(stdout: string, override: Record<string, unknown> = {}) {
  const run = vi.fn().mockResolvedValue({
    exitCode: 0,
    stderr: "",
    stdout,
    timedOut: false,
    ...override,
  });
  return { run } as CodexProcessRunner & { run: typeof run };
}

describe("CodexShadowWorker", () => {
  it("succeeds only after exactly one completed shadow decision", async () => {
    const processRunner = runner(`${toolEvent("claim_support_automation_job")}\n${toolEvent("submit_support_automation_decision")}\n`);
    const events: CodexShadowWorkerEvent[] = [];
    const worker = new CodexShadowWorker(config, processRunner, (event) => events.push(event));

    await expect(worker.runOne()).resolves.toEqual({
      failedToolCalls: 0,
      successfulDecisionSubmissions: 1,
      toolCalls: 2,
    });
    const input = processRunner.run.mock.calls[0][0] as CodexProcessInput;
    expect(input.stdin).toContain("support-shadow.1");
    expect(input.stdin).toContain("Read the current context before submitting");
    expect(input.stdin).not.toMatch(/leaseToken|proposedReply/i);
    expect(input.args).toContain("read-only");
    expect(input.maxOutputBytes).toBe(16 * 1024 * 1024);
    expect(JSON.stringify(events)).not.toMatch(/stdout|stderr|prompt|ticket|message|lease|reply/i);
  });

  it("reports a bounded recovered tool failure without relabeling the recorded decision as failed", async () => {
    const processRunner = runner([
      toolEvent("submit_support_automation_decision", "failed"),
      toolEvent("submit_support_automation_decision"),
      "",
    ].join("\n"));
    const events: CodexShadowWorkerEvent[] = [];
    const worker = new CodexShadowWorker(config, processRunner, (event) => events.push(event));

    await expect(worker.runOne()).resolves.toEqual({
      failedToolCalls: 1,
      successfulDecisionSubmissions: 1,
      toolCalls: 2,
    });
    expect(events).toContainEqual(expect.objectContaining({
      eventCode: "codex_shadow_run_completed",
      failedToolCallCount: 1,
    }));
  });

  it.each([
    ["missing decision", `${toolEvent("claim_support_automation_job")}\n`, {}],
    ["two decisions", `${toolEvent("submit_support_automation_decision")}\n${toolEvent("submit_support_automation_decision")}\n`, {}],
    ["failed tool", `${toolEvent("submit_support_automation_decision", "failed", { message: "secret" })}\n`, {}],
    ["nonzero exit", `${toolEvent("submit_support_automation_decision")}\n`, { exitCode: 1 }],
    ["timeout", `${toolEvent("submit_support_automation_decision")}\n`, { timedOut: true }],
  ])("fails closed for %s with a redacted event", async (_name, stdout, override) => {
    const events: CodexShadowWorkerEvent[] = [];
    const worker = new CodexShadowWorker(config, runner(stdout, override), (event) => events.push(event));
    await expect(worker.runOne()).rejects.toThrow("SUPPORT_AUTOPILOT_CODEX_RUN_FAILED");
    expect(JSON.stringify(events)).not.toMatch(/secret|stdout|stderr|prompt|ticket|message|lease|reply/i);
  });

  it("converts malformed JSONL to a redacted failure", async () => {
    const events: CodexShadowWorkerEvent[] = [];
    const worker = new CodexShadowWorker(
      config,
      runner("customer secret\n"),
      (event) => events.push(event),
    );
    await expect(worker.runOne()).rejects.toThrow("SUPPORT_AUTOPILOT_CODEX_RUN_FAILED");
    expect(events).toContainEqual(expect.objectContaining({
      eventCode: "codex_shadow_run_failed",
      failureCode: "CODEX_RUN_INVALID",
      failureStage: "jsonl_invalid",
    }));
    expect(JSON.stringify(events)).not.toContain("customer secret");
  });
});
