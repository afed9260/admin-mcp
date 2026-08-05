import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexProcessInput, CodexProcessRunner } from "../src/runner/codex-process-runner.js";
import {
  SupportAutopilotReadinessDoctor,
  createReadinessCodexChildEnvironment,
} from "../src/runner/support-autopilot-readiness.js";
import type { SupportAutopilotReadinessConfig } from "../src/runner/support-autopilot-readiness.config.js";

describe("SupportAutopilotReadinessDoctor", () => {
  let root: string;
  let config: SupportAutopilotReadinessConfig;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "support-readiness-"));
    const codexHome = path.join(root, "codex-home");
    const runtimeDir = path.join(root, "runtime");
    await Promise.all([mkdir(codexHome), mkdir(runtimeDir)]);
    config = {
      codexExecutablePath: await file("codex.exe"),
      codexHome,
      configurationBlockers: [],
      credentialBlobPath: await file("credential.dpapi", "encrypted-not-readable-by-doctor"),
      mcpLauncherPath: await file("support-autopilot-mcp-launcher.js"),
      nodeExecutablePath: await file("node.exe"),
      plaintextTokenPresent: false,
      privacyAttestationExpiresAt: "2026-08-30T00:00:00.000Z",
      privacyAttestationId: "support-privacy-v1",
      privacyAttestationPath: await file("privacy.json", JSON.stringify({
        attestationId: "support-privacy-v1",
        dataControlsApproved: true,
        expiresAt: "2026-08-30T00:00:00.000Z",
        modelTrainingDisabled: true,
        privacyGateApproved: true,
        workspaceType: "pro",
      })),
      processTimeoutMs: 120_000,
      runtimeDir,
    };
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  async function file(name: string, contents = "fixture"): Promise<string> {
    const target = path.join(root, name);
    await writeFile(target, contents, "utf8");
    return target;
  }

  function mcpProfile() {
    return JSON.stringify([{
      enabled: true,
      name: "support-autopilot",
      transport: {
        args: [config.mcpLauncherPath],
        command: config.nodeExecutablePath,
        cwd: null,
        env: {
          ADMIN_API_BASE_URL: "https://admin.example.test/new-admin",
          SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: config.credentialBlobPath,
        },
        env_vars: [],
        type: "stdio",
      },
    }]);
  }

  function runner(overrides: Partial<Record<string, string>> = {}) {
    const run = vi.fn(async (input: CodexProcessInput) => ({
      exitCode: 0,
      stderr: "",
      stdout: overrides[input.args.join(" ")] ?? {
        "--version": "codex-cli 0.146.0\n",
        "login status": "Logged in using ChatGPT\n",
        "mcp list --json": mcpProfile(),
      }[input.args.join(" ")] ?? "",
      timedOut: false,
    }));
    return { run } as CodexProcessRunner & { run: typeof run };
  }

  it("reports a fully ready local profile without reading the credential blob", async () => {
    const processRunner = runner();
    const read = vi.fn(readFile);
    const doctor = new SupportAutopilotReadinessDoctor(config, processRunner, {
      readFile: read,
      readdir,
      stat,
    });

    const result = await doctor.run(new Date("2026-08-05T10:00:00.000Z"));

    expect(result).toEqual({
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
    });
    expect(processRunner.run.mock.calls.map(([input]) => input.args)).toEqual([
      ["--version"],
      ["login", "status"],
      ["mcp", "list", "--json"],
    ]);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(config.privacyAttestationPath, "utf8");
    expect(JSON.stringify(processRunner.run.mock.calls)).not.toMatch(/ADMIN_API|TOKEN|CREDENTIAL/i);
  });

  it("reports absent credential and attestation while keeping independent checks ready", async () => {
    await Promise.all([
      rm(config.credentialBlobPath!),
      rm(config.privacyAttestationPath!),
    ]);

    const result = await new SupportAutopilotReadinessDoctor(config, runner()).run(
      new Date("2026-08-05T10:00:00.000Z"),
    );

    expect(result.outcome).toBe("blocked");
    expect(result.blockers).toEqual([
      "credential_blob_unavailable",
      "privacy_attestation_unavailable",
    ]);
    expect(result.checks).toEqual(expect.arrayContaining([
      { id: "codex_cli", status: "ready" },
      { id: "mcp_profile", status: "ready" },
      { id: "credential_blob", status: "blocked" },
      { id: "privacy_attestation", status: "blocked" },
    ]));
  });

  it("does not invoke Codex when a plaintext token is present", async () => {
    const processRunner = runner();
    config = {
      ...config,
      configurationBlockers: ["plaintext_token_present"],
      plaintextTokenPresent: true,
    };

    const result = await new SupportAutopilotReadinessDoctor(config, processRunner).run();

    expect(processRunner.run).not.toHaveBeenCalled();
    expect(result.blockers).toContain("plaintext_token_present");
    expect(result.checks.slice(0, 3).every((check) => check.status === "blocked")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("encrypted-not-readable-by-doctor");
  });

  it("blocks process checks for a non-empty runtime", async () => {
    await writeFile(path.join(config.runtimeDir!, "customer.txt"), "forbidden", "utf8");
    const processRunner = runner();

    const result = await new SupportAutopilotReadinessDoctor(config, processRunner).run();

    expect(processRunner.run).not.toHaveBeenCalled();
    expect(result.blockers).toEqual(expect.arrayContaining([
      "codex_cli_prerequisite_blocked",
      "codex_login_prerequisite_blocked",
      "mcp_profile_prerequisite_blocked",
      "runtime_not_empty",
    ]));
    expect(JSON.stringify(result)).not.toContain("customer.txt");
  });

  it("keeps invalid login and MCP details redacted", async () => {
    const processRunner = runner({
      "login status": "Logged in using an API key\n",
      "mcp list --json": JSON.stringify([
        JSON.parse(mcpProfile())[0],
        { enabled: true, name: "other", transport: {} },
      ]),
    });

    const result = await new SupportAutopilotReadinessDoctor(config, processRunner).run();

    expect(result.blockers).toEqual(expect.arrayContaining([
      "codex_login_invalid",
      "mcp_profile_invalid",
    ]));
    expect(JSON.stringify(result)).not.toMatch(/API key|other|stdout|stderr|\\/i);
  });

  it("creates a minimal child environment", () => {
    const child = createReadinessCodexChildEnvironment(config);
    expect(child.CODEX_HOME).toBe(config.codexHome);
    expect(JSON.stringify(child)).not.toMatch(/ADMIN_API|TOKEN|CREDENTIAL|SERVICE/i);
  });
});
