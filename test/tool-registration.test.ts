import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiClient } from "../src/backend/admin-api-client.js";
import { AdminMcpConfig } from "../src/config.js";
import { createAdminMcpServer } from "../src/server.js";
import { registerReadOnlyTools, readonlyToolNames } from "../src/tools/register-tools.js";

const config: AdminMcpConfig = {
  adminApiBaseUrl: "https://malikbot.ru/new-admin",
  adminApiToken: "dummy",
  auditLogPath: "./audit/test-tool-registration.jsonl",
};

const servers: McpServer[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.restoreAllMocks();
});

async function connect(server: McpServer) {
  const client = new Client({ name: "admin-mcp-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  servers.push(server);
  clients.push(client);

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function createClient(result: unknown) {
  return {
    get: vi.fn(async () => result),
  } as unknown as AdminApiClient;
}

describe("readonlyToolNames", () => {
  it("does not expose write tools", () => {
    expect(readonlyToolNames).toEqual([
      "get_funnel_stats",
      "get_cost_stats",
      "list_dialogs",
      "get_dialog",
      "get_bot_funnel_stats",
      "list_nudge_rules",
      "get_nudge_rule_candidates",
      "get_nudge_history",
    ]);

    expect(readonlyToolNames.join(" ")).not.toMatch(/create|update|delete|toggle|send|broadcast/i);
  });
});

describe("createAdminMcpServer", () => {
  it("registers readonly tools without throwing", async () => {
    expect(() => createAdminMcpServer(config)).not.toThrow();

    const client = await connect(createAdminMcpServer(config));
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(readonlyToolNames);
  });

  it("publishes readonly annotations for every tool", async () => {
    const client = await connect(createAdminMcpServer(config));
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(readonlyToolNames.length);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
    }
  });

  it("rejects unknown arguments for zero-arg tools before reaching the backend", async () => {
    const client = await connect(createAdminMcpServer(config));

    const result = await client.callTool({
      name: "list_nudge_rules",
      arguments: { unexpected: true },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringMatching(/Input validation error|Unrecognized key/),
    });
  });

  it("returns a successful tool result when audit logging fails", async () => {
    const server = new McpServer({ name: "admin-mcp-test", version: "0.0.0" });
    const client = createClient([{ id: "rule-1" }]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    registerReadOnlyTools(server, client, { ...config, auditLogPath: "\0bad-audit-path" });

    const mcpClient = await connect(server);
    const result = await mcpClient.callTool({
      name: "list_nudge_rules",
      arguments: {},
    });

    expect(result.content).toEqual([{ type: "text", text: JSON.stringify([{ id: "rule-1" }], null, 2) }]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("preserves the original tool error when failure audit logging fails", async () => {
    const server = new McpServer({ name: "admin-mcp-test", version: "0.0.0" });
    const client = {
      get: vi.fn(async () => {
        throw new Error("backend failed");
      }),
    } as unknown as AdminApiClient;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    registerReadOnlyTools(server, client, { ...config, auditLogPath: "\0bad-audit-path" });

    const mcpClient = await connect(server);

    const result = await mcpClient.callTool({
      name: "list_nudge_rules",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "backend failed" }]);
    expect(errorSpy).toHaveBeenCalled();
  });
});
