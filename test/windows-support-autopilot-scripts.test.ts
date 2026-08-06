import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
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
    expect(source).toContain("credential_expired");
    expect(source.indexOf("$promotionAllowed =")).toBeLessThan(
      source.indexOf("if ($effectiveCredentialExpired)"),
    );
    expect(source).toContain("runnerFresh");
    expect(source).toContain("SUPPORT_AUTOPILOT_DRAIN_REQUEST_PATH");
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
    expect(source).toContain("shadow-runner.drain");
    expect(source).toContain("runner_graceful_stop_timeout");
    expect(source).toContain("ForceAfterTimeout");
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

  windowsIt("gracefully drains an exact runner before stopping it", async () => {
    const installRoot = mkdtempSync(path.join(os.tmpdir(), "support-autopilot-drain-"));
    const entryPoint = path.join(
      installRoot,
      "admin-mcp",
      "dist",
      "runner",
      "support-autopilot-shadow-main.js",
    );
    const drainPath = path.join(installRoot, "state", "shadow-runner.drain");
    mkdirSync(path.dirname(entryPoint), { recursive: true });
    writeFileSync(entryPoint, [
      'const { existsSync } = require("node:fs");',
      'const drainPath = process.env.SUPPORT_AUTOPILOT_DRAIN_REQUEST_PATH;',
      'setInterval(() => { if (drainPath && existsSync(drainPath)) process.exit(0); }, 25);',
    ].join("\n"), "utf8");

    const child = spawn(process.execPath, [entryPoint], {
      env: { ...process.env, SUPPORT_AUTOPILOT_DRAIN_REQUEST_PATH: drainPath },
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const result = spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.resolve("scripts", "stop-support-autopilot-shadow-runner.ps1"),
        "-InstallRoot",
        installRoot,
        "-NodeExecutable",
        process.execPath,
        "-StopTimeoutSeconds",
        "10",
      ], { encoding: "utf8", windowsHide: true });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({ stopped: true });
      if (child.exitCode === null) {
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      }
      expect(child.exitCode).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill();
      rmSync(installRoot, { force: true, recursive: true });
    }
  }, 20_000);

  windowsIt("executes expired-credential recovery through the full state machine", async () => {
    const temporaryParent = path.join(os.tmpdir(), "support-autopilot-supervisor-tests");
    mkdirSync(temporaryParent, { recursive: true });
    const installRoot = mkdtempSync(path.join(temporaryParent, "case-"));
    const adminRoot = path.join(installRoot, "admin-mcp");
    const runnerRoot = path.join(adminRoot, "dist", "runner");
    const scriptRoot = path.join(adminRoot, "scripts");
    const stateRoot = path.join(installRoot, "state");
    const credentialRoot = path.join(installRoot, "credentials");
    const fixtures = path.resolve("test", "fixtures", "support-autopilot-supervisor");
    const activeCredentialPath = path.join(credentialRoot, "support-autopilot.dpapi");
    const runnerEntryPoint = path.join(runnerRoot, "support-autopilot-shadow-main.js");
    const drainPath = path.join(stateRoot, "shadow-runner.drain");
    const fakeGitHubStatePath = path.join(stateRoot, "fake-gh-runs.json");
    mkdirSync(runnerRoot, { recursive: true });
    mkdirSync(scriptRoot, { recursive: true });
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(credentialRoot, { recursive: true });
    writeFileSync(path.join(adminRoot, "package.json"), '{"type":"module"}', "utf8");
    cpSync(realpathSync(path.resolve("node_modules", "zod")), path.join(adminRoot, "node_modules", "zod"), {
      recursive: true,
    });

    for (const name of [
      "support-autopilot-credential-supervisor-main.js",
      "support-autopilot-credential-supervisor.js",
      "windows-dpapi-secret-provider.js",
    ]) {
      cpSync(path.resolve("dist", "runner", name), path.join(runnerRoot, name));
    }
    cpSync(path.join(fixtures, "fake-runner.cjs"), runnerEntryPoint);
    cpSync(
      path.join(fixtures, "fake-health.cjs"),
      path.join(runnerRoot, "support-autopilot-local-health-main.js"),
    );
    cpSync(
      path.join(fixtures, "fake-start-runner.ps1"),
      path.join(scriptRoot, "start-support-autopilot-shadow-runner.ps1"),
    );
    for (const name of [
      "new-support-autopilot-credential.ps1",
      "stop-support-autopilot-shadow-runner.ps1",
      "support-autopilot-windows-security.ps1",
    ]) {
      cpSync(path.resolve("scripts", name), path.join(scriptRoot, name));
    }

    const generated = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(scriptRoot, "new-support-autopilot-credential.ps1"),
      "-OutputPath",
      activeCredentialPath,
    ], { encoding: "utf8", windowsHide: true });
    expect(generated.status, generated.stderr).toBe(0);
    expect(JSON.parse(generated.stdout.trim())).toMatchObject({
      expiresAt: expect.any(String),
      issuedAt: expect.any(String),
      tokenSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const seededExpiresAt = new Date(Date.now() - 60 * 60_000);
    const seededIssuedAt = new Date(seededExpiresAt.getTime() - 23 * 60 * 60_000);
    writeFileSync(path.join(stateRoot, "credential-rotation.json"), JSON.stringify({
      activeCredential: {
        expiresAt: seededExpiresAt.toISOString(),
        issuedAt: seededIssuedAt.toISOString(),
      },
      pendingRotation: null,
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
    }), "utf8");
    writeFileSync(path.join(stateRoot, "privacy-attestation.json"), JSON.stringify({
      attestationId: "support-privacy-1",
      expiresAt: "2026-09-01T00:00:00.000Z",
    }), "utf8");

    const initialRunner = spawn(process.execPath, [runnerEntryPoint], {
      env: { ...process.env, SUPPORT_AUTOPILOT_DRAIN_REQUEST_PATH: drainPath },
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const result = spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.resolve("scripts", "invoke-support-autopilot-credential-supervisor.ps1"),
        "-InstallRoot",
        installRoot,
        "-NodeExecutable",
        process.execPath,
        "-GitHubCliPath",
        path.join(fixtures, "fake-gh.cmd"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          SUPPORT_AUTOPILOT_FAKE_GH_STATE_PATH: fakeGitHubStatePath,
        },
        timeout: 30_000,
        windowsHide: true,
      });

      const eventPath = path.join(stateRoot, "credential-rotation.events.jsonl");
      const redactedEvents = existsSync(eventPath) ? readFileSync(eventPath, "utf8") : "";
      const journal = readFileSync(path.join(stateRoot, "credential-rotation.json"), "utf8");
      expect(
        result.status,
        `${result.stderr}\nstdout=${result.stdout}\nevents=${redactedEvents}\n` +
          `journal=${journal}\nfakeGhStateExists=${existsSync(fakeGitHubStatePath)}`,
      ).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        outcome: "rotated",
        rotated: true,
      });
      const finalState = JSON.parse(
        readFileSync(path.join(stateRoot, "credential-rotation.json"), "utf8"),
      ) as {
        activeCredential: { expiresAt: string };
        pendingRotation: unknown;
      };
      expect(finalState.pendingRotation).toBeNull();
      expect(finalState.activeCredential.expiresAt).not.toBe(seededExpiresAt.toISOString());
      expect(existsSync(path.join(credentialRoot, "support-autopilot.rollback.dpapi"))).toBe(true);
      expect(readdirSync(credentialRoot).filter((name) => name.startsWith("candidate-")))
        .toEqual([]);
      expect(existsSync(fakeGitHubStatePath)).toBe(true);
    } finally {
      if (initialRunner.exitCode === null) initialRunner.kill();
      spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(scriptRoot, "stop-support-autopilot-shadow-runner.ps1"),
        "-InstallRoot",
        installRoot,
        "-NodeExecutable",
        process.execPath,
        "-StopTimeoutSeconds",
        "10",
        "-ForceAfterTimeout",
      ], { encoding: "utf8", windowsHide: true });
      rmSync(installRoot, { force: true, recursive: true });
    }
  }, 45_000);

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
    expect(source).toContain("support-autopilot-credential-rotation-v1");
    expect(source).toContain("ba167befdbded7e6235d192b5d3c81e336f09490");
    expect(source).toContain("Test-ProductionRunnerAvailable");
    expect(source).toContain("correlated_workflow_cancel_failed");
    expect(source).toContain("expired_lease_grace");
    expect(source).toContain("remote_failed_expired_retry");
    expect(source).not.toContain("--ref main");
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
      stateMachine.indexOf("& $GitHubCliPath workflow run"),
    );
    expect(dispatchPrepared.indexOf("Find-CorrelatedWorkflow")).toBeLessThan(
      dispatchPrepared.indexOf("& $GitHubCliPath workflow run"),
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
    expect(source).toContain("interval = 'PT15M'");
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
