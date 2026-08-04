import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("support autopilot same-user isolation runbook", () => {
  const runbook = readFileSync(
    resolve(process.cwd(), "docs/support-autopilot-unit5-shadow-runner.md"),
    "utf8",
  );
  const deploy = readFileSync(resolve(process.cwd(), "DEPLOY.md"), "utf8");

  it("supports a single-user desktop without weakening the isolated Codex profile", () => {
    expect(runbook).toContain("single-user desktop mode");
    expect(runbook).toContain("dedicated `CODEX_HOME`");
    expect(runbook).toContain("same Windows account that runs the shadow runner");
    expect(runbook).not.toContain("Use a dedicated Windows service account.");
  });

  it("documents the DPAPI residual risk and Pro privacy gate", () => {
    expect(runbook).toContain("process running as that Windows user");
    expect(runbook).toContain("Pro workspace requires `modelTrainingDisabled=true`");
    expect(deploy).toContain("same Windows account that runs the shadow runner");
  });
});
