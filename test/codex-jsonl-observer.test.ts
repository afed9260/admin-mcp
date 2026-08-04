import { describe, expect, it } from "vitest";
import { CodexJsonlObserver } from "../src/runner/codex-jsonl-observer.js";

function decisionEvent(status = "completed", error: unknown = null) {
  return JSON.stringify({
    item: {
      error,
      server: "support-autopilot",
      status,
      tool: "submit_support_automation_decision",
      type: "mcp_tool_call",
    },
    type: "item.completed",
  });
}

describe("CodexJsonlObserver", () => {
  it("handles fragmented lines and returns counters only", () => {
    const observer = new CodexJsonlObserver();
    const line = decisionEvent();
    observer.push(Buffer.from(line.slice(0, 13)));
    observer.push(Buffer.from(`${line.slice(13)}\n`));

    expect(observer.finish()).toEqual({
      failedToolCalls: 0,
      successfulDecisionSubmissions: 1,
      toolCalls: 1,
      totalLines: 1,
    });
  });

  it.each([
    ["malformed JSON", [Buffer.from("not-json\n")], {}],
    ["line cap", [Buffer.from("{}\n{}\n")], { maxLines: 1 }],
    ["line byte cap", [Buffer.from(`${JSON.stringify({ payload: "secret" })}\n`)], { maxLineBytes: 8 }],
    ["output cap", [Buffer.from("{}\n")], { maxBytes: 2 }],
  ])("fails closed for %s without exposing content", (_name, chunks, options) => {
    const observer = new CodexJsonlObserver(options);
    let failure: unknown;
    try {
      for (const chunk of chunks) {
        observer.push(chunk);
      }
      observer.finish();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("CODEX_JSONL_INVALID");
    expect(JSON.stringify(failure)).not.toContain("secret");
  });

  it("counts failed decision calls without retaining arguments or results", () => {
    const observer = new CodexJsonlObserver();
    observer.push(Buffer.from(`${decisionEvent("failed", { message: "ticket secret" })}\n`));
    expect(observer.finish()).toEqual({
      failedToolCalls: 1,
      successfulDecisionSubmissions: 0,
      toolCalls: 1,
      totalLines: 1,
    });
  });
});
