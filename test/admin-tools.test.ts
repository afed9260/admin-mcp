import { describe, expect, it, vi } from "vitest";
import { AdminApiClient } from "../src/backend/admin-api-client.js";
import { createDialogTools } from "../src/tools/dialog-tools.js";
import { createNudgeTools } from "../src/tools/nudge-tools.js";
import { createGrowthCampaignTools } from "../src/tools/growth-campaign-tools.js";
import { createStatisticsTools } from "../src/tools/statistics-tools.js";
import { createSupportTools } from "../src/tools/support-tools.js";

function createClient() {
  return {
    get: vi.fn(async (path: string) => ({ path })),
    post: vi.fn(async (path: string, body: unknown) => ({ body, path })),
    postForm: vi.fn(async (path: string, body: FormData) => ({ body, path })),
    put: vi.fn(async (path: string, body: unknown) => ({ body, path })),
  } as unknown as AdminApiClient & { get: ReturnType<typeof vi.fn> };
}

describe("readonly admin tools", () => {
  it("requests funnel, cost, and bot funnel statistics", async () => {
    const client = createClient();
    const tools = createStatisticsTools(client);

    await expect(tools.getFunnelStats({ dateFrom: "2026-01-01", platform: "telegram" })).resolves.toEqual({
      path: "/statistics/funnel?groupBy=chain&dateFrom=2026-01-01&platform=telegram",
    });
    await expect(
      tools.getCostStats({ groupBy: "model", dateFrom: "2026-01-01", dateTo: "2026-01-02", chainId: "chain-1" }),
    ).resolves.toEqual({
      summary: {
        path: "/statistics/costs?groupBy=model&dateFrom=2026-01-01&dateTo=2026-01-02+23%3A59%3A59&chainId=chain-1",
      },
      detailed: {
        path: "/statistics/costs/detailed?dateFrom=2026-01-01&dateTo=2026-01-02+23%3A59%3A59&chainId=chain-1",
      },
    });
    await expect(tools.getBotFunnelStats({ dateTo: "2026-01-03" })).resolves.toEqual({
      path: "/statistics/bot-funnel?dateTo=2026-01-03",
    });
    await expect(tools.getDataTruthAudit()).resolves.toEqual({
      path: "/statistics/data-truth-audit",
    });
    await expect(
      tools.listDataTruthAuditDetails({
        bucket: "meeting_without_charge",
        page: 2,
        limit: 25,
      }),
    ).resolves.toEqual({
      path: "/statistics/data-truth-audit/details?bucket=meeting_without_charge&page=2&limit=25",
    });
    await expect(
      tools.listBotFunnelCustomers({
        activationSegment: "paid_avito_no_dialogs",
        avitoConnected: false,
        channel: "telegram",
        hasDialogs: true,
        hasPayments: true,
        limit: 10,
        minStuckDays: 3,
        page: 2,
        paidLifecycleStage: "inactive_30d",
        search: "ark",
        step: "intro_shown",
      }),
    ).resolves.toEqual({
      path: "/statistics/bot-funnel-customers?activationSegment=paid_avito_no_dialogs&step=intro_shown&channel=telegram&minStuckDays=3&avitoConnected=false&hasDialogs=true&hasPayments=true&paidLifecycleStage=inactive_30d&search=ark&page=2&limit=10",
    });
  });

  it("requests dialog list and detail endpoints", async () => {
    const client = createClient();
    const tools = createDialogTools(client);

    await expect(
      tools.listDialogs({
        status: "failed",
        funnelVersionMissing: true,
        costFrom: 10,
        costTo: 100,
        page: 2,
        limit: 10,
        buyerReplied: true,
      }),
    ).resolves.toEqual({
      path: "/statistics/dialogs?status=failed&funnelVersionMissing=true&buyerReplied=true&costFrom=10&costTo=100&page=2&limit=10",
    });
    await expect(tools.getDialog({ chatId: "chat/123" })).resolves.toEqual({
      path: "/statistics/dialogs/chat%2F123",
    });
  });

  it("requests nudge rule, candidate, and history endpoints", async () => {
    const client = createClient();
    const tools = createNudgeTools(client);

    await expect(tools.listNudgeRules()).resolves.toEqual({ path: "/nudge/rules" });
    await expect(tools.getNudgeRuleCandidates({ ruleId: "rule/1" })).resolves.toEqual({
      path: "/nudge/rules/rule%2F1/candidates",
    });
    await expect(tools.getNudgeHistory({ ruleId: "intro", limit: 5 })).resolves.toEqual({
      path: "/nudge/history?ruleId=intro&limit=5",
    });
  });

  it("requests nudge write endpoints only with explicit confirmation", async () => {
    const client = createClient();
    const tools = createNudgeTools(client);

    await expect(
      tools.updateNudgeRule({
        confirm: true,
        messageText: "Updated text",
        reason: "manual MCP smoke test",
        ruleId: "rule/1",
      }),
    ).resolves.toEqual({
      body: { messageText: "Updated text" },
      path: "/nudge/rules/rule%2F1",
    });

    await expect(
      tools.sendNudgeTest({
        confirm: true,
        reason: "manual MCP smoke test",
        ruleId: "rule/1",
        telegramUserId: 123,
      }),
    ).resolves.toEqual({
      body: { telegramUserId: 123 },
      path: "/nudge/rules/rule%2F1/test-send",
    });

    await expect(
      tools.uploadNudgePhoto({
        confirm: true,
        fileDataBase64: Buffer.from("photo").toString("base64"),
        fileName: "photo.png",
        mimeType: "image/png",
        reason: "manual MCP smoke test",
      }),
    ).resolves.toMatchObject({
      path: "/nudge/upload-photo",
    });

    await expect(
      tools.updateNudgeRule({
        confirm: false,
        messageText: "Updated text",
        reason: "manual MCP smoke test",
        ruleId: "rule/1",
      }),
    ).rejects.toThrow();
  });

  it("requests support inbox ticket, summary, and investigation endpoints", async () => {
    const client = createClient();
    const tools = createSupportTools(client);

    await expect(
      tools.listSupportTickets({
        category: "billing",
        priority: "P2",
        search: "overdue",
        sourceChannel: "max_support",
        status: "needs_support_reply",
        unresolvedOnly: true,
        page: 2,
        limit: 25,
      }),
    ).resolves.toEqual({
      path: "/support-inbox/tickets?status=needs_support_reply&priority=P2&category=billing&sourceChannel=max_support&unresolvedOnly=true&search=overdue&page=2&limit=25",
    });

    await expect(tools.getSupportTicket({ ticketId: "ticket/1" })).resolves.toEqual({
      path: "/support-inbox/tickets/ticket%2F1",
    });

    await expect(
      tools.getSupportSummary({
        from: "2026-06-01",
        to: "2026-06-03",
        sourceChannel: "telegram_support_bot",
      }),
    ).resolves.toEqual({
      path: "/support-inbox/summary?from=2026-06-01&to=2026-06-03&sourceChannel=telegram_support_bot",
    });

    await expect(tools.getSupportWaitingItems()).resolves.toEqual({
      path: "/support-inbox/tickets?status=waiting_internal&page=1&limit=50",
    });

    await expect(tools.investigateSupportTicket({ ticketId: "ticket/1" })).resolves.toEqual({
      body: {},
      path: "/support-inbox/tickets/ticket%2F1/investigations/run",
    });

    await expect(tools.getSupportInvestigation({ ticketId: "ticket/1" })).resolves.toEqual({
      path: "/support-inbox/tickets/ticket%2F1/investigations/latest",
    });

    await expect(
      tools.executeSupportActionBatch({
        actionPlanId: "support-plan-1",
        planHash: "sha256:abc",
        expectedTicketUpdatedAt: "2026-06-03T11:09:36.831Z",
        expiresAt: "2099-06-03T11:39:36.831Z",
        confirm: true,
        reason: "reply to customer",
        ticketId: "ticket/1",
        actions: [{ type: "send_reply", text: "Exact reply text" }],
      }),
    ).resolves.toEqual({
      body: {
        actionPlanId: "support-plan-1",
        planHash: "sha256:abc",
        expectedTicketUpdatedAt: "2026-06-03T11:09:36.831Z",
        expiresAt: "2099-06-03T11:39:36.831Z",
        confirm: true,
        reason: "reply to customer",
        actions: [{ type: "send_reply", text: "Exact reply text" }],
      },
      path: "/support-inbox/tickets/ticket%2F1/action-batches",
    });
  });

  it("requests reactivation campaign history, dry-run, and guarded apply endpoints", async () => {
    const client = createClient();
    const tools = createGrowthCampaignTools(client);

    await expect(tools.listReactivationCampaignRuns({ limit: 5 })).resolves.toEqual({
      path: "/growth-campaigns/reactivation-2026-06-wave-1/runs?limit=5",
    });

    await expect(
      tools.dryRunReactivationDialogCredits({
        telegramUserIds: [42, 43],
      }),
    ).resolves.toEqual({
      body: { telegramUserIds: [42, 43] },
      path: "/growth-campaigns/reactivation-2026-06-wave-1/dry-run",
    });

    await expect(
      tools.applyReactivationDialogCredits({
        confirm: true,
        reason: "approved by campaign owner after dry-run",
        telegramUserIds: [42, 43],
      }),
    ).resolves.toEqual({
      body: { telegramUserIds: [42, 43] },
      path: "/growth-campaigns/reactivation-2026-06-wave-1/apply",
    });

    await expect(
      tools.applyReactivationDialogCredits({
        confirm: false,
        reason: "approved by campaign owner after dry-run",
        telegramUserIds: [42, 43],
      }),
    ).rejects.toThrow();
  });
});
