import { describe, expect, it, vi } from "vitest";
import type { CodexProcessRunner } from "../src/runner/codex-process-runner.js";
import {
  runSupportAutopilotSyntheticCanary,
} from "../src/synthetic/support-autopilot-synthetic-canary-main.js";
import type {
  SupportAutopilotSyntheticCanaryConfig,
} from "../src/synthetic/support-autopilot-synthetic-canary.config.js";

type EnabledConfig = Extract<SupportAutopilotSyntheticCanaryConfig, { enabled: true }>;

const config: EnabledConfig = {
  codexExecutablePath: "C:\\Tools\\codex.exe",
  codexHome: "C:\\Synthetic\\codex-home",
  enabled: true,
  mcpEntryPath: "C:\\Repo\\dist\\synthetic-mcp.js",
  nodeExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
  processTimeoutMs: 120_000,
  runtimeDir: "C:\\Synthetic\\runtime",
  workerId: "support-synthetic.1",
};

const unusedProcessRunner: CodexProcessRunner = {
  run: vi.fn(async () => {
    throw new Error("unexpected process invocation");
  }),
};

describe("runSupportAutopilotSyntheticCanary", () => {
  it("is dormant before every side effect unless explicitly enabled", async () => {
    const preflight = vi.fn();
    const execute = vi.fn();

    await expect(runSupportAutopilotSyntheticCanary({}, {
      execute,
      loadConfig: () => ({ enabled: false }),
      preflight: { run: preflight },
      processRunner: unusedProcessRunner,
    })).resolves.toEqual({ outcome: "disabled" });

    expect(preflight).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("preflights first, executes exactly once, and returns only a redacted summary", async () => {
    const order: string[] = [];
    const preflight = vi.fn(async () => {
      order.push("preflight");
      return { outcome: "ready" as const };
    });
    const execute = vi.fn(async () => {
      order.push("execute");
      return {
        failedToolCalls: 0,
        successfulDecisionSubmissions: 1,
        toolCalls: 4,
        totalLines: 8,
      };
    });

    const result = await runSupportAutopilotSyntheticCanary({}, {
      clock: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(35),
      execute,
      loadConfig: () => config,
      preflight: { run: preflight },
      processRunner: unusedProcessRunner,
    });

    expect(order).toEqual(["preflight", "execute"]);
    expect(preflight).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      childEnvironment: expect.objectContaining({ CODEX_HOME: config.codexHome }),
      codexExecutablePath: config.codexExecutablePath,
      processTimeoutMs: config.processTimeoutMs,
      runtimeDir: config.runtimeDir,
      workerId: config.workerId,
      workKind: "initial",
    }, unusedProcessRunner);
    expect(result).toEqual({
      durationMs: 25,
      failedToolCalls: 0,
      outcome: "passed",
      successfulDecisionSubmissions: 1,
      toolCalls: 4,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /ticket|message|lease|reply|stdout|stderr|token|авито|переподключ/i,
    );
  });

  it("surfaces a bounded recovered tool failure in the redacted success summary", async () => {
    const result = await runSupportAutopilotSyntheticCanary({}, {
      clock: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(20),
      execute: vi.fn().mockResolvedValue({
        failedToolCalls: 1,
        successfulDecisionSubmissions: 1,
        toolCalls: 5,
        totalLines: 12,
      }),
      loadConfig: () => config,
      preflight: { run: vi.fn().mockResolvedValue({ outcome: "ready" }) },
      processRunner: unusedProcessRunner,
    });

    expect(result).toEqual({
      durationMs: 10,
      failedToolCalls: 1,
      outcome: "passed",
      successfulDecisionSubmissions: 1,
      toolCalls: 5,
    });
  });

  it.each([
    ["configuration", { loadConfig: () => { throw new Error("raw config"); } }],
    ["preflight", {
      loadConfig: () => config,
      preflight: { run: async () => { throw new Error("raw preflight"); } },
    }],
    ["execution", {
      execute: async () => { throw new Error("raw output"); },
      loadConfig: () => config,
      preflight: { run: async () => ({ outcome: "ready" as const }) },
    }],
  ])("collapses %s failures", async (_name, dependencies) => {
    await expect(runSupportAutopilotSyntheticCanary({}, {
      processRunner: unusedProcessRunner,
      ...dependencies,
    })).rejects.toThrow("SUPPORT_AUTOPILOT_SYNTHETIC_CANARY_FAILED");
  });
});
