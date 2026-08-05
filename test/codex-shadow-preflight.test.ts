import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexShadowPreflight } from "../src/runner/codex-shadow-preflight.js";
import type { CodexProcessInput, CodexProcessResult, CodexProcessRunner } from "../src/runner/codex-process-runner.js";
import type { SupportAutopilotShadowRunnerConfig } from "../src/runner/support-autopilot-shadow-runner.config.js";

describe("CodexShadowPreflight", () => {
  let root: string;
  let config: Extract<SupportAutopilotShadowRunnerConfig, { enabled: true }>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "support-shadow-preflight-"));
    const runtimeDir = path.join(root, "runtime");
    const codexHome = path.join(root, "codex-home");
    await Promise.all([mkdir(runtimeDir), mkdir(codexHome)]);
    const privacyAttestationPath = path.join(root, "privacy.json");
    const codexExecutablePath = path.join(root, "codex.exe");
    const nodeExecutablePath = path.join(root, "node.exe");
    const mcpLauncherPath = path.join(root, "support-autopilot-mcp-launcher.js");
    const credentialBlobPath = path.join(root, "token.dpapi");
    await Promise.all([
      writeFile(codexExecutablePath, ""),
      writeFile(nodeExecutablePath, ""),
      writeFile(mcpLauncherPath, ""),
      writeFile(credentialBlobPath, "encrypted"),
      writeFile(privacyAttestationPath, JSON.stringify({
        attestationId: "support-privacy-v1",
        dataControlsApproved: true,
        expiresAt: "2026-08-30T00:00:00.000Z",
        modelTrainingDisabled: false,
        privacyGateApproved: true,
        workspaceType: "business",
      })),
    ]);
    config = {
      adminApiBaseUrl: "https://admin.example.test/new-admin",
      budgetStatePath: path.join(root, "budget.json"),
      codexExecutablePath,
      codexHome,
      credentialBlobPath,
      dailyBudget: 25,
      enabled: true,
      mcpLauncherPath,
      nodeExecutablePath,
      privacyAttestationExpiresAt: "2026-08-30T00:00:00.000Z",
      privacyAttestationId: "support-privacy-v1",
      privacyAttestationPath,
      processTimeoutMs: 1_200_000,
      runtimeDir,
      workerId: "support-shadow.1",
    };
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  function validMcpList() {
    return JSON.stringify([{
      enabled: true,
      name: "support-autopilot",
      transport: {
        args: [config.mcpLauncherPath],
        command: config.nodeExecutablePath,
        cwd: null,
        env: {
          ADMIN_API_BASE_URL: config.adminApiBaseUrl,
          SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: config.credentialBlobPath,
        },
        env_vars: [],
        type: "stdio",
      },
    }]);
  }

  function createRunner(overrides: Partial<Record<string, CodexProcessResult>> = {}) {
    const run = vi.fn(async (input: CodexProcessInput): Promise<CodexProcessResult> => {
      const key = input.args.join(" ");
      if (overrides[key]) {
        return overrides[key];
      }
      if (key === "--version") {
        return { exitCode: 0, stderr: "", stdout: "codex-cli 1.2.3\n", timedOut: false };
      }
      if (key === "login status") {
        return { exitCode: 0, stderr: "", stdout: "Logged in using ChatGPT\n", timedOut: false };
      }
      if (key === "mcp list --json") {
        return { exitCode: 0, stderr: "", stdout: validMcpList(), timedOut: false };
      }
      return {
        exitCode: 0,
        stderr: "",
        stdout: [
          {
            item: {
              error: null,
              server: "support-autopilot",
              status: "in_progress",
              tool: "get_support_automation_health",
              type: "mcp_tool_call",
            },
            type: "item.started",
          },
          {
            item: {
              error: null,
              server: "support-autopilot",
              status: "completed",
              tool: "get_support_automation_health",
              type: "mcp_tool_call",
            },
            type: "item.completed",
          },
        ].map((event) => JSON.stringify(event)).join("\n") + "\n",
        timedOut: false,
      };
    });
    return { run } as CodexProcessRunner & { run: typeof run };
  }

  it("passes only for standalone ChatGPT auth, one MCP server, and a read-only health smoke", async () => {
    const runner = createRunner();
    const result = await new CodexShadowPreflight(config, runner).run(
      new Date("2026-08-04T09:00:00.000Z"),
    );

    expect(result).toEqual({ outcome: "ready" });
    const smoke = runner.run.mock.calls.at(-1)?.[0] as CodexProcessInput;
    expect(smoke.args).toEqual(expect.arrayContaining([
      "--disable",
      "shell_tool",
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
    ]));
    expect(smoke.stdin).toContain("get_support_automation_health");
    expect(JSON.stringify(smoke.environment)).not.toMatch(/service-secret|SUPPORT_AUTOPILOT_SERVICE_TOKEN/);
  });

  it("rejects the app-bundled WindowsApps executable before process execution", async () => {
    const runner = createRunner();
    config.codexExecutablePath = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\codex.exe";
    await expect(new CodexShadowPreflight(config, runner).run()).rejects.toThrow(
      "SUPPORT_AUTOPILOT_PREFLIGHT_FAILED",
    );
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("rejects failed version and API-key authentication", async () => {
    const failedVersion = createRunner({
      "--version": { exitCode: 1, stderr: "raw", stdout: "", timedOut: false },
    });
    await expect(new CodexShadowPreflight(config, failedVersion).run()).rejects.toThrow(
      "SUPPORT_AUTOPILOT_PREFLIGHT_FAILED",
    );

    const apiAuth = createRunner({
      "login status": { exitCode: 0, stderr: "", stdout: "Logged in using an API key\n", timedOut: false },
    });
    await expect(new CodexShadowPreflight(config, apiAuth).run()).rejects.toThrow(
      "SUPPORT_AUTOPILOT_PREFLIGHT_FAILED",
    );
  });

  it("accepts the exact ChatGPT login status when Codex writes it to stderr", async () => {
    const runner = createRunner({
      "login status": {
        exitCode: 0,
        stderr: "Logged in using ChatGPT\n",
        stdout: "",
        timedOut: false,
      },
    });

    await expect(new CodexShadowPreflight(config, runner).run(
      new Date("2026-08-04T09:00:00.000Z"),
    )).resolves.toEqual({ outcome: "ready" });
  });

  it("rejects extra MCP servers", async () => {
    const runner = createRunner({
      "mcp list --json": {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify([
          JSON.parse(validMcpList())[0],
          { enabled: true, name: "general-admin", transport: {} },
        ]),
        timedOut: false,
      },
    });
    await expect(new CodexShadowPreflight(config, runner).run()).rejects.toThrow(
      "SUPPORT_AUTOPILOT_PREFLIGHT_FAILED",
    );
  });

  it("rejects an expired or mismatched privacy attestation", async () => {
    await writeFile(config.privacyAttestationPath, JSON.stringify({
      attestationId: "different",
      dataControlsApproved: true,
      expiresAt: "2026-08-03T00:00:00.000Z",
      modelTrainingDisabled: false,
      privacyGateApproved: true,
      workspaceType: "business",
    }));
    await expect(new CodexShadowPreflight(config, createRunner()).run(
      new Date("2026-08-04T09:00:00.000Z"),
    )).rejects.toThrow("SUPPORT_AUTOPILOT_PREFLIGHT_FAILED");
  });

  it("rejects a non-empty runtime directory", async () => {
    await writeFile(path.join(config.runtimeDir, "customer.txt"), "data");
    await expect(new CodexShadowPreflight(config, createRunner()).run()).rejects.toThrow(
      "SUPPORT_AUTOPILOT_PREFLIGHT_FAILED",
    );
  });

  it("rejects a smoke run without a completed health MCP call", async () => {
    const runner = createRunner();
    runner.run = vi.fn(async (input: CodexProcessInput) => {
      if (input.args.includes("exec")) {
        return { exitCode: 0, stderr: "", stdout: "{\"type\":\"turn.completed\"}\n", timedOut: false };
      }
      return createRunner().run(input);
    });
    await expect(new CodexShadowPreflight(config, runner).run()).rejects.toThrow(
      "SUPPORT_AUTOPILOT_PREFLIGHT_FAILED",
    );
  });
});
