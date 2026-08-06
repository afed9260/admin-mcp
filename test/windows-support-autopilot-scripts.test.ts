import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function script(name: string): string {
  return readFileSync(path.resolve("scripts", name), "utf8");
}

describe("Windows support autopilot lifecycle scripts", () => {
  it("starts one exact hidden runner process with redacted fixed log paths", () => {
    const source = script("start-support-autopilot-shadow-runner.ps1");

    expect(source).toContain("[regex]::Escape($NodeExecutable)");
    expect(source).toContain("[regex]::Escape($EntryPoint)");
    expect(source).toContain("Get-CimInstance -ClassName Win32_Process");
    expect(source).not.toMatch(/CommandLine\s+-like/i);
    expect(source).toMatch(/-WindowStyle\s+Hidden/);
    expect(source).toContain("shadow-runner.stdout.log");
    expect(source).toContain("shadow-runner.stderr.log");
    expect(source).toContain("Remove-Item Env:SUPPORT_AUTOPILOT_SERVICE_TOKEN");
    expect(source).toContain("Remove-Item Env:ADMIN_API_TOKEN");
    expect(source).not.toMatch(/Write-(?:Host|Output).*token/i);
    expect(source).toContain("[switch]$PlanOnly");
  });

  it("stops only the exact runner process and verifies bounded shutdown", () => {
    const source = script("stop-support-autopilot-shadow-runner.ps1");

    expect(source).toContain("[regex]::Escape($NodeExecutable)");
    expect(source).toContain("[regex]::Escape($EntryPoint)");
    expect(source).not.toMatch(/CommandLine\s+-like/i);
    expect(source).toMatch(/Stop-Process\s+-Id/);
    expect(source).toContain("AddSeconds($StopTimeoutSeconds)");
    expect(source).toContain("runner_stop_timeout");
    expect(source).toContain("[switch]$PlanOnly");
  });

  const windowsIt = process.platform === "win32" ? it : it.skip;
  windowsIt("supports no-mutation planning when no exact runner is present", () => {
    for (const name of [
      "start-support-autopilot-shadow-runner.ps1",
      "stop-support-autopilot-shadow-runner.ps1",
    ]) {
      const result = spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.resolve("scripts", name),
        "-InstallRoot",
        path.resolve("test", "fixtures", "support-autopilot-install"),
        "-PlanOnly",
      ], { encoding: "utf8", windowsHide: true });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({ planOnly: true });
    }
  });
});
