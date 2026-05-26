import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appendAuditEvent } from "../audit/audit-log.js";
import { AdminApiClient } from "../backend/admin-api-client.js";
import { AdminMcpConfig } from "../config.js";
import { createDialogTools } from "./dialog-tools.js";
import { createNudgeTools } from "./nudge-tools.js";
import {
  botFunnelCustomersQuerySchema,
  botFunnelQuerySchema,
  costQuerySchema,
  dialogDetailQuerySchema,
  dialogsQuerySchema,
  funnelQuerySchema,
  nudgeCandidatesQuerySchema,
  nudgeHistoryQuerySchema,
} from "./schemas.js";
import { createStatisticsTools } from "./statistics-tools.js";

export const readonlyToolNames = [
  "get_funnel_stats",
  "get_cost_stats",
  "list_dialogs",
  "get_dialog",
  "get_bot_funnel_stats",
  "list_bot_funnel_customers",
  "list_nudge_rules",
  "get_nudge_rule_candidates",
  "get_nudge_history",
] as const;

type ToolName = (typeof readonlyToolNames)[number];

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

function toolResponse(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function unwrapObjectSchema(schema: z.ZodTypeAny): z.AnyZodObject {
  let current = schema;
  while (current instanceof z.ZodEffects) {
    current = current.innerType();
  }

  if (current instanceof z.ZodObject) {
    return current;
  }

  throw new Error("Tool input schema must be a Zod object");
}

function inputSchema(schema: z.ZodTypeAny): z.AnyZodObject {
  return z.object(unwrapObjectSchema(schema).shape).strict();
}

async function appendAuditEventSafely(
  config: AdminMcpConfig,
  event: Parameters<typeof appendAuditEvent>[1],
): Promise<void> {
  try {
    await appendAuditEvent(config.auditLogPath, event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to append audit event for ${event.toolName}: ${message}`);
  }
}

function successMetadata(data: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(data)) {
    return { itemCount: data.length };
  }

  if (typeof data === "object" && data !== null && "items" in data) {
    const items = (data as { items?: unknown }).items;
    if (Array.isArray(items)) {
      return { itemCount: items.length };
    }
  }

  return undefined;
}

function failureMetadata(error: unknown): Record<string, unknown> {
  return { error: error instanceof Error ? error.message : String(error) };
}

async function runWithAudit(
  config: AdminMcpConfig,
  toolName: ToolName,
  endpoint: string,
  input: unknown,
  handler: (input: unknown) => Promise<unknown>,
) {
  try {
    const data = await handler(input);
    await appendAuditEventSafely(config, {
      timestamp: new Date().toISOString(),
      toolName,
      input,
      endpoint,
      status: "success",
      metadata: successMetadata(data),
    });
    return toolResponse(data);
  } catch (error) {
    await appendAuditEventSafely(config, {
      timestamp: new Date().toISOString(),
      toolName,
      input,
      endpoint,
      status: "failure",
      metadata: failureMetadata(error),
    });
    throw error;
  }
}

export function registerReadOnlyTools(server: McpServer, client: AdminApiClient, config: AdminMcpConfig): void {
  const statisticsTools = createStatisticsTools(client);
  const dialogTools = createDialogTools(client);
  const nudgeTools = createNudgeTools(client);

  server.registerTool(
    "get_funnel_stats",
    {
      description: "Get readonly funnel statistics grouped by chain, day, week, or user.",
      inputSchema: inputSchema(funnelQuerySchema),
      annotations: readOnlyAnnotations,
    },
    (input) => runWithAudit(config, "get_funnel_stats", "/statistics/funnel", input, statisticsTools.getFunnelStats),
  );

  server.registerTool(
    "get_cost_stats",
    {
      description: "Get readonly AI cost summary and detailed cost statistics.",
      inputSchema: inputSchema(costQuerySchema),
      annotations: readOnlyAnnotations,
    },
    (input) => runWithAudit(config, "get_cost_stats", "/statistics/costs", input, statisticsTools.getCostStats),
  );

  server.registerTool(
    "list_dialogs",
    {
      description: "List readonly dialog summaries with filters and pagination.",
      inputSchema: inputSchema(dialogsQuerySchema),
      annotations: readOnlyAnnotations,
    },
    (input) => runWithAudit(config, "list_dialogs", "/statistics/dialogs", input, dialogTools.listDialogs),
  );

  server.registerTool(
    "get_dialog",
    {
      description: "Get readonly dialog details for a chat.",
      inputSchema: inputSchema(dialogDetailQuerySchema),
      annotations: readOnlyAnnotations,
    },
    (input) => runWithAudit(config, "get_dialog", "/statistics/dialogs/{chatId}", input, dialogTools.getDialog),
  );

  server.registerTool(
    "get_bot_funnel_stats",
    {
      description: "Get readonly bot funnel statistics.",
      inputSchema: inputSchema(botFunnelQuerySchema),
      annotations: readOnlyAnnotations,
    },
    (input) =>
      runWithAudit(config, "get_bot_funnel_stats", "/statistics/bot-funnel", input, statisticsTools.getBotFunnelStats),
  );

  server.registerTool(
    "list_bot_funnel_customers",
    {
      description: "List readonly customers on bot onboarding funnel steps with filters and pagination.",
      inputSchema: inputSchema(botFunnelCustomersQuerySchema),
      annotations: readOnlyAnnotations,
    },
    (input) =>
      runWithAudit(
        config,
        "list_bot_funnel_customers",
        "/statistics/bot-funnel-customers",
        input,
        statisticsTools.listBotFunnelCustomers,
      ),
  );

  server.registerTool(
    "list_nudge_rules",
    {
      description: "List readonly nudge rules.",
      inputSchema: z.object({}).strict(),
      annotations: readOnlyAnnotations,
    },
    (input) => runWithAudit(config, "list_nudge_rules", "/nudge/rules", input, () => nudgeTools.listNudgeRules()),
  );

  server.registerTool(
    "get_nudge_rule_candidates",
    {
      description: "Get readonly candidate dialogs for a nudge rule.",
      inputSchema: inputSchema(nudgeCandidatesQuerySchema),
      annotations: readOnlyAnnotations,
    },
    (input) =>
      runWithAudit(
        config,
        "get_nudge_rule_candidates",
        "/nudge/rules/{ruleId}/candidates",
        input,
        nudgeTools.getNudgeRuleCandidates,
      ),
  );

  server.registerTool(
    "get_nudge_history",
    {
      description: "Get readonly nudge history for a rule.",
      inputSchema: inputSchema(nudgeHistoryQuerySchema),
      annotations: readOnlyAnnotations,
    },
    (input) => runWithAudit(config, "get_nudge_history", "/nudge/history", input, nudgeTools.getNudgeHistory),
  );
}
