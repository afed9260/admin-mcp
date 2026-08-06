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
    const launcherSource = readFileSync(
      path.resolve("src", "runner", "support-autopilot-windows-process-launcher-main.ts"),
      "utf8",
    );

    expect(source).toContain("[regex]::Escape($NodeExecutable)");
    expect(source).toContain("[regex]::Escape($EntryPoint)");
    expect(source).toContain("Get-CimInstance -ClassName Win32_Process");
    expect(source).not.toMatch(/CommandLine\s+-like/i);
    expect(source).toContain("support-autopilot-windows-process-launcher-main.js");
    expect(launcherSource).toContain("detached: true");
    expect(launcherSource).toContain("windowsHide: true");
    expect(launcherSource).toContain("child.unref()");
    expect(source).toContain("shadow-runner.stdout.log");
    expect(source).toContain("shadow-runner.stderr.log");
    expect(source).toContain("shadow-runner.stdin");
    expect(launcherSource).toContain("stdio: [stdinFd, stdoutFd, stderrFd]");
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
    expect(source).toContain("-StopTimeoutSeconds 720");
    expect(source).not.toContain("-ForceAfterTimeout | Out-Null");
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
    const fakeHeartbeatPath = path.join(stateRoot, "fake-runner-heartbeat.txt");
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
      "support-autopilot-windows-process-launcher-main.js",
      "windows-dpapi-secret-provider.js",
    ]) {
      cpSync(path.resolve("dist", "runner", name), path.join(runnerRoot, name));
    }
    cpSync(path.join(fixtures, "fake-runner.cjs"), runnerEntryPoint);
    cpSync(
      path.join(fixtures, "fake-health.cjs"),
      path.join(runnerRoot, "support-autopilot-local-health-main.js"),
    );
    for (const name of [
      "new-support-autopilot-credential.ps1",
      "start-support-autopilot-shadow-runner.ps1",
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
      env: {
        ...process.env,
        SUPPORT_AUTOPILOT_DRAIN_REQUEST_PATH: drainPath,
        SUPPORT_AUTOPILOT_TEST_HEARTBEAT_PATH: fakeHeartbeatPath,
      },
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const initialHeartbeat = existsSync(fakeHeartbeatPath)
        ? readFileSync(fakeHeartbeatPath, "utf8").trim()
        : "missing";
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
          SUPPORT_AUTOPILOT_TEST_HEARTBEAT_PATH: fakeHeartbeatPath,
        },
        timeout: 30_000,
        windowsHide: true,
      });

      const eventPath = path.join(stateRoot, "credential-rotation.events.jsonl");
      const redactedEvents = existsSync(eventPath) ? readFileSync(eventPath, "utf8") : "";
      const journal = readFileSync(path.join(stateRoot, "credential-rotation.json"), "utf8");
      const finalHeartbeat = existsSync(fakeHeartbeatPath)
        ? readFileSync(fakeHeartbeatPath, "utf8").trim()
        : "missing";
      const runnerStartStdoutPath = path.join(stateRoot, "runner-start.stdout.log");
      const runnerStartStderrPath = path.join(stateRoot, "runner-start.stderr.log");
      const runnerStartStdout = existsSync(runnerStartStdoutPath)
        ? readFileSync(runnerStartStdoutPath, "utf8")
        : "missing";
      const runnerStartStderr = existsSync(runnerStartStderrPath)
        ? readFileSync(runnerStartStderrPath, "utf8")
        : "missing";
      expect(
        result.status,
        `${result.stderr}\nstdout=${result.stdout}\nevents=${redactedEvents}\n` +
          `journal=${journal}\ninitialHeartbeat=${initialHeartbeat}\n` +
          `finalHeartbeat=${finalHeartbeat}\nrunnerStartStdout=${runnerStartStdout}\n` +
          `runnerStartStderr=${runnerStartStderr}\n` +
          `fakeGhStateExists=${existsSync(fakeGitHubStatePath)}`,
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

  windowsIt("replaces a stale exact runner while finalizing candidate promotion", async () => {
    const temporaryParent = path.join(os.tmpdir(), "support-autopilot-stale-recovery-tests");
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
    const heartbeatPath = path.join(stateRoot, "fake-runner-heartbeat.txt");
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
      "support-autopilot-windows-process-launcher-main.js",
      "windows-dpapi-secret-provider.js",
    ]) {
      cpSync(path.resolve("dist", "runner", name), path.join(runnerRoot, name));
    }
    cpSync(path.join(fixtures, "fake-runner.cjs"), runnerEntryPoint);
    writeFileSync(path.join(runnerRoot, "support-autopilot-local-health-main.js"), [
      'import { existsSync, readFileSync } from "node:fs";',
      "const heartbeatPath = process.env.SUPPORT_AUTOPILOT_TEST_HEARTBEAT_PATH;",
      "const runnerLastSeenAt = heartbeatPath && existsSync(heartbeatPath)",
      "  ? readFileSync(heartbeatPath, 'utf8').trim() : null;",
      "const runnerFresh = runnerLastSeenAt !== null",
      "  && Date.now() - Date.parse(runnerLastSeenAt) <= 5000;",
      "process.stdout.write(JSON.stringify({",
      "  activeLeases: 0, claimsEnabled: true, gatesReady: runnerFresh,",
      "  jobCreationEnabled: true, pendingJobs: 0, privacyGatePassed: true,",
      "  reachable: true, runnerFresh, runnerLastSeenAt, runnerReady: runnerFresh,",
      "  shadowModeEnabled: true",
      "}) + '\\n');",
    ].join("\n"), "utf8");
    for (const name of [
      "new-support-autopilot-credential.ps1",
      "start-support-autopilot-shadow-runner.ps1",
      "stop-support-autopilot-shadow-runner.ps1",
      "support-autopilot-windows-security.ps1",
    ]) {
      cpSync(path.resolve("scripts", name), path.join(scriptRoot, name));
    }
    const generated = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", path.join(scriptRoot, "new-support-autopilot-credential.ps1"),
      "-OutputPath", activeCredentialPath,
    ], { encoding: "utf8", windowsHide: true });
    expect(generated.status, generated.stderr).toBe(0);
    const metadata = JSON.parse(generated.stdout.trim()) as {
      expiresAt: string;
      issuedAt: string;
      tokenSha256: string;
    };
    const requestId = "11111111-2222-4333-8444-555555555555";
    writeFileSync(path.join(stateRoot, "credential-rotation.json"), JSON.stringify({
      activeCredential: { expiresAt: metadata.expiresAt, issuedAt: metadata.issuedAt },
      pendingRotation: {
        candidatePath: path.join(credentialRoot, `candidate-${requestId}.dpapi`),
        expiresAt: metadata.expiresAt,
        expectedHeadSha: "ba167befdbded7e6235d192b5d3c81e336f09490",
        issuedAt: metadata.issuedAt,
        requestId,
        stage: "candidate_promoted",
        tokenSha256: metadata.tokenSha256,
        workflowRunId: 424242,
      },
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
    }), "utf8");
    writeFileSync(path.join(stateRoot, "privacy-attestation.json"), JSON.stringify({
      attestationId: "support-privacy-1",
      expiresAt: "2026-09-01T00:00:00.000Z",
    }), "utf8");

    const staleRunner = spawn(process.execPath, [runnerEntryPoint], {
      env: {
        ...process.env,
        SUPPORT_AUTOPILOT_DRAIN_REQUEST_PATH: drainPath,
        SUPPORT_AUTOPILOT_TEST_HEARTBEAT_PATH: heartbeatPath,
      },
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      writeFileSync(heartbeatPath, "2026-08-06T00:00:00.000Z", "utf8");
      const result = spawnSync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", path.resolve("scripts", "invoke-support-autopilot-credential-supervisor.ps1"),
        "-InstallRoot", installRoot,
        "-NodeExecutable", process.execPath,
        "-GitHubCliPath", path.join(fixtures, "fake-gh.cmd"),
      ], {
        encoding: "utf8",
        env: { ...process.env, SUPPORT_AUTOPILOT_TEST_HEARTBEAT_PATH: heartbeatPath },
        timeout: 30_000,
        windowsHide: true,
      });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({ outcome: "rotated", rotated: true });
      const finalState = JSON.parse(
        readFileSync(path.join(stateRoot, "credential-rotation.json"), "utf8"),
      ) as { pendingRotation: unknown };
      expect(finalState.pendingRotation).toBeNull();
      const stopPlan = spawnSync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", path.join(scriptRoot, "stop-support-autopilot-shadow-runner.ps1"),
        "-InstallRoot", installRoot,
        "-NodeExecutable", process.execPath,
        "-PlanOnly",
      ], { encoding: "utf8", windowsHide: true });
      expect(stopPlan.status, stopPlan.stderr).toBe(0);
      const runningIds = JSON.parse(stopPlan.stdout.trim()).matchingProcessIds as number[];
      expect(runningIds).toHaveLength(1);
      expect(runningIds).not.toContain(staleRunner.pid);
    } finally {
      if (staleRunner.exitCode === null) staleRunner.kill();
      spawnSync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", path.join(scriptRoot, "stop-support-autopilot-shadow-runner.ps1"),
        "-InstallRoot", installRoot,
        "-NodeExecutable", process.execPath,
        "-StopTimeoutSeconds", "10",
        "-ForceAfterTimeout",
      ], { encoding: "utf8", windowsHide: true });
      rmSync(installRoot, { force: true, maxRetries: 100, recursive: true, retryDelay: 100 });
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
    expect(source).toContain("remote_failed_expired_preserved");
    expect(source).toContain("$queueTimedOut -and -not $cancelRequested");
    expect(source).not.toContain("($queueTimedOut -or $overallTimedOut)");
    expect(source).not.toContain("--ref main");
  });

  it("uses authenticated health instead of a locked stderr file for readiness", () => {
    const source = script("invoke-support-autopilot-credential-supervisor.ps1");
    const waitReady = source.slice(
      source.indexOf("function Wait-RunnerReady"),
      source.indexOf("function Get-WorkflowSha"),
    );

    expect(waitReady).not.toContain("[IO.File]::ReadAllText");
    expect(waitReady).toContain("Get-QueueHealth");
    expect(waitReady).toContain("Assert-QueueGatesReady");
    expect(waitReady).toContain("heartbeatBaseline");
    expect(waitReady).toContain("runnerLastSeenAt");
  });

  it("contains the transient start helper before releasing the rotation lock", () => {
    const source = script("invoke-support-autopilot-credential-supervisor.ps1");
    const startRunnerIndex = source.indexOf("function Start-Runner");
    const startRunner = source.slice(
      startRunnerIndex,
      source.indexOf("\nfunction Stop-Runner", startRunnerIndex),
    );

    expect(startRunner).toContain("Wait-SupportAutopilotProcessExit");
    expect(startRunner).toContain("Stop-SupportAutopilotProcess");
    expect(startRunner).toContain("Stop-SupportAutopilotPostTimeoutChildren");
    expect(startRunner).toContain("runner_start_helper_timeout");
    expect(startRunner).toContain("runner_start_helper_pid_mismatch");
    const helperSource = script("support-autopilot-windows-process-helper.ps1");
    expect(helperSource).toContain("Stop-Process -Id $Process.Id");
  });

  windowsIt("contains a detached runner appearing at the helper timeout boundary", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "support-autopilot-helper-race-"));
    const entryPoint = path.join(root, "runner.cjs");
    const stdinPath = path.join(root, "runner.stdin");
    const stdoutPath = path.join(root, "runner.stdout.log");
    const stderrPath = path.join(root, "runner.stderr.log");
    const workingDirectory = os.tmpdir();
    const delayedScript = path.join(root, "launch-and-hang.ps1");
    const harnessScript = path.join(root, "harness.ps1");
    const markerPath = path.join(root, "launched.json");
    const helperScript = path.resolve("scripts", "support-autopilot-windows-process-helper.ps1");
    const launcherMain = path.resolve(
      "dist",
      "runner",
      "support-autopilot-windows-process-launcher-main.js",
    );
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    writeFileSync(entryPoint, "setInterval(() => {}, 1000);\r\n", "utf8");
    for (const streamPath of [stdinPath, stdoutPath, stderrPath]) {
      writeFileSync(streamPath, "", "utf8");
    }
    writeFileSync(delayedScript, [
      "Start-Sleep -Seconds 30",
    ].join("\r\n"), "utf8");
    writeFileSync(harnessScript, [
      `$ErrorActionPreference = 'Stop'`,
      `. ${quote(helperScript)}`,
      `$helper = Start-Process -FilePath 'powershell.exe' -ArgumentList @(`,
      `  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',`,
      `  '-File', ('"' + ${quote(delayedScript)} + '"')`,
      `) -WindowStyle Hidden -PassThru`,
      `$null = $helper.Handle`,
      `$exitedInTime = Wait-SupportAutopilotProcessExit -Process $helper -TimeoutSeconds 1`,
      `if ($exitedInTime) { throw 'helper_exited_unexpectedly' }`,
      `Stop-SupportAutopilotProcess -Process $helper`,
      `$launchOutput = & ${quote(process.execPath)} ${quote(launcherMain)} launch --node-executable ${quote(process.execPath)} --entry-point ${quote(entryPoint)} --working-directory ${quote(workingDirectory)} --stdin-path ${quote(stdinPath)} --stdout-path ${quote(stdoutPath)} --stderr-path ${quote(stderrPath)}`,
      `if ($LASTEXITCODE -ne 0) { throw 'launcher_failed' }`,
      `[IO.File]::WriteAllText(${quote(markerPath)}, ($launchOutput | Out-String).Trim(), [Text.UTF8Encoding]::new($false))`,
      `$launchResult = ($launchOutput | Out-String).Trim() | ConvertFrom-Json`,
      `$launchedProcessId = [long]$launchResult.processId`,
      `$getProcesses = {`,
      `  @(Get-CimInstance Win32_Process -Filter "ProcessId=$launchedProcessId")`,
      `}.GetNewClosure()`,
      `$stopProcesses = {`,
      `  param($Processes)`,
      `  foreach ($process in @($Processes)) { Stop-Process -Id $process.ProcessId -Force }`,
      `}`,
      `$contained = Stop-SupportAutopilotPostTimeoutChildren -BaselineProcessIds @() -GetProcesses $getProcesses -StopProcesses $stopProcesses -SettleMilliseconds 1000`,
      `$remaining = @(& $getProcesses)`,
      `[pscustomobject]@{`,
      `  contained = $contained`,
      `  remaining = $remaining.Count`,
      `} | ConvertTo-Json -Compress`,
    ].join("\r\n"), "utf8");
    try {
      const result = spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        harnessScript,
      ], { encoding: "utf8", timeout: 10_000, windowsHide: true });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        contained: true,
        remaining: 0,
      });
    } finally {
      if (existsSync(markerPath)) {
        try {
          const launched = JSON.parse(readFileSync(markerPath, "utf8")) as { processId?: number };
          if (launched.processId) {
            try { process.kill(launched.processId); } catch {}
            for (let attempt = 0; attempt < 100; attempt += 1) {
              try {
                process.kill(launched.processId, 0);
                await new Promise((resolve) => setTimeout(resolve, 50));
              } catch {
                break;
              }
            }
          }
        } catch {}
      }
      rmSync(root, { force: true, maxRetries: 100, recursive: true, retryDelay: 100 });
    }
  }, 15_000);

  it("preserves recovery evidence until the old credential is confirmed healthy", () => {
    const source = script("invoke-support-autopilot-credential-supervisor.ps1");
    const failedWorkflow = source.slice(source.indexOf("if ($_.Exception.Message -ne 'correlated_workflow_failed')"));

    expect(failedWorkflow.indexOf("remote_failed_expired_preserved")).toBeLessThan(
      failedWorkflow.indexOf("Get-QueueHealth | Out-Null"),
    );
    expect(failedWorkflow.indexOf("Get-QueueHealth | Out-Null")).toBeLessThan(
      failedWorkflow.indexOf("Remove-Item -LiteralPath $pending.candidatePath"),
    );
    expect(failedWorkflow.indexOf("Remove-Item -LiteralPath $pending.candidatePath")).toBeLessThan(
      failedWorkflow.indexOf("Write-RotationState (New-StateForStage $state $null)"),
    );
  });

  it("builds current executable artifacts before running recovery tests", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      scripts: { verify: string };
    };

    expect(packageJson.scripts.verify).toContain(
      "&& tsc -p tsconfig.json && vitest run",
    );
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
