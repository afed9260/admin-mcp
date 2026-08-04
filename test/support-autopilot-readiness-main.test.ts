import { describe, expect, it, vi } from "vitest";
import {
  readinessExitCode,
  runSupportAutopilotReadiness,
} from "../src/runner/support-autopilot-readiness-main.js";
import type { SupportAutopilotReadinessReport } from "../src/runner/support-autopilot-readiness.js";

const ready: SupportAutopilotReadinessReport = {
  blockers: [],
  checks: [
    { id: "codex_cli", status: "ready" },
    { id: "codex_login", status: "ready" },
    { id: "mcp_profile", status: "ready" },
    { id: "runtime", status: "ready" },
    { id: "credential_blob", status: "ready" },
    { id: "privacy_attestation", status: "ready" },
  ],
  outcome: "ready",
};

describe("runSupportAutopilotReadiness", () => {
  it("loads configuration and runs exactly one doctor", async () => {
    const run = vi.fn().mockResolvedValue(ready);
    const loadConfig = vi.fn().mockReturnValue({ configurationBlockers: [] });

    await expect(runSupportAutopilotReadiness({ SAFE: "value" }, {
      doctor: { run },
      loadConfig,
    })).resolves.toEqual(ready);

    expect(loadConfig).toHaveBeenCalledWith({ SAFE: "value" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("collapses unexpected failures", async () => {
    await expect(runSupportAutopilotReadiness({}, {
      loadConfig: () => { throw new Error("secret raw failure"); },
    })).rejects.toThrow("SUPPORT_AUTOPILOT_READINESS_FAILED");
  });

  it("uses exit code zero for ready and two for blocked", () => {
    expect(readinessExitCode(ready)).toBe(0);
    expect(readinessExitCode({ ...ready, outcome: "blocked" })).toBe(2);
  });
});
