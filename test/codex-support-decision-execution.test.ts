import { describe, expect, it, vi } from "vitest";
import {
  CodexSupportDecisionError,
  runCodexSupportDecision,
} from "../src/runner/codex-support-decision-execution.js";
import type { CodexProcessInput, CodexProcessRunner } from "../src/runner/codex-process-runner.js";

function toolEvent(tool: string, status = "completed", error: unknown = null): string {
  return JSON.stringify({
    item: { error, server: "support-autopilot", status, tool, type: "mcp_tool_call" },
    type: "item.completed",
  });
}

function runner(stdout: string) {
  const run = vi.fn().mockResolvedValue({
    exitCode: 0,
    stderr: "",
    stdout,
    timedOut: false,
  });
  return { run } as CodexProcessRunner & { run: typeof run };
}

function executionConfig(overrides: Record<string, unknown> = {}) {
  return {
    childEnvironment: { CODEX_HOME: "C:\\Synthetic\\codex-home" },
    codexExecutablePath: "C:\\Tools\\codex.exe",
    processTimeoutMs: 120_000,
    runtimeDir: "C:\\Synthetic\\runtime",
    workerId: "support-synthetic.1",
    workKind: "initial" as const,
    ...overrides,
  };
}

describe("runCodexSupportDecision", () => {
  it.each([
    ["missing decision", `${toolEvent("claim_support_automation_job")}\n`, {}, "decision_count_invalid"],
    ["too many tool failures", [
      toolEvent("submit_support_automation_decision", "failed"),
      toolEvent("submit_support_automation_decision", "failed"),
      toolEvent("submit_support_automation_decision", "failed"),
      toolEvent("submit_support_automation_decision"),
      "",
    ].join("\n"), {}, "tool_failure_budget_exceeded"],
    ["nonzero exit", `${toolEvent("submit_support_automation_decision")}\n`, { exitCode: 1 }, "process_exit_nonzero"],
    ["timeout", `${toolEvent("submit_support_automation_decision")}\n`, { timedOut: true }, "process_timeout"],
    ["malformed JSONL", "customer secret\n", {}, "jsonl_invalid"],
  ])("classifies %s without exposing process output", async (_name, stdout, override, stage) => {
    const processRunner = runner(stdout);
    processRunner.run.mockResolvedValueOnce({
      exitCode: 0,
      stderr: "provider secret",
      stdout,
      timedOut: false,
      ...override,
    });

    const failure = await runCodexSupportDecision(
      executionConfig(),
      processRunner,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CodexSupportDecisionError);
    expect(failure).toMatchObject({ stage });
    expect(JSON.stringify(failure)).not.toMatch(/customer secret|provider secret/);
  });

  it("classifies process launch failures without exposing the original error", async () => {
    const processRunner = runner("");
    processRunner.run.mockRejectedValueOnce(new Error("process secret"));

    const failure = await runCodexSupportDecision(
      executionConfig(),
      processRunner,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CodexSupportDecisionError);
    expect(failure).toMatchObject({ stage: "process_launch_failed" });
    expect(JSON.stringify(failure)).not.toContain("process secret");
  });

  it("does not mark an invocation before the process input is fully validated", async () => {
    const processRunner = runner("");
    const onProcessInvocationStarted = vi.fn();

    await expect(runCodexSupportDecision(executionConfig({
      onProcessInvocationStarted,
      workKind: "revision",
    }), processRunner)).rejects.toMatchObject({ stage: "process_launch_failed" });

    expect(onProcessInvocationStarted).not.toHaveBeenCalled();
    expect(processRunner.run).not.toHaveBeenCalled();
  });

  it("runs one restricted decision and returns only the validated summary", async () => {
    const processRunner = runner([
      toolEvent("claim_support_automation_job"),
      toolEvent("submit_support_automation_decision"),
      "",
    ].join("\n"));

    await expect(runCodexSupportDecision(executionConfig(), processRunner)).resolves.toEqual({
      failedToolCalls: 0,
      successfulInitialClaims: 1,
      successfulDecisionSubmissions: 1,
      successfulInitialDecisionSubmissions: 1,
      successfulRevisionClaims: 0,
      successfulRevisionLeaseRenewals: 0,
      successfulRevisionSubmissions: 0,
      toolCalls: 2,
      totalLines: 2,
    });

    const input = processRunner.run.mock.calls[0][0] as CodexProcessInput;
    expect(input.args).toContain("read-only");
    expect(input.args).toEqual(expect.arrayContaining([
      "--disable", "shell_tool",
      "--disable", "web_search_request",
      "--config", "mcp_servers.support-autopilot.default_tools_approval_mode=\"approve\"",
      "--ephemeral",
      "--json",
      "--cd", "C:\\Synthetic\\runtime",
      "-",
    ]));
    expect(input.args.indexOf("--config")).toBeLessThan(input.args.indexOf("exec"));
    expect(input.environment).toEqual({
      CODEX_HOME: "C:\\Synthetic\\codex-home",
      SUPPORT_AUTOPILOT_WORK_KIND: "initial",
    });
    expect(input.stdin).toContain("support-synthetic.1");
    expect(input.stdin).toContain("top-level arguments");
    expect(input.stdin).toContain("never nest them under a decision object");
    expect(input.stdin).not.toContain("submit_support_automation_revision");
    expect(input.stdin).not.toMatch(/ticket|leaseToken|proposedReply/i);
    expect(input.maxOutputBytes).toBe(16 * 1024 * 1024);
  });

  it("accepts at most two failed calls when Codex recovers and submits exactly one decision", async () => {
    const processRunner = runner([
      toolEvent("submit_support_automation_decision", "failed"),
      toolEvent("submit_support_automation_decision"),
      "",
    ].join("\n"));

    await expect(runCodexSupportDecision(executionConfig(), processRunner)).resolves.toMatchObject({
      failedToolCalls: 1,
      successfulDecisionSubmissions: 1,
      toolCalls: 2,
    });
  });

  it("rejects more than two recovered tool failures", async () => {
    const processRunner = runner([
      toolEvent("submit_support_automation_decision", "failed"),
      toolEvent("submit_support_automation_decision", "failed"),
      toolEvent("submit_support_automation_decision", "failed"),
      toolEvent("submit_support_automation_decision"),
      "",
    ].join("\n"));

    await expect(runCodexSupportDecision(executionConfig(), processRunner)).rejects.toThrow();
  });

  it.each([
    ["missing decision", `${toolEvent("claim_support_automation_job")}\n`, {}],
    ["two decisions", `${toolEvent("submit_support_automation_decision")}\n${toolEvent("submit_support_automation_decision")}\n`, {}],
    ["failed tool", `${toolEvent("submit_support_automation_decision", "failed", { message: "synthetic failure" })}\n`, {}],
    ["nonzero exit", `${toolEvent("submit_support_automation_decision")}\n`, { exitCode: 1 }],
    ["timeout", `${toolEvent("submit_support_automation_decision")}\n`, { timedOut: true }],
  ])("fails closed for %s", async (_name, stdout, override) => {
    const processRunner = runner(stdout);
    processRunner.run.mockResolvedValueOnce({
      exitCode: 0,
      stderr: "",
      stdout,
      timedOut: false,
      ...override,
    });

    await expect(runCodexSupportDecision(executionConfig(), processRunner)).rejects.toThrow();
  });

  it("accepts one assigned revision submit and rejects mixed or model-rotated flows", async () => {
    const assignedRevision = {
      revisionJobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      leaseToken: "A".repeat(43),
    };
    const validRunner = runner(`${toolEvent("submit_support_automation_revision")}\n`);

    await expect(runCodexSupportDecision(executionConfig({
      assignedRevision,
      workKind: "revision",
    }), validRunner)).resolves.toMatchObject({
      successfulInitialDecisionSubmissions: 0,
      successfulRevisionSubmissions: 1,
    });
    const prompt = (validRunner.run.mock.calls[0][0] as CodexProcessInput).stdin ?? "";
    expect(prompt).toContain(assignedRevision.revisionJobId);
    expect(prompt).toContain(assignedRevision.leaseToken);
    expect(prompt).toContain("priorDraft");
    expect(prompt).toContain("executionAuthorized=false");
    expect(prompt).not.toContain(
      "Call submit_support_automation_decision with all schema fields",
    );
    expect(prompt).toContain(
      "Call submit_support_automation_revision with all schema fields",
    );
    expect(prompt).not.toContain("claim_support_automation_revision");
    expect(prompt).not.toContain("renew_support_automation_revision_lease");
    expect(prompt).not.toContain("submit_support_automation_decision with all schema fields");

    for (const output of [
      `${toolEvent("submit_support_automation_decision")}\n`,
      `${toolEvent("submit_support_automation_revision")}\n${toolEvent("submit_support_automation_decision")}\n`,
      `${toolEvent("claim_support_automation_revision")}\n${toolEvent("submit_support_automation_revision")}\n`,
      `${toolEvent("renew_support_automation_revision_lease")}\n${toolEvent("submit_support_automation_revision")}\n`,
    ]) {
      await expect(runCodexSupportDecision(executionConfig({
        assignedRevision,
        workKind: "revision",
      }), runner(output))).rejects.toMatchObject({ stage: "decision_count_invalid" });
    }
  });
});
