import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const revision = "0123456789abcdef0123456789abcdef01234567";
const temporaryRoots: string[] = [];
const windowsIt = process.platform === "win32" ? it : it.skip;

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("support autopilot status script", () => {
  it("is read-only and queries only the two exact tasks plus the exact runner", () => {
    const source = readFileSync(
      path.resolve("scripts", "get-support-autopilot-status.ps1"),
      "utf8",
    );

    expect(source).toContain("Sdelka Support Autopilot Watchdog");
    expect(source).toContain("Sdelka Support Autopilot Credential Supervisor");
    expect(source).toContain("Get-ScheduledTask -TaskName $Name");
    expect(source).toContain("[regex]::Escape($NodeExecutable)");
    expect(source).toContain("[regex]::Escape($RunnerEntryPoint)");
    expect(source).not.toMatch(
      /Start-Process|Stop-Process|Register-ScheduledTask|Unregister-ScheduledTask|Remove-Item|Set-Content|WriteAllText/i,
    );
  });

  windowsIt("returns one exact redacted status document from bounded fakes", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "support-autopilot-status-"));
    temporaryRoots.push(root);
    const adminRoot = path.join(root, "admin-mcp");
    const runnerRoot = path.join(adminRoot, "dist", "runner");
    const stateRoot = path.join(root, "state");
    mkdirSync(runnerRoot, { recursive: true });
    mkdirSync(stateRoot, { recursive: true });
    const manifestMain = path.join(runnerRoot, "support-autopilot-runtime-manifest-main.js");
    const healthMain = path.join(runnerRoot, "support-autopilot-local-health-main.js");
    const runnerMain = path.join(runnerRoot, "support-autopilot-shadow-main.js");
    writeFileSync(path.join(adminRoot, "package.json"), '{"type":"module"}', "utf8");
    writeFileSync(manifestMain, [
      "if (process.argv[2] !== 'verify') process.exit(1);",
      `process.stdout.write(JSON.stringify({ fileCount: 1, outcome: 'verified', revision: '${revision}' }) + '\\n');`,
    ].join("\n"), "utf8");
    writeFileSync(healthMain, [
      "process.stdout.write(JSON.stringify({",
      "  activeLeases: 0, claimsEnabled: true, gatesReady: true, jobCreationEnabled: true,",
      "  pendingJobs: 0, privacyGatePassed: true, reachable: true, runnerFresh: true,",
      "  runnerLastSeenAt: '2026-08-20T12:00:00.000Z', runnerReady: true, shadowModeEnabled: true,",
      "  automation: {",
      "    jobs: { cancelled: 0, completed: 3, deadLetter: 0, escalated: 1, executing: 0, leased: 0, pending: 0, retryWait: 0 },",
      "    oldestPendingAgeMs: null, routes: { automatic: 0, escalation: 1, owner: 2 },",
      "    sends: { deliveryUnknown: 0, failed: 0, sent: 0 }",
      "  }",
      "}) + '\\n');",
    ].join("\n"), "utf8");
    writeFileSync(runnerMain, "setInterval(() => {}, 1000);\n", "utf8");
    writeFileSync(path.join(stateRoot, "runtime-manifest.json"), "{}", "utf8");
    writeFileSync(path.join(stateRoot, "privacy-attestation.json"), JSON.stringify({
      attestationId: "privacy-1",
      expiresAt: "2026-09-01T00:00:00.000Z",
    }), "utf8");

    const harnessPath = path.join(root, "status-harness.ps1");
    const statusScript = path.resolve("scripts", "get-support-autopilot-status.ps1");
    const commandLine = `\"${process.execPath}\" \"${runnerMain}\"`;
    writeFileSync(harnessPath, [
      "function Get-ScheduledTask {",
      "  param([string]$TaskName, [object]$ErrorAction)",
      "  [pscustomobject]@{ TaskName = $TaskName; State = 'Ready' }",
      "}",
      "function Get-CimInstance {",
      "  param([string]$ClassName, [string]$Filter)",
      `  [pscustomobject]@{ ExecutablePath = ${psQuote(process.execPath)}; CommandLine = ${psQuote(commandLine)}; ProcessId = 4242 }`,
      "}",
      `. ${psQuote(statusScript)} -InstallRoot ${psQuote(root)} -NodeExecutable ${psQuote(process.execPath)} -ExpectedRuntimeRevision '${revision}'`,
    ].join("\r\n"), "utf8");

    const run = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harnessPath,
    ], { encoding: "utf8", timeout: 15_000, windowsHide: true });

    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout.trim());
    expect(result).toEqual({
      automation: {
        jobs: { cancelled: 0, completed: 3, deadLetter: 0, escalated: 1, executing: 0, leased: 0, pending: 0, retryWait: 0 },
        oldestPendingAgeMs: null,
        routes: { automatic: 0, escalation: 1, owner: 2 },
        sends: { deliveryUnknown: 0, failed: 0, sent: 0 },
      },
      backend: "ready",
      manifest: "verified",
      outcome: "ready",
      runnerCount: 1,
      runnerRevision: revision,
      tasks: { credentialSupervisor: "ready", watchdog: "ready" },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /customer|ticket|message|recipient|jobId|processId|credential(?:Id|Path|=)|commandLine|auth\.json|secret|https?:|[A-Z]:\\/i,
    );
  });
});

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
