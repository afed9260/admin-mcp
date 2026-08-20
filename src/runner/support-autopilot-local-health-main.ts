import { pathToFileURL } from "node:url";
import { z } from "zod";
import { SupportAutopilotApiClient } from "../backend/support-autopilot-api-client.js";
import {
  loadSupportAutopilotShadowRunnerConfig,
  type SupportAutopilotShadowRunnerConfig,
} from "./support-autopilot-shadow-runner.config.js";
import { WindowsDpapiSecretProvider } from "./windows-dpapi-secret-provider.js";

type EnabledConfig = Extract<SupportAutopilotShadowRunnerConfig, { enabled: true }>;
type Environment = Record<string, string | undefined>;
type ApiClient = { get<T>(path: string): Promise<T> };

const canonicalIso = z.string().refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
});
const counter = z.number().int().nonnegative().safe();
const healthBucket = z.object({
  count: counter,
  oldestAgeMs: counter.nullable(),
}).strip();
const actionStates = z.object({
  approved: healthBucket,
  awaiting_owner: healthBucket,
  regeneration_pending: healthBucket,
  executing: healthBucket,
  succeeded: healthBucket,
  superseded: healthBucket,
  expired: healthBucket,
  failed: healthBucket,
  delivery_unknown: healthBucket,
}).strip();
const automaticOutcomes = z.object({
  approved: counter,
  awaiting_owner: counter,
  regeneration_pending: counter,
  executing: counter,
  succeeded: counter,
  superseded: counter,
  expired: counter,
  failed: counter,
  delivery_unknown: counter,
}).strip();
const initialStates = z.object({
  pending: healthBucket,
  leased: healthBucket,
  retry_wait: healthBucket,
  executing: healthBucket,
  completed: healthBucket,
  escalated: healthBucket,
  dead_letter: healthBucket,
  cancelled: healthBucket,
}).strip();
const RUNNER_HEARTBEAT_MAX_AGE_MS = 60_000;
const healthSchema = z.object({
  activeLeases: counter,
  claimsEnabled: z.boolean(),
  deadLetters: counter,
  deliveryUnknownCount: counter,
  generatedAt: canonicalIso,
  jobCreationEnabled: z.boolean(),
  level1: z.object({
    actionRequestsByState: actionStates,
    automaticOutcomes,
    initialByState: initialStates,
  }).strip(),
  oldestPendingAgeMs: counter.nullable(),
  pendingJobs: counter,
  privacyAttestationId: z.string().min(1).max(128).nullable(),
  privacyGatePassed: z.boolean(),
  retryWaitJobs: counter,
  runnerLastSeenAt: canonicalIso.nullable(),
  runnerReady: z.boolean(),
  shadowModeEnabled: z.boolean(),
}).strip();

export interface SupportAutopilotLocalHealth {
  activeLeases: number;
  automation: {
    jobs: {
      cancelled: number;
      completed: number;
      deadLetter: number;
      escalated: number;
      executing: number;
      leased: number;
      pending: number;
      retryWait: number;
    };
    oldestPendingAgeMs: number | null;
    routes: { automatic: number; escalation: number; owner: number };
    sends: { deliveryUnknown: number; failed: number; sent: number };
  };
  claimsEnabled: boolean;
  gatesReady: boolean;
  jobCreationEnabled: boolean;
  pendingJobs: number;
  privacyGatePassed: boolean;
  reachable: true;
  runnerFresh: boolean;
  runnerLastSeenAt: string | null;
  runnerReady: boolean;
  shadowModeEnabled: boolean;
}

export interface SupportAutopilotLocalHealthDependencies {
  apiClientFactory?: (config: EnabledConfig, token: string) => ApiClient;
  loadConfig?: (environment: Environment) => SupportAutopilotShadowRunnerConfig;
  secretProvider?: Pick<WindowsDpapiSecretProvider, "read">;
}

export async function runSupportAutopilotLocalHealth(
  environment: Environment = process.env,
  dependencies: SupportAutopilotLocalHealthDependencies = {},
): Promise<SupportAutopilotLocalHealth> {
  try {
    const config = (dependencies.loadConfig ?? loadSupportAutopilotShadowRunnerConfig)(environment);
    if (!config.enabled) {
      throw new Error("shadow runner disabled");
    }

    const secretProvider = dependencies.secretProvider ?? new WindowsDpapiSecretProvider();
    const token = await secretProvider.read(config.credentialBlobPath);
    const client = dependencies.apiClientFactory?.(config, token)
      ?? new SupportAutopilotApiClient({ baseUrl: config.adminApiBaseUrl, token });
    const health = healthSchema.parse(
      await client.get<unknown>("/support-automation/health"),
    );
    const runnerHeartbeatAgeMs = health.runnerLastSeenAt === null
      ? null
      : Date.parse(health.generatedAt) - Date.parse(health.runnerLastSeenAt);
    const runnerFresh = runnerHeartbeatAgeMs !== null
      && runnerHeartbeatAgeMs >= 0
      && runnerHeartbeatAgeMs <= RUNNER_HEARTBEAT_MAX_AGE_MS;
    const gatesReady = health.claimsEnabled
      && health.jobCreationEnabled
      && health.privacyGatePassed
      && health.runnerReady
      && runnerFresh
      && health.shadowModeEnabled
      && health.privacyAttestationId === config.privacyAttestationId;
    if (
      health.pendingJobs !== health.level1.initialByState.pending.count
      || health.retryWaitJobs !== health.level1.initialByState.retry_wait.count
      || health.deadLetters !== health.level1.initialByState.dead_letter.count
      || health.deliveryUnknownCount
        !== health.level1.actionRequestsByState.delivery_unknown.count
    ) {
      throw new Error("aggregate health counters disagree");
    }
    const automatic = Object.values(health.level1.automaticOutcomes)
      .reduce((total, value) => total + value, 0);
    if (!Number.isSafeInteger(automatic)) {
      throw new Error("aggregate automatic counter overflow");
    }

    return {
      activeLeases: health.activeLeases,
      automation: {
        jobs: {
          cancelled: health.level1.initialByState.cancelled.count,
          completed: health.level1.initialByState.completed.count,
          deadLetter: health.level1.initialByState.dead_letter.count,
          escalated: health.level1.initialByState.escalated.count,
          executing: health.level1.initialByState.executing.count,
          leased: health.level1.initialByState.leased.count,
          pending: health.level1.initialByState.pending.count,
          retryWait: health.level1.initialByState.retry_wait.count,
        },
        oldestPendingAgeMs: health.oldestPendingAgeMs,
        routes: {
          automatic,
          escalation: health.level1.initialByState.escalated.count,
          owner: health.level1.actionRequestsByState.awaiting_owner.count,
        },
        sends: {
          deliveryUnknown: health.level1.actionRequestsByState.delivery_unknown.count,
          failed: health.level1.actionRequestsByState.failed.count,
          sent: health.level1.actionRequestsByState.succeeded.count,
        },
      },
      claimsEnabled: health.claimsEnabled,
      gatesReady,
      jobCreationEnabled: health.jobCreationEnabled,
      pendingJobs: health.pendingJobs,
      privacyGatePassed: health.privacyGatePassed,
      reachable: true,
      runnerFresh,
      runnerLastSeenAt: health.runnerLastSeenAt,
      runnerReady: health.runnerReady,
      shadowModeEnabled: health.shadowModeEnabled,
    };
  } catch {
    throw new Error("SUPPORT_AUTOPILOT_LOCAL_HEALTH_FAILED");
  }
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invokedDirectly) {
  try {
    const report = await runSupportAutopilotLocalHealth();
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch {
    process.stderr.write("SUPPORT_AUTOPILOT_LOCAL_HEALTH_FAILED\n");
    process.exitCode = 1;
  }
}
