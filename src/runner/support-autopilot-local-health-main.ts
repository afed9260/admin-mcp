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
const healthSchema = z.object({
  activeLeases: counter,
  claimsEnabled: z.boolean(),
  deadLetters: counter,
  deliveryUnknownCount: counter,
  generatedAt: canonicalIso,
  jobCreationEnabled: z.boolean(),
  oldestPendingAgeMs: counter.nullable(),
  pendingJobs: counter,
  privacyAttestationId: z.string().min(1).max(128).nullable(),
  privacyGatePassed: z.boolean(),
  retryWaitJobs: counter,
  runnerLastSeenAt: canonicalIso.nullable(),
  runnerReady: z.boolean(),
  shadowModeEnabled: z.boolean(),
}).strict();

export interface SupportAutopilotLocalHealth {
  activeLeases: number;
  claimsEnabled: boolean;
  gatesReady: boolean;
  jobCreationEnabled: boolean;
  pendingJobs: number;
  privacyGatePassed: boolean;
  reachable: true;
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
    const gatesReady = health.claimsEnabled
      && health.jobCreationEnabled
      && health.privacyGatePassed
      && health.runnerReady
      && health.shadowModeEnabled
      && health.privacyAttestationId === config.privacyAttestationId;

    return {
      activeLeases: health.activeLeases,
      claimsEnabled: health.claimsEnabled,
      gatesReady,
      jobCreationEnabled: health.jobCreationEnabled,
      pendingJobs: health.pendingJobs,
      privacyGatePassed: health.privacyGatePassed,
      reachable: true,
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
