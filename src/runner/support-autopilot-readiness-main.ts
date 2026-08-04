import { pathToFileURL } from "node:url";
import { SpawnCodexProcessRunner } from "./codex-process-runner.js";
import {
  SupportAutopilotReadinessDoctor,
  type SupportAutopilotReadinessReport,
} from "./support-autopilot-readiness.js";
import {
  loadSupportAutopilotReadinessConfig,
  type SupportAutopilotReadinessConfig,
} from "./support-autopilot-readiness.config.js";

type Environment = Record<string, string | undefined>;

export interface SupportAutopilotReadinessDependencies {
  doctor?: Pick<SupportAutopilotReadinessDoctor, "run">;
  loadConfig?: (environment: Environment) => SupportAutopilotReadinessConfig;
}

export async function runSupportAutopilotReadiness(
  environment: Environment = process.env,
  dependencies: SupportAutopilotReadinessDependencies = {},
): Promise<SupportAutopilotReadinessReport> {
  try {
    const config = (dependencies.loadConfig ?? loadSupportAutopilotReadinessConfig)(environment);
    const doctor = dependencies.doctor
      ?? new SupportAutopilotReadinessDoctor(config, new SpawnCodexProcessRunner());
    return await doctor.run();
  } catch {
    throw new Error("SUPPORT_AUTOPILOT_READINESS_FAILED");
  }
}

export function readinessExitCode(report: SupportAutopilotReadinessReport): 0 | 2 {
  return report.outcome === "ready" ? 0 : 2;
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invokedDirectly) {
  try {
    const report = await runSupportAutopilotReadiness();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = readinessExitCode(report);
  } catch {
    process.stderr.write("SUPPORT_AUTOPILOT_READINESS_FAILED\n");
    process.exitCode = 1;
  }
}
