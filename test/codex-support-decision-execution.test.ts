import { describe, expect, it, vi } from "vitest";
import { runCodexSupportDecision } from "../src/runner/codex-support-decision-execution.js";
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

describe("runCodexSupportDecision", () => {
  it("runs one restricted decision and returns only the validated summary", async () => {
    const processRunner = runner([
      toolEvent("claim_support_automation_job"),
      toolEvent("submit_support_automation_decision"),
      "",
    ].join("\n"));

    await expect(runCodexSupportDecision({
      childEnvironment: { CODEX_HOME: "C:\\Synthetic\\codex-home" },
      codexExecutablePath: "C:\\Tools\\codex.exe",
      processTimeoutMs: 120_000,
      runtimeDir: "C:\\Synthetic\\runtime",
      workerId: "support-synthetic.1",
    }, processRunner)).resolves.toEqual({
      failedToolCalls: 0,
      successfulDecisionSubmissions: 1,
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
    expect(input.environment).toEqual({ CODEX_HOME: "C:\\Synthetic\\codex-home" });
    expect(input.stdin).toContain("support-synthetic.1");
    expect(input.stdin).toContain("top-level arguments");
    expect(input.stdin).toContain("never nest them under a decision object");
    expect(input.stdin).not.toMatch(/ticket|leaseToken|proposedReply/i);
    expect(input.maxOutputBytes).toBe(16 * 1024 * 1024);
  });

  it("accepts at most two failed calls when Codex recovers and submits exactly one decision", async () => {
    const processRunner = runner([
      toolEvent("submit_support_automation_decision", "failed"),
      toolEvent("submit_support_automation_decision"),
      "",
    ].join("\n"));

    await expect(runCodexSupportDecision({
      childEnvironment: { CODEX_HOME: "C:\\Synthetic\\codex-home" },
      codexExecutablePath: "C:\\Tools\\codex.exe",
      processTimeoutMs: 120_000,
      runtimeDir: "C:\\Synthetic\\runtime",
      workerId: "support-synthetic.1",
    }, processRunner)).resolves.toMatchObject({
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

    await expect(runCodexSupportDecision({
      childEnvironment: { CODEX_HOME: "C:\\Synthetic\\codex-home" },
      codexExecutablePath: "C:\\Tools\\codex.exe",
      processTimeoutMs: 120_000,
      runtimeDir: "C:\\Synthetic\\runtime",
      workerId: "support-synthetic.1",
    }, processRunner)).rejects.toThrow();
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

    await expect(runCodexSupportDecision({
      childEnvironment: { CODEX_HOME: "C:\\Synthetic\\codex-home" },
      codexExecutablePath: "C:\\Tools\\codex.exe",
      processTimeoutMs: 120_000,
      runtimeDir: "C:\\Synthetic\\runtime",
      workerId: "support-synthetic.1",
    }, processRunner)).rejects.toThrow();
  });
});
