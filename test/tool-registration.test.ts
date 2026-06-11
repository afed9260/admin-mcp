import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiClient } from "../src/backend/admin-api-client.js";
import { AdminMcpConfig } from "../src/config.js";
import { createAdminMcpServer } from "../src/server.js";
import {
  registerAdminTools,
  registerReadOnlyTools,
  readonlyToolNames,
  safeAutomationToolNames,
  writeToolNames,
} from "../src/tools/register-tools.js";

const config: AdminMcpConfig = {
  adminApiBaseUrl: "https://malikbot.ru/new-admin",
  adminApiToken: "dummy",
  auditLogPath: "./audit/test-tool-registration.jsonl",
  enableWriteTools: false,
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
      "get_data_truth_audit",
      "get_identity_mapping_audit",
      "list_data_truth_audit_details",
      "list_bot_funnel_customers",
      "list_nudge_rules",
      "get_nudge_rule_candidates",
      "get_nudge_history",
      "list_support_tickets",
      "get_support_ticket",
      "get_support_summary",
      "get_support_waiting_items",
      "get_support_investigation",
      "get_customer_operations_profile",
      "list_referral_manual_review_items",
      "list_reactivation_campaign_runs",
      "list_reactivation_campaign_audience",
      "get_reactivation_campaign_state",
      "get_reactivation_delivery_eligibility",
      "get_reactivation_wave_2_readiness",
      "get_reactivation_wave_2_preview",
      "get_reactivation_wave_2_source_reconciliation",
    ]);

    expect(readonlyToolNames.join(" ")).not.toMatch(/create|update|delete|toggle|send|broadcast/i);
  });
});

describe("writeToolNames", () => {
  it("contains only the first guarded nudge write tools", () => {
    expect(writeToolNames).toEqual([
      "update_nudge_rule",
      "toggle_nudge_rule",
      "process_nudge_rule",
      "upload_nudge_photo",
      "send_nudge_test",
      "apply_reactivation_dialog_credits",
      "send_reactivation_notification",
      "send_reactivation_wave_2_preview",
      "execute_support_action_batch",
      "apply_customer_dialog_launch_credits",
      "apply_successful_dialog_debt_recovery",
      "approve_referral_manual_review_grant",
      "reject_referral_manual_review_grant",
    ]);
    expect(writeToolNames).not.toContain("investigate_support_ticket");
  });
});

describe("safeAutomationToolNames", () => {
  it("contains support automations that are available without risky writes", () => {
    expect(safeAutomationToolNames).toEqual([
      "investigate_support_ticket",
      "dry_run_customer_dialog_launch_credits",
      "dry_run_successful_dialog_debt_recovery",
      "dry_run_reactivation_dialog_credits",
      "dry_run_reactivation_notification",
    ]);
  });
});

describe("createAdminMcpServer", () => {
  it("registers readonly and safe automation tools without throwing", async () => {
    expect(() => createAdminMcpServer(config)).not.toThrow();

    const client = await connect(createAdminMcpServer(config));
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([...readonlyToolNames, ...safeAutomationToolNames]);
  });

  it("registers safe automation without enabling risky write tools", async () => {
    const disabledClient = await connect(createAdminMcpServer({ ...config, enableWriteTools: false }));
    const disabledToolNames = (await disabledClient.listTools()).tools.map((tool) => tool.name);

    expect(disabledToolNames).toEqual([...readonlyToolNames, ...safeAutomationToolNames]);
    expect(disabledToolNames).not.toEqual(expect.arrayContaining([...writeToolNames]));

    const enabledClient = await connect(createAdminMcpServer({ ...config, enableWriteTools: true }));
    expect((await enabledClient.listTools()).tools.map((tool) => tool.name)).toEqual([
      ...readonlyToolNames,
      ...safeAutomationToolNames,
      ...writeToolNames,
    ]);
  });

  it("keeps legacy readonly registration readonly even when write tools are enabled", async () => {
    const server = new McpServer({ name: "admin-mcp-readonly-test", version: "0.0.0" });
    const client = {
      get: vi.fn(async () => ({ ok: true })),
      post: vi.fn(async () => ({ ok: true })),
      postForm: vi.fn(async () => ({ ok: true })),
      put: vi.fn(async () => ({ ok: true })),
    } as unknown as AdminApiClient;

    registerReadOnlyTools(server, client, { ...config, enableWriteTools: true });
    const mcpClient = await connect(server);
    const { tools } = await mcpClient.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(readonlyToolNames);
  });

  it("publishes guarded mutation annotations for write tools", async () => {
    const client = await connect(createAdminMcpServer({ ...config, enableWriteTools: true }));
    const { tools } = await client.listTools();

    for (const tool of tools.filter((item) => writeToolNames.includes(item.name as (typeof writeToolNames)[number]))) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      });
    }
  });

  it("publishes guarded support action batch as a write tool only when write tools are enabled", async () => {
    const disabledClient = await connect(createAdminMcpServer({ ...config, enableWriteTools: false }));
    const disabledToolNames = (await disabledClient.listTools()).tools.map((tool) => tool.name);
    expect(disabledToolNames).not.toContain("execute_support_action_batch");

    const enabledClient = await connect(createAdminMcpServer({ ...config, enableWriteTools: true }));
    const tool = (await enabledClient.listTools()).tools.find(
      (item) => item.name === "execute_support_action_batch",
    );

    expect(tool).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
  });

  it("publishes customer operations apply as a write tool only when write tools are enabled", async () => {
    const disabledClient = await connect(createAdminMcpServer({ ...config, enableWriteTools: false }));
    const disabledToolNames = (await disabledClient.listTools()).tools.map((tool) => tool.name);
    expect(disabledToolNames).toContain("get_customer_operations_profile");
    expect(disabledToolNames).toContain("dry_run_customer_dialog_launch_credits");
    expect(disabledToolNames).toContain("dry_run_successful_dialog_debt_recovery");
    expect(disabledToolNames).toContain("list_referral_manual_review_items");
    expect(disabledToolNames).not.toContain("apply_customer_dialog_launch_credits");
    expect(disabledToolNames).not.toContain("apply_successful_dialog_debt_recovery");
    expect(disabledToolNames).not.toContain("approve_referral_manual_review_grant");
    expect(disabledToolNames).not.toContain("reject_referral_manual_review_grant");

    const enabledClient = await connect(createAdminMcpServer({ ...config, enableWriteTools: true }));
    const tool = (await enabledClient.listTools()).tools.find(
      (item) => item.name === "apply_customer_dialog_launch_credits",
    );

    expect(tool).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
  });

  it("publishes successful-dialog debt recovery apply as a write tool only when write tools are enabled", async () => {
    const disabledClient = await connect(createAdminMcpServer({ ...config, enableWriteTools: false }));
    const disabledToolNames = (await disabledClient.listTools()).tools.map((tool) => tool.name);
    expect(disabledToolNames).toContain("dry_run_successful_dialog_debt_recovery");
    expect(disabledToolNames).not.toContain("apply_successful_dialog_debt_recovery");

    const enabledClient = await connect(createAdminMcpServer({ ...config, enableWriteTools: true }));
    const tool = (await enabledClient.listTools()).tools.find(
      (item) => item.name === "apply_successful_dialog_debt_recovery",
    );

    expect(tool).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
  });

  it("publishes referral manual-review actions as write tools only when write tools are enabled", async () => {
    const disabledClient = await connect(createAdminMcpServer({ ...config, enableWriteTools: false }));
    const disabledToolNames = (await disabledClient.listTools()).tools.map((tool) => tool.name);
    expect(disabledToolNames).toContain("list_referral_manual_review_items");
    expect(disabledToolNames).not.toContain("approve_referral_manual_review_grant");
    expect(disabledToolNames).not.toContain("reject_referral_manual_review_grant");

    const enabledClient = await connect(createAdminMcpServer({ ...config, enableWriteTools: true }));
    const tools = (await enabledClient.listTools()).tools;
    const approveTool = tools.find((item) => item.name === "approve_referral_manual_review_grant");
    const rejectTool = tools.find((item) => item.name === "reject_referral_manual_review_grant");

    expect(approveTool).toBeDefined();
    expect(rejectTool).toBeDefined();
    expect(approveTool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    expect(rejectTool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
  });

  it("publishes safe automation annotations for support investigation", async () => {
    const client = await connect(createAdminMcpServer(config));
    const { tools } = await client.listTools();
    const tool = tools.find((item) => item.name === "investigate_support_ticket");

    expect(tool).toBeDefined();
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
  });

  it("redacts uploaded file bytes from mutation audit logs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "admin-mcp-tool-audit-"));
    const auditLogPath = join(dir, "audit.jsonl");
    const server = new McpServer({ name: "admin-mcp-test", version: "0.0.0" });
    const client = {
      get: vi.fn(),
      postForm: vi.fn(async () => ({ url: "https://malikbot.ru/new-admin/nudge/photos/photo.png" })),
    } as unknown as AdminApiClient;
    registerAdminTools(server, client, { ...config, auditLogPath, enableWriteTools: true });

    const mcpClient = await connect(server);
    const fileDataBase64 = Buffer.from("raw-photo-bytes").toString("base64");

    await mcpClient.callTool({
      name: "upload_nudge_photo",
      arguments: {
        confirm: true,
        fileDataBase64,
        fileName: "photo.png",
        mimeType: "image/png",
        reason: "audit redaction test",
      },
    });

    const auditLog = await readFile(auditLogPath, "utf8");

    expect(auditLog).not.toContain(fileDataBase64);
    expect(auditLog).toContain("[BASE64_FILE_BYTES_REDACTED]");
  });

  it("publishes readonly annotations for every tool", async () => {
    const client = await connect(createAdminMcpServer(config));
    const { tools } = await client.listTools();

    const readonlyTools = tools.filter((tool) => readonlyToolNames.includes(tool.name as (typeof readonlyToolNames)[number]));
    expect(readonlyTools).toHaveLength(readonlyToolNames.length);
    for (const tool of readonlyTools) {
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
    registerAdminTools(server, client, { ...config, auditLogPath: "\0bad-audit-path" });

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
    registerAdminTools(server, client, { ...config, auditLogPath: "\0bad-audit-path" });

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
