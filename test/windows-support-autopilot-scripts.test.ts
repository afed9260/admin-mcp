import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function script(name: string): string {
  return readFileSync(path.resolve("scripts", name), "utf8");
}

describe("Windows support autopilot lifecycle scripts", () => {
  it("protects local state and writes only schema-bounded redacted events", () => {
    const source = script("support-autopilot-windows-security.ps1");

    expect(source).toContain("SetAccessRuleProtection($true, $false)");
    expect(source).toContain("FileSystemRights]::FullControl");
    expect(source).toContain("Assert-NoSupportAutopilotPlaintextTokenEnvironment");
    expect(source).toContain("Write-SupportAutopilotRedactedEvent");
    expect(source).toContain("credential-rotation.events.jsonl");
    expect(source).not.toMatch(/Write-(?:Host|Output).*token/i);
  });

  it("starts one exact hidden runner process with redacted fixed log paths", () => {
    const source = script("start-support-autopilot-shadow-runner.ps1");

    expect(source).toContain("[regex]::Escape($NodeExecutable)");
    expect(source).toContain("[regex]::Escape($EntryPoint)");
    expect(source).toContain("Get-CimInstance -ClassName Win32_Process");
    expect(source).not.toMatch(/CommandLine\s+-like/i);
    expect(source).toMatch(/-WindowStyle\s+Hidden/);
    expect(source).toContain("shadow-runner.stdout.log");
    expect(source).toContain("shadow-runner.stderr.log");
    expect(source).not.toContain("Remove-Item Env:SUPPORT_AUTOPILOT_SERVICE_TOKEN");
    expect(source).not.toContain("Remove-Item Env:ADMIN_API_TOKEN");
    expect(source).toContain("rotation_pending");
    expect(source).toContain("candidate_promoted");
    expect(source).toContain("[switch]$AllowPendingPromotion");
    expect(source).toContain("[switch]$SupervisorOwnedLock");
    expect(source).toContain("credential-rotation.lock");
    expect(source).toContain("[IO.FileShare]::None");
    expect(source).toContain("rotation_lock_held");
    expect(source).toContain("credential_state_seed_required");
    expect(source).toContain("support-autopilot-windows-security.ps1");
    expect(source).toContain("Assert-NoSupportAutopilotPlaintextTokenEnvironment");
    expect(source).toContain("SUPPORT_AUTOPILOT_RUNNER_START_FAILED");
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

  it("rotates only through a locked recoverable journal and correlated workflow", () => {
    const source = script("invoke-support-autopilot-credential-supervisor.ps1");

    expect(source).toContain("[IO.File]::Open(");
    expect(source).toContain("[IO.FileShare]::None");
    expect(source).toContain("runner_stopped");
    expect(source).toContain("candidate_ready");
    expect(source).toContain("workflow_dispatched");
    expect(source).toContain("server_accepted");
    expect(source).toContain("candidate_promoted");
    expect(source).toContain("support-autopilot-local-health-main.js");
    expect(source).toContain("stop-support-autopilot-shadow-runner.ps1");
    expect(source).toContain("new-support-autopilot-credential.ps1");
    expect(source).toContain("support-autopilot-credential-supervisor-main.js");
    expect(source).toContain("--request-id");
    expect(source).toContain("--expected-sha");
    expect(source).toContain("token_sha256");
    expect(source).toContain("request_id");
    expect(source).toContain("[IO.File]::Replace(");
    expect(source).toContain("support-autopilot.rollback.dpapi");
    expect(source).not.toContain("SUPPORT_AUTOPILOT_SERVICE_TOKEN=");
    expect(source).not.toMatch(/Write-(?:Host|Output).*token/i);
    expect(source).toContain("[switch]$PlanOnly");
    expect(source).toContain("rotate-support-autopilot-credential");
    expect(source).toContain("support-autopilot-windows-security.ps1");
    expect(source).toContain("Write-SupportAutopilotRedactedEvent");
    expect(source).toContain("SUPPORT_AUTOPILOT_CREDENTIAL_SUPERVISOR_FAILED");
    expect(source).toContain("'recovery-action'");
  });

  it("orders interruption recovery before every irreversible boundary", () => {
    const source = script("invoke-support-autopilot-credential-supervisor.ps1");
    const stateMachine = source.slice(source.indexOf("$state = Get-RotationState"));
    const runnerStopped = stateMachine.slice(stateMachine.indexOf("if ($pending.stage -eq 'runner_stopped')"));
    const dispatchPrepared = stateMachine.slice(stateMachine.indexOf("if ($pending.stage -eq 'dispatch_prepared')"));

    expect(stateMachine.indexOf("Stop-Runner")).toBeLessThan(
      stateMachine.indexOf("Wait-PostStopLeaseDrain"),
    );
    expect(stateMachine.indexOf("Wait-PostStopLeaseDrain")).toBeLessThan(
      stateMachine.indexOf("stage = 'runner_stopped'"),
    );
    expect(runnerStopped.indexOf("Remove-Item -LiteralPath $candidatePath")).toBeLessThan(
      runnerStopped.indexOf("-File $CredentialGenerator"),
    );
    expect(stateMachine.indexOf("stage = 'dispatch_prepared'")).toBeLessThan(
      stateMachine.indexOf("& gh.exe workflow run"),
    );
    expect(dispatchPrepared.indexOf("Find-CorrelatedWorkflow")).toBeLessThan(
      dispatchPrepared.indexOf("& gh.exe workflow run"),
    );
    expect(stateMachine).toContain("missing_after_server_acceptance");
  });

  it("installs two current-user scheduled tasks without a stored password", () => {
    const source = script("install-support-autopilot-scheduled-tasks.ps1");

    expect(source).toContain("Sdelka Support Autopilot Watchdog");
    expect(source).toContain("Sdelka Support Autopilot Credential Supervisor");
    expect(source).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(source).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(source).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(source).toContain("<StartWhenAvailable>true</StartWhenAvailable>");
    expect(source).toContain("<Interval>$Interval</Interval>");
    expect(source).toContain("interval = 'PT5M'");
    expect(source).toContain("interval = 'PT1H'");
    expect(source).toContain("Register-ScheduledTask");
    expect(source).toContain("[xml](New-TaskXml");
    expect(source).not.toMatch(/-Password\b/i);
    expect(source).toContain("[switch]$PlanOnly");
  });

  it("uninstalls only the two exact task names", () => {
    const source = script("uninstall-support-autopilot-scheduled-tasks.ps1");

    expect(source).toContain("Sdelka Support Autopilot Watchdog");
    expect(source).toContain("Sdelka Support Autopilot Credential Supervisor");
    expect(source).toContain("Unregister-ScheduledTask");
    expect(source).toContain("[switch]$PlanOnly");
  });
});
