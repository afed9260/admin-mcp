import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CodexSyntheticPreflight,
  createSyntheticCodexChildEnvironment,
} from "../src/synthetic/codex-synthetic-preflight.js";
import type { CodexProcessInput, CodexProcessRunner } from "../src/runner/codex-process-runner.js";
import type { SupportAutopilotSyntheticCanaryConfig } from "../src/synthetic/support-autopilot-synthetic-canary.config.js";

type EnabledConfig = Extract<SupportAutopilotSyntheticCanaryConfig, { enabled: true }>;

describe("CodexSyntheticPreflight", () => {
  let config: EnabledConfig;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "support-synthetic-preflight-"));
    const codexHome = path.join(root, "codex-home");
    const runtimeDir = path.join(root, "runtime");
    await Promise.all([mkdir(codexHome), mkdir(runtimeDir)]);
    config = {
      codexExecutablePath: await file("codex.exe"),
      codexHome,
      enabled: true,
      mcpEntryPath: await file("synthetic-mcp.js"),
      nodeExecutablePath: await file("node.exe"),
      processTimeoutMs: 120_000,
      runtimeDir,
      workerId: "support-synthetic.1",
    };
  });

  async function file(name: string): Promise<string> {
    const target = path.join(root, name);
    await writeFile(target, "fixture", "utf8");
    return target;
  }

  function mcp(overrides: Record<string, unknown> = {}) {
    return [{
      enabled: true,
      name: "support-autopilot",
      transport: {
        args: [config.mcpEntryPath],
        command: config.nodeExecutablePath,
        cwd: null,
        env: null,
        env_vars: ["SUPPORT_AUTOPILOT_WORK_KIND"],
        type: "stdio",
        ...overrides,
      },
    }];
  }

  function runner(options: {
    login?: string;
    loginOnStderr?: boolean;
    mcp?: unknown;
    nonzeroAt?: number;
    timedOutAt?: number;
    version?: string;
  } = {}) {
    let call = 0;
    const outputs = [
      options.version ?? "codex-cli 0.146.0\n",
      options.login ?? "Logged in using ChatGPT\n",
      JSON.stringify(options.mcp ?? mcp()),
    ];
    const run = vi.fn(async () => {
      const index = call++;
      return {
        exitCode: options.nonzeroAt === index ? 1 : 0,
        stderr: options.loginOnStderr && index === 1 ? outputs[index] ?? "" : "",
        stdout: options.loginOnStderr && index === 1 ? "" : outputs[index] ?? "",
        timedOut: options.timedOutAt === index,
      };
    });
    return { run } as CodexProcessRunner & { run: typeof run };
  }

  it("validates standalone login and the exact one-server allowlist", async () => {
    const processRunner = runner();
    await expect(new CodexSyntheticPreflight(config, processRunner).run())
      .resolves.toEqual({ outcome: "ready" });

    const inputs = processRunner.run.mock.calls.map(([input]) => input as CodexProcessInput);
    expect(inputs.map((input) => input.args)).toEqual([
      ["--version"],
      ["login", "status"],
      ["mcp", "list", "--json"],
    ]);
    expect(inputs.every((input) => input.cwd === config.runtimeDir)).toBe(true);
    expect(JSON.stringify(inputs.map((input) => input.environment)))
      .not.toMatch(/ADMIN_API|TOKEN|CREDENTIAL|SERVICE/i);
    expect(createSyntheticCodexChildEnvironment(config)).toMatchObject({
      CODEX_HOME: config.codexHome,
    });
  });

  it("accepts the exact ChatGPT login status when Codex writes it to stderr", async () => {
    await expect(new CodexSyntheticPreflight(config, runner({ loginOnStderr: true })).run())
      .resolves.toEqual({ outcome: "ready" });
  });

  it("rejects a non-empty runtime and missing files", async () => {
    await writeFile(path.join(config.runtimeDir, "unexpected.txt"), "x", "utf8");
    await expect(new CodexSyntheticPreflight(config, runner()).run())
      .rejects.toThrow("SUPPORT_AUTOPILOT_SYNTHETIC_PREFLIGHT_FAILED");

    const missing = { ...config, mcpEntryPath: path.join(root, "missing.js") };
    await expect(new CodexSyntheticPreflight(missing, runner()).run())
      .rejects.toThrow("SUPPORT_AUTOPILOT_SYNTHETIC_PREFLIGHT_FAILED");
  });

  it.each([
    ["invalid version", { version: "Codex unknown\n" }],
    ["API login", { login: "Logged in using an API key\n" }],
    ["malformed MCP JSON", { mcp: "not-json" }],
    ["nonzero process", { nonzeroAt: 0 }],
    ["timed out process", { timedOutAt: 1 }],
  ])("rejects %s", async (_name, options) => {
    const processRunner = options.mcp === "not-json"
      ? runner({ ...options, mcp: undefined })
      : runner(options);
    if (options.mcp === "not-json") {
      processRunner.run.mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        stdout: "codex-cli 0.146.0\n",
        timedOut: false,
      }).mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        stdout: "Logged in using ChatGPT\n",
        timedOut: false,
      }).mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        stdout: "not-json",
        timedOut: false,
      });
    }
    await expect(new CodexSyntheticPreflight(config, processRunner).run())
      .rejects.toThrow("SUPPORT_AUTOPILOT_SYNTHETIC_PREFLIGHT_FAILED");
  });

  it.each([
    ["extra server", () => [...mcp(), ...mcp()]],
    ["wrong name", () => [{ ...mcp()[0], name: "other" }]],
    ["disabled", () => [{ ...mcp()[0], enabled: false }]],
    ["wrong command", () => mcp({ command: path.join(root, "other-node.exe") })],
    ["wrong entry", () => mcp({ args: [path.join(root, "other.js")] })],
    ["working directory", () => mcp({ cwd: root })],
    ["configured environment", () => mcp({ env: { SAFE: "still-forbidden" } })],
    ["missing work-kind env var", () => mcp({ env_vars: [] })],
    ["wrong env var", () => mcp({ env_vars: ["PATH"] })],
  ])("rejects MCP profile with %s", async (_name, buildMcp) => {
    await expect(new CodexSyntheticPreflight(config, runner({ mcp: buildMcp() })).run())
      .rejects.toThrow("SUPPORT_AUTOPILOT_SYNTHETIC_PREFLIGHT_FAILED");
  });
});
