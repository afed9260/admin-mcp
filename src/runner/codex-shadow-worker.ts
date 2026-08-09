import { performance } from "node:perf_hooks";
import {
  CodexSupportDecisionError,
  runCodexSupportDecision,
  type CodexSupportDecisionFailureStage,
} from "./codex-support-decision-execution.js";
import { createCodexChildEnvironment } from "./codex-shadow-preflight.js";
import type { CodexProcessRunner } from "./codex-process-runner.js";
import type { SupportAutopilotShadowRunnerConfig } from "./support-autopilot-shadow-runner.config.js";
import type {
  SupportAutomationRevisionFailureCode,
  SupportAutomationRevisionLeaseIdentity,
  SupportAutomationWorkerIdentity,
} from "../backend/support-autopilot-api-client.js";
import type { SupportAutomationWorkKind } from "./codex-support-decision-execution.js";

type EnabledConfig = Extract<SupportAutopilotShadowRunnerConfig, { enabled: true }>;
const LEASE_SAFETY_MARGIN_MS = 5_000;
const MIN_PROCESS_WINDOW_MS = 1_000;

export interface SupportRevisionHostClient {
  claimSupportAutomationRevision(input: SupportAutomationWorkerIdentity): Promise<unknown>;
  renewSupportAutomationRevisionLease(input: SupportAutomationRevisionLeaseIdentity): Promise<unknown>;
  failSupportAutomationRevision(
    input: SupportAutomationRevisionLeaseIdentity & {
      failureCode: SupportAutomationRevisionFailureCode;
    },
  ): Promise<unknown>;
}

export type CodexShadowWorkerEvent =
  | {
    durationMs: number;
    eventCode: "codex_shadow_run_completed";
    failedToolCallCount: number;
    toolCallCount: number;
    workKind: SupportAutomationWorkKind;
  }
  | {
    durationMs: number;
    eventCode: "codex_shadow_run_failed";
    failureCode: "CODEX_RUN_INVALID";
    failureStage: CodexSupportDecisionFailureStage | "unexpected_internal";
    workKind: SupportAutomationWorkKind;
  };

export class CodexShadowWorker {
  constructor(
    private readonly config: EnabledConfig,
    private readonly processRunner: CodexProcessRunner,
    private readonly logger: (event: CodexShadowWorkerEvent) => void = () => undefined,
    private readonly revisionClient?: SupportRevisionHostClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async runOne(workKind: SupportAutomationWorkKind = "initial"): Promise<{
    failedToolCalls: number;
    successfulDecisionSubmissions: 1;
    toolCalls: number;
  }> {
    const startedAt = performance.now();
    let revisionLease: SupportAutomationRevisionLeaseIdentity | undefined;
    try {
      let processTimeoutMs = this.config.processTimeoutMs;
      if (workKind === "revision") {
        const assigned = await this.claimAndRenewRevision();
        revisionLease = assigned.lease;
        processTimeoutMs = Math.min(
          processTimeoutMs,
          assigned.leaseExpiresAt.getTime()
            - this.clock().getTime()
            - LEASE_SAFETY_MARGIN_MS,
        );
        if (!Number.isSafeInteger(processTimeoutMs) || processTimeoutMs < MIN_PROCESS_WINDOW_MS) {
          throw new CodexSupportDecisionError("process_timeout");
        }
      }
      const summary = await runCodexSupportDecision({
        ...(revisionLease === undefined
          ? {}
          : { assignedRevision: {
              leaseToken: revisionLease.leaseToken,
              revisionJobId: revisionLease.revisionJobId,
            } }),
        childEnvironment: createCodexChildEnvironment(this.config),
        codexExecutablePath: this.config.codexExecutablePath,
        processTimeoutMs,
        runtimeDir: this.config.runtimeDir,
        workerId: this.config.workerId,
        workKind,
      }, this.processRunner);
      this.log({
        durationMs: Math.round(performance.now() - startedAt),
        eventCode: "codex_shadow_run_completed",
        failedToolCallCount: summary.failedToolCalls,
        toolCallCount: summary.toolCalls,
        workKind,
      });
      return {
        failedToolCalls: summary.failedToolCalls,
        successfulDecisionSubmissions: 1,
        toolCalls: summary.toolCalls,
      };
    } catch (error: unknown) {
      if (workKind === "revision" && revisionLease !== undefined) {
        await this.reportRevisionFailure(
          revisionLease,
          this.mapFailureCode(error),
        );
      }
      this.log({
        durationMs: Math.round(performance.now() - startedAt),
        eventCode: "codex_shadow_run_failed",
        failureCode: "CODEX_RUN_INVALID",
        failureStage: error instanceof CodexSupportDecisionError
          ? error.stage
          : "unexpected_internal",
        workKind,
      });
      throw new Error("SUPPORT_AUTOPILOT_CODEX_RUN_FAILED");
    }
  }

  private async claimAndRenewRevision(): Promise<{
    lease: SupportAutomationRevisionLeaseIdentity;
    leaseExpiresAt: Date;
  }> {
    if (this.revisionClient === undefined) {
      throw new Error("REVISION_HOST_CLIENT_REQUIRED");
    }
    const claimed = this.parseRevisionLease(
      await this.revisionClient.claimSupportAutomationRevision({
        workerId: this.config.workerId,
      }),
    );
    const renewed = this.parseRevisionLease(
      await this.revisionClient.renewSupportAutomationRevisionLease(claimed.lease),
    );
    if (renewed.lease.revisionJobId !== claimed.lease.revisionJobId) {
      throw new Error("REVISION_LEASE_IDENTITY_MISMATCH");
    }
    return renewed;
  }

  private parseRevisionLease(value: unknown): {
    lease: SupportAutomationRevisionLeaseIdentity;
    leaseExpiresAt: Date;
  } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("REVISION_LEASE_INVALID");
    }
    const record = value as Record<string, unknown>;
    const leaseExpiresAt = typeof record.leaseExpiresAt === "string"
      ? new Date(record.leaseExpiresAt)
      : new Date(Number.NaN);
    if (
      typeof record.revisionJobId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.revisionJobId)
      || typeof record.leaseToken !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(record.leaseToken)
      || !Number.isFinite(leaseExpiresAt.getTime())
    ) {
      throw new Error("REVISION_LEASE_INVALID");
    }
    return {
      lease: {
        leaseToken: record.leaseToken,
        revisionJobId: record.revisionJobId,
        workerId: this.config.workerId,
      },
      leaseExpiresAt,
    };
  }

  private mapFailureCode(error: unknown): SupportAutomationRevisionFailureCode {
    if (!(error instanceof CodexSupportDecisionError)) {
      return "runner_process_failed";
    }
    if (error.stage === "process_timeout") {
      return "runner_timeout";
    }
    if (error.stage === "tool_failure_budget_exceeded") {
      return "runner_tool_failed";
    }
    if (error.stage === "jsonl_invalid" || error.stage === "decision_count_invalid") {
      return "runner_output_invalid";
    }
    return "runner_process_failed";
  }

  private async reportRevisionFailure(
    lease: SupportAutomationRevisionLeaseIdentity,
    failureCode: SupportAutomationRevisionFailureCode,
  ): Promise<void> {
    try {
      await this.revisionClient?.failSupportAutomationRevision({
        ...lease,
        failureCode,
      });
    } catch {
      // The original bounded worker failure remains the only public outcome.
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
