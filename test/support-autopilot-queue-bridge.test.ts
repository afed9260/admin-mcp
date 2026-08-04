import { describe, expect, it, vi } from "vitest";
import {
  SupportAutopilotQueueBridge,
  type SupportQueueBridgeEvent,
} from "../src/bridge/support-autopilot-queue-bridge.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("SupportAutopilotQueueBridge", () => {
  it("checks availability on an idle tick without invoking the worker", async () => {
    const getAvailability = vi.fn().mockResolvedValue({
      workAvailable: false,
      retryAfterMs: 7_500,
    });
    const runOne = vi.fn();
    const bridge = new SupportAutopilotQueueBridge({ getAvailability }, { runOne });

    await expect(bridge.tick()).resolves.toEqual({ outcome: "idle", nextDelayMs: 7_500 });
    expect(getAvailability).toHaveBeenCalledOnce();
    expect(runOne).not.toHaveBeenCalled();
  });

  it("invokes the injected worker exactly once when work is available", async () => {
    const getAvailability = vi.fn().mockResolvedValue({ workAvailable: true, retryAfterMs: 5_000 });
    const runOne = vi.fn().mockResolvedValue(undefined);
    const bridge = new SupportAutopilotQueueBridge({ getAvailability }, { runOne });

    await expect(bridge.tick()).resolves.toEqual({ outcome: "worked", nextDelayMs: 1_000 });
    expect(runOne).toHaveBeenCalledOnce();
  });

  it("coalesces overlapping ticks and never starts concurrent workers", async () => {
    const workerRun = deferred<void>();
    const getAvailability = vi.fn().mockResolvedValue({ workAvailable: true, retryAfterMs: 5_000 });
    const runOne = vi.fn(() => workerRun.promise);
    const bridge = new SupportAutopilotQueueBridge({ getAvailability }, { runOne });

    const firstTick = bridge.tick();
    const secondTick = bridge.tick();
    await vi.waitFor(() => expect(runOne).toHaveBeenCalledOnce());
    workerRun.resolve(undefined);

    await expect(Promise.all([firstTick, secondTick])).resolves.toEqual([
      { outcome: "worked", nextDelayMs: 1_000 },
      { outcome: "worked", nextDelayMs: 1_000 },
    ]);
    expect(getAvailability).toHaveBeenCalledOnce();
  });

  it("uses bounded exponential backoff without logging backend error content", async () => {
    const sensitiveError = "ticket=secret-ticket leaseToken=secret-token customer=private";
    const getAvailability = vi.fn().mockRejectedValue(new Error(sensitiveError));
    const events: SupportQueueBridgeEvent[] = [];
    const bridge = new SupportAutopilotQueueBridge(
      { getAvailability },
      { runOne: vi.fn() },
      {
        initialBackoffMs: 100,
        maxBackoffMs: 400,
        logger: (event) => events.push(event),
      },
    );

    const results = [];
    for (let index = 0; index < 4; index += 1) {
      results.push(await bridge.tick());
    }

    expect(results).toEqual([
      { outcome: "failed", nextDelayMs: 100 },
      { outcome: "failed", nextDelayMs: 200 },
      { outcome: "failed", nextDelayMs: 400 },
      { outcome: "failed", nextDelayMs: 400 },
    ]);
    expect(JSON.stringify(events)).not.toContain(sensitiveError);
    expect(JSON.stringify(events)).not.toMatch(/ticket|token|customer|payload/i);
    expect(events.at(-1)).toEqual({
      eventCode: "bridge_tick_failed",
      failureCount: 4,
      nextDelayMs: 400,
    });
  });

  it("stops future ticks and waits for the in-flight worker", async () => {
    const workerRun = deferred<void>();
    const getAvailability = vi.fn().mockResolvedValue({ workAvailable: true, retryAfterMs: 5_000 });
    const runOne = vi.fn(() => workerRun.promise);
    const bridge = new SupportAutopilotQueueBridge({ getAvailability }, { runOne });
    const tick = bridge.tick();
    await vi.waitFor(() => expect(runOne).toHaveBeenCalledOnce());

    let stopSettled = false;
    const stopping = bridge.stop().then(() => {
      stopSettled = true;
    });
    await Promise.resolve();
    expect(stopSettled).toBe(false);

    workerRun.resolve(undefined);
    await expect(Promise.all([tick, stopping])).resolves.toEqual([
      { outcome: "worked", nextDelayMs: 1_000 },
      undefined,
    ]);
    await expect(bridge.tick()).resolves.toEqual({ outcome: "stopped", nextDelayMs: 0 });
    expect(getAvailability).toHaveBeenCalledOnce();
    expect(runOne).toHaveBeenCalledOnce();
  });
});
