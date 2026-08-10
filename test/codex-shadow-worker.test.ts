import { describe, expect, it, vi } from "vitest";
import {
  CodexShadowWorker,
  CodexShadowWorkerFailure,
  type CodexShadowWorkerEvent,
  type SupportRevisionHostClient,
} from "../src/runner/codex-shadow-worker.js";
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

const REVISION_JOB_ID = "70000000-0000-4000-8000-000000000007";
const CLAIMED_REVISION_TOKEN = "C".repeat(43);
const RENEWED_REVISION_TOKEN = "R".repeat(43);
const NOW = new Date("2026-08-09T10:00:00.000Z");

function revisionClient(overrides: Partial<SupportRevisionHostClient> = {}) {
  return {
    claimSupportAutomationRevision: vi.fn().mockResolvedValue({
      attemptCount: 1,
      leaseExpiresAt: "2026-08-09T10:02:00.000Z",
      leaseToken: CLAIMED_REVISION_TOKEN,
      revisionJobId: REVISION_JOB_ID,
      sequence: 1,
    }),
    failSupportAutomationRevision: vi.fn().mockResolvedValue({
      customerAction: "none",
      outcome: "retry_scheduled",
      revisionStatus: "retry_wait",
      ticketMutation: false,
    }),
    renewSupportAutomationRevisionLease: vi.fn().mockResolvedValue({
      leaseExpiresAt: "2026-08-09T10:02:00.000Z",
      leaseToken: RENEWED_REVISION_TOKEN,
      revisionJobId: REVISION_JOB_ID,
    }),
    ...overrides,
  } satisfies SupportRevisionHostClient;
}

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
    expect(input.stdin).not.toMatch(/ticket|leaseToken|proposedReply/i);
    expect(input.args).toContain("read-only");
    expect(input.maxOutputBytes).toBe(16 * 1024 * 1024);
    expect(JSON.stringify(events)).not.toMatch(/stdout|stderr|prompt|ticket|message|lease|reply/i);
  });

  it("reports a bounded recovered tool failure without relabeling the recorded decision as failed", async () => {
    const processRunner = runner([
      toolEvent("claim_support_automation_job"),
      toolEvent("submit_support_automation_decision", "failed"),
      toolEvent("submit_support_automation_decision"),
      "",
    ].join("\n"));
    const events: CodexShadowWorkerEvent[] = [];
    const worker = new CodexShadowWorker(config, processRunner, (event) => events.push(event));

    await expect(worker.runOne()).resolves.toEqual({
      failedToolCalls: 1,
      successfulDecisionSubmissions: 1,
      toolCalls: 3,
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

  it("runs revision work with the host-claimed renewed lease and a bounded process window", async () => {
    const processRunner = runner(`${toolEvent("get_support_automation_revision_context")}\n${toolEvent("submit_support_automation_revision")}\n`);
    const client = revisionClient();
    const events: CodexShadowWorkerEvent[] = [];
    const worker = new CodexShadowWorker(
      config,
      processRunner,
      (event) => events.push(event),
      client,
      () => NOW,
    );

    await expect(worker.runOne("revision")).resolves.toEqual({
      failedToolCalls: 0,
      successfulDecisionSubmissions: 1,
      toolCalls: 2,
    });

    expect(client.claimSupportAutomationRevision).toHaveBeenCalledOnce();
    expect(client.renewSupportAutomationRevisionLease).toHaveBeenCalledWith({
      leaseToken: CLAIMED_REVISION_TOKEN,
      revisionJobId: REVISION_JOB_ID,
      workerId: config.workerId,
    });
    expect(client.failSupportAutomationRevision).not.toHaveBeenCalled();
    const input = processRunner.run.mock.calls[0][0] as CodexProcessInput;
    expect(input.timeoutMs).toBe(115_000);
    expect(input.stdin).toContain(REVISION_JOB_ID);
    expect(input.stdin).toContain(RENEWED_REVISION_TOKEN);
    expect(input.stdin).toContain("never claim or renew");
    expect(events).toContainEqual(expect.objectContaining({
      eventCode: "codex_shadow_run_completed",
      workKind: "revision",
    }));
    expect(JSON.stringify(events)).not.toMatch(new RegExp(`${REVISION_JOB_ID}|${RENEWED_REVISION_TOKEN}`));
  });

  it.each([
    ["process_timeout", { timedOut: true }, "runner_timeout"],
    ["runner_output_invalid", { stdout: "invalid jsonl\n" }, "runner_output_invalid"],
    ["runner_process_failed", { exitCode: 1 }, "runner_process_failed"],
  ])("reports a bounded revision failure for %s", async (_name, override, failureCode) => {
    const client = revisionClient();
    const processRunner = runner(
      `${toolEvent("submit_support_automation_revision")}\n`,
      override,
    );
    const worker = new CodexShadowWorker(
      config,
      processRunner,
      undefined,
      client,
      () => NOW,
    );

    await expect(worker.runOne("revision")).rejects.toThrow(
      "SUPPORT_AUTOPILOT_CODEX_RUN_FAILED",
    );
    expect(client.failSupportAutomationRevision).toHaveBeenCalledWith({
      failureCode,
      leaseToken: RENEWED_REVISION_TOKEN,
      revisionJobId: REVISION_JOB_ID,
      workerId: config.workerId,
    });
  });

  it("fails closed before Codex when the renewed revision identity does not match the claim", async () => {
    const client = revisionClient({
      renewSupportAutomationRevisionLease: vi.fn().mockResolvedValue({
        leaseExpiresAt: "2026-08-09T10:02:00.000Z",
        leaseToken: RENEWED_REVISION_TOKEN,
        revisionJobId: "80000000-0000-4000-8000-000000000008",
      }),
    });
    const processRunner = runner(`${toolEvent("submit_support_automation_revision")}\n`);
    const worker = new CodexShadowWorker(
      config,
      processRunner,
      undefined,
      client,
      () => NOW,
    );

    const failure = await worker.runOne("revision").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CodexShadowWorkerFailure);
    expect(failure).toMatchObject({ processInvocationStarted: false });
    expect(processRunner.run).not.toHaveBeenCalled();
    expect(client.failSupportAutomationRevision).not.toHaveBeenCalled();
  });

  it("does not use revision host operations for initial work", async () => {
    const processRunner = runner(`${toolEvent("claim_support_automation_job")}\n${toolEvent("submit_support_automation_decision")}\n`);
    const client = revisionClient();
    const worker = new CodexShadowWorker(config, processRunner, undefined, client);

    await expect(worker.runOne("initial")).resolves.toEqual(expect.objectContaining({
      successfulDecisionSubmissions: 1,
    }));
    expect(client.claimSupportAutomationRevision).not.toHaveBeenCalled();
    expect(client.renewSupportAutomationRevisionLease).not.toHaveBeenCalled();
    expect(client.failSupportAutomationRevision).not.toHaveBeenCalled();
  });

  it("marks a process-runner attempt as an invocation even when launch fails", async () => {
    const processRunner = runner("");
    processRunner.run.mockRejectedValueOnce(new Error("launch failed"));
    const worker = new CodexShadowWorker(config, processRunner);

    const failure = await worker.runOne("initial").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CodexShadowWorkerFailure);
    expect(failure).toMatchObject({ processInvocationStarted: true });
  });
});
