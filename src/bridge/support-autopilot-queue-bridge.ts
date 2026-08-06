export interface WorkAvailabilityReader {
  getAvailability(): Promise<{ workAvailable: boolean; retryAfterMs: number }>;
}

export interface SupportAutomationWorker {
  runOne(): Promise<void>;
}

export type SupportQueueBridgeEvent =
  | { eventCode: "bridge_availability_checked"; workAvailableCount: number }
  | { eventCode: "bridge_worker_started" }
  | { eventCode: "bridge_worker_completed" }
  | { eventCode: "bridge_tick_failed"; failureCount: number; nextDelayMs: number }
  | { eventCode: "bridge_stopped" };

export type SupportQueueBridgeTickResult = {
  outcome: "failed" | "idle" | "stopped" | "worked";
  nextDelayMs: number;
};

export interface SupportAutopilotQueueBridgeOptions {
  initialBackoffMs?: number;
  logger?: (event: SupportQueueBridgeEvent) => void;
  maxBackoffMs?: number;
  shouldStop?: () => boolean;
}

const ACTIVE_POLL_DELAY_MS = 1_000;
const MIN_IDLE_DELAY_MS = 1_000;
const MAX_IDLE_DELAY_MS = 60_000;

export class SupportAutopilotQueueBridge {
  private readonly initialBackoffMs: number;
  private readonly logger: (event: SupportQueueBridgeEvent) => void;
  private readonly maxBackoffMs: number;
  private readonly shouldStop: () => boolean;
  private consecutiveFailures = 0;
  private inFlight: Promise<SupportQueueBridgeTickResult> | undefined;
  private stopped = false;

  constructor(
    private readonly availabilityReader: WorkAvailabilityReader,
    private readonly worker: SupportAutomationWorker,
    options: SupportAutopilotQueueBridgeOptions = {},
  ) {
    this.initialBackoffMs = this.requirePositiveInteger(
      options.initialBackoffMs ?? 1_000,
      "initialBackoffMs",
    );
    this.maxBackoffMs = this.requirePositiveInteger(
      options.maxBackoffMs ?? 60_000,
      "maxBackoffMs",
    );
    if (this.maxBackoffMs < this.initialBackoffMs) {
      throw new Error("maxBackoffMs must be greater than or equal to initialBackoffMs");
    }
    this.logger = options.logger ?? (() => undefined);
    this.shouldStop = options.shouldStop ?? (() => false);
  }

  tick(): Promise<SupportQueueBridgeTickResult> {
    if (this.stopped || this.shouldStop()) {
      this.stopped = true;
      return Promise.resolve({ outcome: "stopped", nextDelayMs: 0 });
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    const operation = this.runTick();
    this.inFlight = operation;
    void operation.finally(() => {
      if (this.inFlight === operation) {
        this.inFlight = undefined;
      }
    });
    return operation;
  }

  async stop(): Promise<void> {
    if (!this.stopped) {
      this.stopped = true;
      this.log({ eventCode: "bridge_stopped" });
    }
    await this.inFlight;
  }

  private async runTick(): Promise<SupportQueueBridgeTickResult> {
    try {
      const availability = await this.availabilityReader.getAvailability();
      this.assertAvailability(availability);
      this.log({
        eventCode: "bridge_availability_checked",
        workAvailableCount: availability.workAvailable ? 1 : 0,
      });

      if (!availability.workAvailable) {
        this.consecutiveFailures = 0;
        return {
          outcome: "idle",
          nextDelayMs: Math.min(
            MAX_IDLE_DELAY_MS,
            Math.max(MIN_IDLE_DELAY_MS, availability.retryAfterMs),
          ),
        };
      }

      if (this.shouldStop()) {
        this.stopped = true;
        return { outcome: "stopped", nextDelayMs: 0 };
      }

      this.log({ eventCode: "bridge_worker_started" });
      await this.worker.runOne();
      this.log({ eventCode: "bridge_worker_completed" });
      this.consecutiveFailures = 0;
      return { outcome: "worked", nextDelayMs: ACTIVE_POLL_DELAY_MS };
    } catch {
      this.consecutiveFailures += 1;
      const nextDelayMs = Math.min(
        this.maxBackoffMs,
        this.initialBackoffMs * (2 ** Math.min(this.consecutiveFailures - 1, 30)),
      );
      this.log({
        eventCode: "bridge_tick_failed",
        failureCount: this.consecutiveFailures,
        nextDelayMs,
      });
      return { outcome: "failed", nextDelayMs };
    }
  }

  private assertAvailability(value: { workAvailable: boolean; retryAfterMs: number }): void {
    if (
      typeof value?.workAvailable !== "boolean"
      || !Number.isSafeInteger(value?.retryAfterMs)
      || value.retryAfterMs < 0
    ) {
      throw new Error("Invalid support automation availability response");
    }
  }

  private log(event: SupportQueueBridgeEvent): void {
    try {
      this.logger(event);
    } catch {
      // Logging must never change queue execution semantics.
    }
  }

  private requirePositiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
    return value;
  }
}
