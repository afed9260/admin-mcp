import { performance } from "node:perf_hooks";
import { runCodexSupportDecision } from "./codex-support-decision-execution.js";
import { createCodexChildEnvironment } from "./codex-shadow-preflight.js";
import type { CodexProcessRunner } from "./codex-process-runner.js";
import type { SupportAutopilotShadowRunnerConfig } from "./support-autopilot-shadow-runner.config.js";

type EnabledConfig = Extract<SupportAutopilotShadowRunnerConfig, { enabled: true }>;

export type CodexShadowWorkerEvent =
  | {
    durationMs: number;
    eventCode: "codex_shadow_run_completed";
    failedToolCallCount: number;
    toolCallCount: number;
  }
  | { durationMs: number; eventCode: "codex_shadow_run_failed"; failureCode: "CODEX_RUN_INVALID" };

export class CodexShadowWorker {
  constructor(
    private readonly config: EnabledConfig,
    private readonly processRunner: CodexProcessRunner,
    private readonly logger: (event: CodexShadowWorkerEvent) => void = () => undefined,
  ) {}

  async runOne(): Promise<{
    failedToolCalls: number;
    successfulDecisionSubmissions: 1;
    toolCalls: number;
  }> {
    const startedAt = performance.now();
    try {
      const summary = await runCodexSupportDecision({
        childEnvironment: createCodexChildEnvironment(this.config),
        codexExecutablePath: this.config.codexExecutablePath,
        processTimeoutMs: this.config.processTimeoutMs,
        runtimeDir: this.config.runtimeDir,
        workerId: this.config.workerId,
      }, this.processRunner);
      this.log({
        durationMs: Math.round(performance.now() - startedAt),
        eventCode: "codex_shadow_run_completed",
        failedToolCallCount: summary.failedToolCalls,
        toolCallCount: summary.toolCalls,
      });
      return {
        failedToolCalls: summary.failedToolCalls,
        successfulDecisionSubmissions: 1,
        toolCalls: summary.toolCalls,
      };
    } catch {
      this.log({
        durationMs: Math.round(performance.now() - startedAt),
        eventCode: "codex_shadow_run_failed",
        failureCode: "CODEX_RUN_INVALID",
      });
      throw new Error("SUPPORT_AUTOPILOT_CODEX_RUN_FAILED");
    }
  }

  private log(event: CodexShadowWorkerEvent): void {
    try {
      this.logger(event);
    } catch {
      // Observability must not alter worker semantics.
    }
  }
}
