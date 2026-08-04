import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import {
  runCodexSupportDecision,
  type CodexSupportDecisionExecutionConfig,
} from "../runner/codex-support-decision-execution.js";
import {
  SpawnCodexProcessRunner,
  type CodexProcessRunner,
} from "../runner/codex-process-runner.js";
import {
  CodexSyntheticPreflight,
  createSyntheticCodexChildEnvironment,
} from "./codex-synthetic-preflight.js";
import {
  loadSupportAutopilotSyntheticCanaryConfig,
  type SupportAutopilotSyntheticCanaryConfig,
} from "./support-autopilot-synthetic-canary.config.js";

type Environment = Record<string, string | undefined>;

export type SupportAutopilotSyntheticCanaryResult =
  | { outcome: "disabled" }
  | {
    durationMs: number;
    failedToolCalls: 0;
    outcome: "passed";
    successfulDecisionSubmissions: 1;
    toolCalls: number;
  };

export interface SupportAutopilotSyntheticCanaryDependencies {
  clock?: () => number;
  execute?: (
    config: CodexSupportDecisionExecutionConfig,
    processRunner: CodexProcessRunner,
  ) => ReturnType<typeof runCodexSupportDecision>;
  loadConfig?: (
    environment: Environment,
  ) => SupportAutopilotSyntheticCanaryConfig;
  preflight?: Pick<CodexSyntheticPreflight, "run">;
  processRunner?: CodexProcessRunner;
}

export async function runSupportAutopilotSyntheticCanary(
  environment: Environment = process.env,
  dependencies: SupportAutopilotSyntheticCanaryDependencies = {},
): Promise<SupportAutopilotSyntheticCanaryResult> {
  try {
    const loadConfig = dependencies.loadConfig
      ?? loadSupportAutopilotSyntheticCanaryConfig;
    const config = loadConfig(environment);
    if (!config.enabled) {
      return { outcome: "disabled" };
    }

    const processRunner = dependencies.processRunner ?? new SpawnCodexProcessRunner();
    const preflight = dependencies.preflight
      ?? new CodexSyntheticPreflight(config, processRunner);
    await preflight.run();

    const clock = dependencies.clock ?? (() => performance.now());
    const startedAt = clock();
    const execute = dependencies.execute ?? runCodexSupportDecision;
    const summary = await execute({
      childEnvironment: createSyntheticCodexChildEnvironment(config),
      codexExecutablePath: config.codexExecutablePath,
      processTimeoutMs: config.processTimeoutMs,
      runtimeDir: config.runtimeDir,
      workerId: config.workerId,
    }, processRunner);
    const durationMs = Math.max(0, Math.round(clock() - startedAt));

    return {
      durationMs,
      failedToolCalls: 0,
      outcome: "passed",
      successfulDecisionSubmissions: 1,
      toolCalls: summary.toolCalls,
    };
  } catch {
    throw new Error("SUPPORT_AUTOPILOT_SYNTHETIC_CANARY_FAILED");
  }
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invokedDirectly) {
  try {
    const result = await runSupportAutopilotSyntheticCanary();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("SUPPORT_AUTOPILOT_SYNTHETIC_CANARY_FAILED\n");
    process.exitCode = 1;
  }
}
