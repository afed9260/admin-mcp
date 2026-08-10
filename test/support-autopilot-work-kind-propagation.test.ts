import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { assertSupportAutopilotMcpProfile } from "../src/runner/codex-profile-validation.js";
import type { CodexProcessInput, CodexProcessRunner } from "../src/runner/codex-process-runner.js";
import { runCodexSupportDecision } from "../src/runner/codex-support-decision-execution.js";
import { launchSupportAutopilotMcp } from "../src/runner/support-autopilot-mcp-launcher.js";
import { createSyntheticSupportAutopilotMcpServer } from "../src/synthetic/synthetic-support-autopilot-mcp.js";
import {
  parseSupportAutopilotToolScope,
  revisionSupportAutopilotToolNames,
} from "../src/tools/support-autopilot-tools.js";

describe("support autopilot work-kind propagation", () => {
  it("forwards a revision scope from Codex through the launcher to the MCP tool set", async () => {
    const nodeExecutablePath = "C:\\Program Files\\nodejs\\node.exe";
    const mcpEntryPath = "C:\\ServiceApp\\dist\\runner\\support-autopilot-mcp-launcher.js";
    expect(() => assertSupportAutopilotMcpProfile(JSON.stringify([{
      enabled: true,
      name: "support-autopilot",
      transport: {
        args: [mcpEntryPath],
        command: nodeExecutablePath,
        cwd: null,
        env: null,
        env_vars: ["SUPPORT_AUTOPILOT_WORK_KIND"],
        type: "stdio",
      },
    }]), { mcpEntryPath, nodeExecutablePath })).not.toThrow();

    let codexInput: CodexProcessInput | undefined;
    const processRunner = {
      run: vi.fn(async (input: CodexProcessInput) => {
        codexInput = input;
        return {
          exitCode: 0,
          stderr: "",
          stdout: `${JSON.stringify({
            item: {
              error: null,
              server: "support-autopilot",
              status: "completed",
              tool: "submit_support_automation_revision",
              type: "mcp_tool_call",
            },
            type: "item.completed",
          })}\n`,
          timedOut: false,
        };
      }),
    } as CodexProcessRunner;
    await runCodexSupportDecision({
      assignedRevision: {
        leaseToken: "A".repeat(43),
        revisionJobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      },
      childEnvironment: { CODEX_HOME: "C:\\Support\\codex-home" },
      codexExecutablePath: "C:\\Tools\\codex.exe",
      processTimeoutMs: 120_000,
      runtimeDir: "C:\\Support\\runtime",
      workerId: "support-shadow.1",
      workKind: "revision",
    }, processRunner);

    const child = new EventEmitter();
    const spawn = vi.fn(() => child as never);
    const launching = launchSupportAutopilotMcp({
      ...codexInput?.environment,
      ADMIN_API_BASE_URL: "https://admin.example.test/new-admin",
      SUPPORT_AUTOPILOT_CREDENTIAL_BLOB_PATH: "C:\\Secrets\\token.dpapi",
    }, {
      mcpServerEntryPath: "C:\\ServiceApp\\dist\\index.js",
      nodeExecutablePath,
      secretProvider: { read: vi.fn().mockResolvedValue("service-secret") },
      spawn,
    });
    await Promise.resolve();
    child.emit("close", 0);
    await expect(launching).resolves.toBe(0);

    const spawnedEnvironment = spawn.mock.calls[0][2].env;
    const scope = parseSupportAutopilotToolScope(
      spawnedEnvironment.SUPPORT_AUTOPILOT_WORK_KIND,
    );
    const server = createSyntheticSupportAutopilotMcpServer(scope);
    const client = new Client({ name: "scope-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name))
        .toEqual(revisionSupportAutopilotToolNames);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
