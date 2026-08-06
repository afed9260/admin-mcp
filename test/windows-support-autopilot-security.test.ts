import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const windowsDescribe = process.platform === "win32" ? describe : describe.skip;

windowsDescribe("Windows support autopilot security helpers", () => {
  it("protects state for the current user and writes bounded redacted events", () => {
    const root = mkdtempSync(path.join(tmpdir(), "support-autopilot-security-"));
    const eventPath = path.join(root, "credential-rotation.events.jsonl");
    const helperPath = path.resolve("scripts", "support-autopilot-windows-security.ps1");
    try {
      const result = spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        [
          ". $env:SUPPORT_AUTOPILOT_TEST_HELPER",
          "Set-SupportAutopilotCurrentUserAcl -Path $env:SUPPORT_AUTOPILOT_TEST_ROOT -Container",
          "Set-SupportAutopilotCurrentUserAcl -Path $env:SUPPORT_AUTOPILOT_TEST_ROOT -Container",
          "Write-SupportAutopilotRedactedEvent -EventPath $env:SUPPORT_AUTOPILOT_TEST_EVENT -EventCode 'credential_rotation_stage' -Stage 'candidate_ready'",
          "$acl = Get-Acl -LiteralPath $env:SUPPORT_AUTOPILOT_TEST_EVENT",
          "$rules = @($acl.Access | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)",
          "[pscustomobject]@{ protected = $acl.AreAccessRulesProtected; rules = $rules } | ConvertTo-Json -Compress",
        ].join("; "),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          SUPPORT_AUTOPILOT_TEST_EVENT: eventPath,
          SUPPORT_AUTOPILOT_TEST_HELPER: helperPath,
          SUPPORT_AUTOPILOT_TEST_ROOT: root,
        },
        windowsHide: true,
      });

      expect(result.status, result.stderr).toBe(0);
      const acl = JSON.parse(result.stdout.trim()) as { protected: boolean; rules: string[] };
      const currentIdentity = spawnSync("whoami.exe", [], {
        encoding: "utf8",
        windowsHide: true,
      }).stdout.trim().toLowerCase();
      expect(acl.protected).toBe(true);
      expect(acl.rules.map((rule) => rule.toLowerCase())).toEqual([currentIdentity]);

      const event = JSON.parse(readFileSync(eventPath, "utf8").trim()) as Record<string, unknown>;
      expect(Object.keys(event).sort()).toEqual(["eventCode", "stage", "timestamp"]);
      expect(event).toMatchObject({
        eventCode: "credential_rotation_stage",
        stage: "candidate_ready",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects plaintext token variables without echoing their value", () => {
    const helperPath = path.resolve("scripts", "support-autopilot-windows-security.ps1");
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        ". $env:SUPPORT_AUTOPILOT_TEST_HELPER",
        "try { Assert-NoSupportAutopilotPlaintextTokenEnvironment } catch { $_.Exception.Message; exit 7 }",
      ].join("; "),
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        SUPPORT_AUTOPILOT_SERVICE_TOKEN: "synthetic-plaintext-token",
        SUPPORT_AUTOPILOT_TEST_HELPER: helperPath,
      },
      windowsHide: true,
    });

    expect(result.status).toBe(7);
    expect(result.stdout.trim()).toBe("plaintext_token_environment_present");
    expect(result.stdout + result.stderr).not.toContain("synthetic-plaintext-token");
  });
});
