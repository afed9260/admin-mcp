import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { appendAuditEvent } from "../audit/audit-log.js";
import { AdminApiClient } from "../backend/admin-api-client.js";
import { AdminMcpConfig } from "../config.js";
import { createDialogTools } from "./dialog-tools.js";
import { createNudgeTools } from "./nudge-tools.js";
import {
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
  "list_nudge_rules",
  "get_nudge_rule_candidates",
  "get_nudge_history",
] as const;

type ToolName = (typeof readonlyToolNames)[number];

function toolResponse(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function inputShape(schema: z.ZodTypeAny): ZodRawShape {
  const objectSchema = schema instanceof z.ZodEffects ? schema.innerType() : schema;

  if (objectSchema instanceof z.ZodObject) {
    return objectSchema.shape;
  }

  throw new Error("Tool input schema must be a Zod object");
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
    await appendAuditEvent(config.auditLogPath, {
      timestamp: new Date().toISOString(),
      toolName,
      input,
      endpoint,
      status: "success",
      metadata: successMetadata(data),
    });
    return toolResponse(data);
  } catch (error) {
    await appendAuditEvent(config.auditLogPath, {
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
      inputSchema: inputShape(funnelQuerySchema),
    },
    (input) => runWithAudit(config, "get_funnel_stats", "/statistics/funnel", input, statisticsTools.getFunnelStats),
  );

  server.registerTool(
    "get_cost_stats",
    {
      description: "Get readonly AI cost summary and detailed cost statistics.",
      inputSchema: inputShape(costQuerySchema),
    },
    (input) => runWithAudit(config, "get_cost_stats", "/statistics/costs", input, statisticsTools.getCostStats),
  );

  server.registerTool(
    "list_dialogs",
    {
      description: "List readonly dialog summaries with filters and pagination.",
      inputSchema: inputShape(dialogsQuerySchema),
    },
    (input) => runWithAudit(config, "list_dialogs", "/statistics/dialogs", input, dialogTools.listDialogs),
  );

  server.registerTool(
    "get_dialog",
    {
      description: "Get readonly dialog details for a chat.",
      inputSchema: inputShape(dialogDetailQuerySchema),
    },
    (input) => runWithAudit(config, "get_dialog", "/statistics/dialogs/{chatId}", input, dialogTools.getDialog),
  );

  server.registerTool(
    "get_bot_funnel_stats",
    {
      description: "Get readonly bot funnel statistics.",
      inputSchema: inputShape(botFunnelQuerySchema),
    },
    (input) =>
      runWithAudit(config, "get_bot_funnel_stats", "/statistics/bot-funnel", input, statisticsTools.getBotFunnelStats),
  );

  server.registerTool(
    "list_nudge_rules",
    {
      description: "List readonly nudge rules.",
      inputSchema: {},
    },
    (input) => runWithAudit(config, "list_nudge_rules", "/nudge/rules", input, () => nudgeTools.listNudgeRules()),
  );

  server.registerTool(
    "get_nudge_rule_candidates",
    {
      description: "Get readonly candidate dialogs for a nudge rule.",
      inputSchema: inputShape(nudgeCandidatesQuerySchema),
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
      description: "Get readonly nudge send history for a rule.",
      inputSchema: inputShape(nudgeHistoryQuerySchema),
    },
    (input) => runWithAudit(config, "get_nudge_history", "/nudge/history", input, nudgeTools.getNudgeHistory),
  );
}
