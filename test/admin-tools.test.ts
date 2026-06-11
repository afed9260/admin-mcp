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
    await expect(tools.getIdentityMappingAudit()).resolves.toEqual({
      path: "/statistics/identity-mapping-audit",
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

    client.get.mockResolvedValueOnce({ enabled: false, id: "rule/1" });
    await expect(
      tools.toggleNudgeRule({
        confirm: true,
        expectedEnabled: false,
        reason: "manual MCP smoke test",
        ruleId: "rule/1",
      }),
    ).resolves.toEqual({
      path: "/nudge/rules/rule%2F1/toggle",
    });

    client.get.mockResolvedValueOnce({ enabled: true, id: "rule/1" });
    await expect(
      tools.processNudgeRule({
        confirm: true,
        expectedEnabled: true,
        reason: "process approved rule",
        ruleId: "rule/1",
      }),
    ).resolves.toEqual({
      path: "/nudge/rules/rule%2F1/process",
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

  it("refuses to toggle a nudge rule when the current enabled state differs from expectation", async () => {
    const client = createClient();
    const tools = createNudgeTools(client);
    client.get.mockResolvedValueOnce({ enabled: true, id: "rule/1" });

    await expect(
      tools.toggleNudgeRule({
        confirm: true,
        expectedEnabled: false,
        reason: "manual MCP smoke test",
        ruleId: "rule/1",
      }),
    ).rejects.toThrow("Nudge rule enabled state mismatch");
  });

  it("refuses to process a nudge rule when the current enabled state differs from expectation", async () => {
    const client = createClient();
    const tools = createNudgeTools(client);
    client.get.mockResolvedValueOnce({ enabled: false, id: "rule/1" });

    await expect(
      tools.processNudgeRule({
        confirm: true,
        expectedEnabled: true,
        reason: "process approved rule",
        ruleId: "rule/1",
      }),
    ).rejects.toThrow("Nudge rule enabled state mismatch");
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
        preflight: {
          factsChecked: ["Customer asked about setup."],
          category: "how_to_question",
          priority: "P3",
          nextStatus: "waiting_customer",
          investigationNeeded: false,
          taskNeeded: false,
          unsupportedClaimRisk: false,
          safeToSendCustomerReply: true,
          summary: "Safe to send a grounded customer reply.",
        },
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
        preflight: {
          factsChecked: ["Customer asked about setup."],
          category: "how_to_question",
          priority: "P3",
          nextStatus: "waiting_customer",
          investigationNeeded: false,
          taskNeeded: false,
          unsupportedClaimRisk: false,
          safeToSendCustomerReply: true,
          summary: "Safe to send a grounded customer reply.",
        },
        actions: [{ type: "send_reply", text: "Exact reply text" }],
      },
      path: "/support-inbox/tickets/ticket%2F1/action-batches",
    });
  });

  it("requests reactivation campaign history, credit, and notification endpoints", async () => {
    const client = createClient();
    const tools = createGrowthCampaignTools(client);

    await expect(tools.listReactivationCampaignRuns({ limit: 5 })).resolves.toEqual({
      path: "/growth-campaigns/reactivation-2026-06-wave-1/runs?limit=5",
    });

    await expect(
      tools.listReactivationCampaignAudience({
        limit: 50,
        segment: "paid_avito_no_dialogs",
      }),
    ).resolves.toEqual({
      path: "/growth-campaigns/reactivation-2026-06-wave-1/audience?segment=paid_avito_no_dialogs&limit=50",
    });
    await expect(
      tools.listReactivationCampaignAudience({
        limit: 50,
        segment: "paid_inactive_with_dialogs",
      }),
    ).resolves.toEqual({
      path: "/growth-campaigns/reactivation-2026-06-wave-1/audience?segment=paid_inactive_with_dialogs&limit=50",
    });

    await expect(
      tools.getReactivationCampaignState({
        limit: 25,
        segment: "paid_avito_no_dialogs",
      }),
    ).resolves.toEqual({
      path: "/growth-campaigns/reactivation-2026-06-wave-1/state?segment=paid_avito_no_dialogs&limit=25",
    });

    await expect(
      tools.getReactivationDeliveryEligibility({
        limit: 50,
        ruleId: "reactivation_paid_avito_no_dialogs",
        segment: "paid_avito_no_dialogs",
        semanticTouchKey: "reactivation_2026_06_start_first_dialog",
      }),
    ).resolves.toEqual({
      path: "/growth-campaigns/reactivation-2026-06-wave-1/send-eligibility?segment=paid_avito_no_dialogs&limit=50&ruleId=reactivation_paid_avito_no_dialogs&semanticTouchKey=reactivation_2026_06_start_first_dialog",
    });

    await expect(
      tools.getReactivationWave2Readiness({
        limit: 50,
        nextAction: "start_first_dialog",
        segment: "paid_avito_no_dialogs",
        semanticTouchKey: "reactivation_2026_06_wave_2_start_first_dialog",
      }),
    ).resolves.toEqual({
      path: "/growth-campaigns/reactivation-2026-06-wave-1/wave-2-readiness?segment=paid_avito_no_dialogs&limit=50&nextAction=start_first_dialog&semanticTouchKey=reactivation_2026_06_wave_2_start_first_dialog",
    });

    await expect(
      tools.getReactivationWave2Preview({
        limit: 50,
        nextAction: "connect_avito",
        segment: "paid_no_avito_no_dialogs",
        semanticTouchKey: "reactivation_2026_06_wave_2_connect_avito",
      }),
    ).resolves.toEqual({
      path: "/growth-campaigns/reactivation-2026-06-wave-1/wave-2-preview?segment=paid_no_avito_no_dialogs&limit=50&nextAction=connect_avito&semanticTouchKey=reactivation_2026_06_wave_2_connect_avito",
    });

    await expect(
      tools.getReactivationWave2SourceReconciliation({
        limit: 50,
        segment: "paid_no_avito_no_dialogs",
      }),
    ).resolves.toEqual({
      path: "/growth-campaigns/reactivation-2026-06-wave-1/wave-2-source-reconciliation?segment=paid_no_avito_no_dialogs&limit=50",
    });

    await expect(
      tools.dryRunReactivationDialogCredits({
        audienceSegment: "paid_inactive_with_dialogs",
      }),
    ).resolves.toEqual({
      body: { audienceSegment: "paid_inactive_with_dialogs" },
      path: "/growth-campaigns/reactivation-2026-06-wave-1/dry-run",
    });

    await expect(
      tools.applyReactivationDialogCredits({
        audienceSegment: "paid_inactive_with_dialogs",
        confirm: true,
        reason: "approved by campaign owner after dry-run",
      }),
    ).resolves.toEqual({
      body: { audienceSegment: "paid_inactive_with_dialogs" },
      path: "/growth-campaigns/reactivation-2026-06-wave-1/apply",
    });

    await expect(
      tools.dryRunReactivationNotification({
        audienceSegment: "paid_inactive_with_dialogs",
      }),
    ).resolves.toEqual({
      body: { audienceSegment: "paid_inactive_with_dialogs" },
      path: "/growth-campaigns/reactivation-2026-06-wave-1/notification-dry-run",
    });

    await expect(
      tools.sendReactivationNotification({
        audienceSegment: "paid_inactive_with_dialogs",
        confirm: true,
        reason: "approved by campaign owner after notification dry-run",
      }),
    ).resolves.toEqual({
      body: { audienceSegment: "paid_inactive_with_dialogs" },
      path: "/growth-campaigns/reactivation-2026-06-wave-1/notification-send",
    });

    await expect(
      tools.sendReactivationWave2Preview({
        confirm: true,
        expectedPayloadHash: "a".repeat(64),
        expectedPreviewEvidenceHash: "b".repeat(64),
        expectedRuleId: "reactivation_paid_no_avito_no_dialogs",
        expectedWouldSend: 1,
        limit: 50,
        nextAction: "connect_avito",
        reason: "approved one-person connect Avito follow-up",
        segment: "paid_no_avito_no_dialogs",
        semanticTouchKey: "reactivation_2026_06_wave_2_connect_avito",
      }),
    ).resolves.toEqual({
      body: {
        confirm: true,
        expectedPayloadHash: "a".repeat(64),
        expectedPreviewEvidenceHash: "b".repeat(64),
        expectedRuleId: "reactivation_paid_no_avito_no_dialogs",
        expectedWouldSend: 1,
        limit: 50,
        nextAction: "connect_avito",
        reason: "approved one-person connect Avito follow-up",
        segment: "paid_no_avito_no_dialogs",
        semanticTouchKey: "reactivation_2026_06_wave_2_connect_avito",
      },
      path: "/growth-campaigns/reactivation-2026-06-wave-1/wave-2-send",
    });

    await expect(
      tools.applyReactivationDialogCredits({
        confirm: false,
        reason: "approved by campaign owner after dry-run",
        telegramUserIds: [42, 43],
      }),
    ).rejects.toThrow();

    await expect(
      tools.sendReactivationNotification({
        confirm: false,
        reason: "approved by campaign owner after notification dry-run",
        telegramUserIds: [42, 43],
      }),
    ).rejects.toThrow();
  });

  it("requests broad relaunch campaign endpoints", async () => {
    const client = createClient();
    const tools = createGrowthCampaignTools(client);

    await expect(tools.listBroadRelaunchAudience({ limit: 75, segment: "high_intent" })).resolves.toEqual({
      path: "/growth-campaigns/reactivation-2026-06-broad-relaunch/audience?limit=75&segment=high_intent",
    });
    await expect(tools.listBroadRelaunchRuns({ limit: 10 })).resolves.toEqual({
      path: "/growth-campaigns/reactivation-2026-06-broad-relaunch/runs?limit=10",
    });
    await expect(tools.getBroadRelaunchReactions({})).resolves.toEqual({
      path: "/growth-campaigns/reactivation-2026-06-broad-relaunch/reactions",
    });
    await expect(tools.dryRunBroadRelaunchNotification({ limit: 75, segment: "high_intent" })).resolves.toEqual({
      body: { limit: 75, segment: "high_intent" },
      path: "/growth-campaigns/reactivation-2026-06-broad-relaunch/notification-dry-run",
    });
    await expect(
      tools.sendBroadRelaunchNotification({
        confirm: true,
        limit: 50,
        segment: "high_intent",
        reason: "approved by campaign owner after broad relaunch dry-run",
      }),
    ).resolves.toEqual({
      body: { limit: 50, segment: "high_intent" },
      path: "/growth-campaigns/reactivation-2026-06-broad-relaunch/notification-send",
    });
    await expect(
      tools.sendBroadRelaunchNotification({
        confirm: false,
        limit: 50,
        reason: "approved by campaign owner after broad relaunch dry-run",
      }),
    ).rejects.toThrow();
  });
});
