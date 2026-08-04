import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const windowsDescribe = process.platform === "win32" ? describe : describe.skip;

windowsDescribe("new support autopilot credential script", () => {
  it("creates a private DPAPI blob, returns hash-only metadata, and refuses overwrite", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "support-autopilot-provision-"));
    const credentialPath = path.join(directory, "credential.dpapi");
    const scriptPath = path.resolve("scripts/new-support-autopilot-credential.ps1");

    const first = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-OutputPath",
        credentialPath,
      ],
      { encoding: "utf8", windowsHide: true },
    );

    expect(first.status, first.stderr).toBe(0);
    const metadata = JSON.parse(first.stdout.trim()) as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual(["expiresAt", "issuedAt", "tokenSha256"]);
    expect(metadata.tokenSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(new Date(String(metadata.issuedAt)).toISOString()).toBe(metadata.issuedAt);
    expect(new Date(String(metadata.expiresAt)).toISOString()).toBe(metadata.expiresAt);
    expect(
      new Date(String(metadata.expiresAt)).getTime() -
        new Date(String(metadata.issuedAt)).getTime(),
    ).toBe(23 * 60 * 60 * 1000);

    const encryptedBefore = readFileSync(credentialPath, "utf8");
    expect(encryptedBefore.length).toBeGreaterThan(100);
    expect(first.stdout).not.toContain("credential.dpapi");

    const probe = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "$encrypted = [IO.File]::ReadAllText($env:SUPPORT_AUTOPILOT_TEST_BLOB, [Text.Encoding]::UTF8)",
          "$secure = ConvertTo-SecureString -String $encrypted",
          "$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
          "try {",
          "  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)",
          "  $bytes = [Text.Encoding]::UTF8.GetBytes($plain)",
          "  try {",
          "    $sha = [Security.Cryptography.SHA256]::Create()",
          "    try { $hash = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }",
          "    -join ($hash | ForEach-Object { $_.ToString('x2') })",
          "  } finally { [Array]::Clear($bytes, 0, $bytes.Length) }",
          "} finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }",
        ].join("; "),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, SUPPORT_AUTOPILOT_TEST_BLOB: credentialPath },
        windowsHide: true,
      },
    );
    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.stdout.trim()).toBe(metadata.tokenSha256);

    const aclProbe = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "$acl = Get-Acl -LiteralPath $env:SUPPORT_AUTOPILOT_TEST_BLOB",
          "$rules = @($acl.Access | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)",
          "[pscustomobject]@{ protected = $acl.AreAccessRulesProtected; rules = $rules } | ConvertTo-Json -Compress",
        ].join("; "),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, SUPPORT_AUTOPILOT_TEST_BLOB: credentialPath },
        windowsHide: true,
      },
    );
    expect(aclProbe.status, aclProbe.stderr).toBe(0);
    const acl = JSON.parse(aclProbe.stdout.trim()) as { protected: boolean; rules: string[] };
    const currentIdentity = spawnSync("whoami.exe", [], {
      encoding: "utf8",
      windowsHide: true,
    }).stdout.trim();
    expect(acl.protected).toBe(true);
    expect(acl.rules.map((rule) => rule.toLowerCase())).toEqual([
      currentIdentity.toLowerCase(),
    ]);

    const second = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-OutputPath",
        credentialPath,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    expect(second.status).not.toBe(0);
    expect(readFileSync(credentialPath, "utf8")).toBe(encryptedBefore);
  });
});
