import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { SupportAutopilotApiClient } from "../backend/support-autopilot-api-client.js";
import { SupportAutopilotQueueBridge, type SupportQueueBridgeEvent } from "../bridge/support-autopilot-queue-bridge.js";
import { CodexShadowPreflight } from "./codex-shadow-preflight.js";
import { CodexShadowWorker, type CodexShadowWorkerEvent } from "./codex-shadow-worker.js";
import { SpawnCodexProcessRunner } from "./codex-process-runner.js";
import { DailyInvocationBudget } from "./daily-invocation-budget.js";
import {
  loadSupportAutopilotShadowRunnerConfig,
  type SupportAutopilotShadowRunnerConfig,
} from "./support-autopilot-shadow-runner.config.js";
import { WindowsDpapiSecretProvider } from "./windows-dpapi-secret-provider.js";

type EnabledConfig = Extract<SupportAutopilotShadowRunnerConfig, { enabled: true }>;
type ApiClient = { post<T>(path: string, body: unknown): Promise<T> };

export type SupportAutopilotShadowMainEvent =
  | SupportQueueBridgeEvent
  | CodexShadowWorkerEvent
  | { eventCode: "shadow_daily_budget_exhausted" }
  | { eventCode: "shadow_runner_ready" }
  | { eventCode: "shadow_runner_stopped"; tickCount: number };

export interface SupportAutopilotShadowMainDependencies {
  apiClientFactory?: (config: EnabledConfig, token: string) => ApiClient;
  budget?: Pick<DailyInvocationBudget, "reserve">;
  drainRequested?: () => boolean;
  loadConfig?: (environment: Record<string, string | undefined>) => SupportAutopilotShadowRunnerConfig;
  logger?: (event: SupportAutopilotShadowMainEvent) => void;
  preflight?: Pick<CodexShadowPreflight, "run">;
  secretProvider?: Pick<WindowsDpapiSecretProvider, "read">;
  signal?: AbortSignal;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  worker?: Pick<CodexShadowWorker, "runOne">;
}

export async function runSupportAutopilotShadowMain(
  environment: Record<string, string | undefined> = process.env,
  dependencies: SupportAutopilotShadowMainDependencies = {},
): Promise<{ outcome: "disabled" | "stopped"; ticks: number }> {
  const loadConfig = dependencies.loadConfig ?? loadSupportAutopilotShadowRunnerConfig;
  const config = loadConfig(environment);
  if (!config.enabled) {
    return { outcome: "disabled", ticks: 0 };
  }
  const signal = dependencies.signal ?? new AbortController().signal;
  if (signal.aborted) {
    return { outcome: "stopped", ticks: 0 };
  }
  const logger = dependencies.logger ?? safeConsoleLogger;
  const processRunner = new SpawnCodexProcessRunner();
  const preflight = dependencies.preflight ?? new CodexShadowPreflight(config, processRunner);
  const secretProvider = dependencies.secretProvider ?? new WindowsDpapiSecretProvider();
  let bridge: SupportAutopilotQueueBridge | undefined;
  let ticks = 0;
  try {
    await preflight.run();
    const token = await secretProvider.read(config.credentialBlobPath);
    const client = dependencies.apiClientFactory?.(config, token)
      ?? new SupportAutopilotApiClient({ baseUrl: config.adminApiBaseUrl, token });
    const budget = dependencies.budget
      ?? new DailyInvocationBudget(config.budgetStatePath, config.dailyBudget);
    const worker = dependencies.worker ?? new CodexShadowWorker(
      config,
      processRunner,
      (event) => log(logger, event),
    );
    const drainRequested = dependencies.drainRequested ?? (() => {
      const requestPath = environment.SUPPORT_AUTOPILOT_DRAIN_REQUEST_PATH;
      return typeof requestPath === "string" && requestPath.length > 0 && existsSync(requestPath);
    });
    let readyLogged = false;
    bridge = new SupportAutopilotQueueBridge(
      {
        getAvailability: async () => {
          const response = await client.post<unknown>(
            "/support-automation/work-availability",
            { workerId: config.workerId },
          );
          const availability = parseAvailability(response);
          if (!readyLogged) {
            readyLogged = true;
            log(logger, { eventCode: "shadow_runner_ready" });
          }
          return availability;
        },
      },
      {
        runOne: async () => {
          if (!await budget.reserve()) {
            log(logger, { eventCode: "shadow_daily_budget_exhausted" });
            throw new Error("daily budget exhausted");
          }
          await worker.runOne();
        },
      },
      { logger: (event) => log(logger, event), shouldStop: drainRequested },
    );

    const sleep = dependencies.sleep ?? abortableSleep;
    while (!signal.aborted && !drainRequested()) {
      const result = await bridge.tick();
      ticks += 1;
      if (result.outcome === "stopped" || signal.aborted) {
        break;
      }
      await sleep(result.nextDelayMs, signal).catch(() => undefined);
    }
    await bridge.stop();
    log(logger, { eventCode: "shadow_runner_stopped", tickCount: ticks });
    return { outcome: "stopped", ticks };
  } catch {
    await bridge?.stop().catch(() => undefined);
    throw new Error("SUPPORT_AUTOPILOT_SHADOW_MAIN_FAILED");
  }
}

function parseAvailability(value: unknown): { retryAfterMs: number; workAvailable: boolean } {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || typeof (value as Record<string, unknown>).workAvailable !== "boolean"
    || !Number.isSafeInteger((value as Record<string, unknown>).retryAfterMs)
    || Number((value as Record<string, unknown>).retryAfterMs) < 0
    || Number((value as Record<string, unknown>).retryAfterMs) > 30_000
  ) {
    throw new Error("invalid availability");
  }
  return {
    retryAfterMs: Number((value as Record<string, unknown>).retryAfterMs),
    workAvailable: Boolean((value as Record<string, unknown>).workAvailable),
  };
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

function log(
  logger: (event: SupportAutopilotShadowMainEvent) => void,
  event: SupportAutopilotShadowMainEvent,
): void {
  try {
    logger(event);
  } catch {
    // Logging must never alter runner semantics.
  }
}

function safeConsoleLogger(event: SupportAutopilotShadowMainEvent): void {
  process.stderr.write(`${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`);
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invokedDirectly) {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await runSupportAutopilotShadowMain(process.env, { signal: controller.signal });
  } catch {
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
