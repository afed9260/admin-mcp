import { describe, expect, it } from "vitest";
import {
  botFunnelCustomersQuerySchema,
  costQuerySchema,
  dataTruthAuditDetailsQuerySchema,
  dialogsQuerySchema,
  dateString,
  funnelQuerySchema,
  nudgeHistoryQuerySchema,
  reactivationCampaignAudienceQuerySchema,
  reactivationCampaignDryRunSchema,
  supportActionBatchSchema,
  supportSummaryQuerySchema,
  supportTicketDetailSchema,
  supportTicketsQuerySchema,
} from "../src/tools/schemas.js";

describe("tool schemas", () => {
  it("defaults dialog pagination safely", () => {
    const parsed = dialogsQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(50);
  });

  it("caps dialog limit at 100", () => {
    expect(() => dialogsQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects unknown funnel groupBy", () => {
    expect(() => funnelQuerySchema.parse({ groupBy: "month" })).toThrow();
  });

  it("defaults nudge history limit safely", () => {
    const parsed = nudgeHistoryQuerySchema.parse({ ruleId: "intro" });
    expect(parsed.limit).toBe(50);
  });

  it("defaults bot funnel customer pagination safely", () => {
    const parsed = botFunnelCustomersQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(50);
  });

  it("accepts bot funnel customer business segment flags", () => {
    const parsed = botFunnelCustomersQuerySchema.parse({
      activationSegment: "paid_avito_no_dialogs",
      hasDialogs: true,
      hasPayments: true,
      paidLifecycleStage: "inactive_30d",
    });
    expect(parsed.activationSegment).toBe("paid_avito_no_dialogs");
    expect(parsed.hasDialogs).toBe(true);
    expect(parsed.hasPayments).toBe(true);
    expect(parsed.paidLifecycleStage).toBe("inactive_30d");
  });

  it("rejects unknown bot funnel paid lifecycle filters", () => {
    expect(() => botFunnelCustomersQuerySchema.parse({ activationSegment: "paid_magic" })).toThrow();
    expect(() => botFunnelCustomersQuerySchema.parse({ paidLifecycleStage: "sleepy" })).toThrow();
  });

  it("accepts inactive paid reactivation campaign audience segment", () => {
    const audience = reactivationCampaignAudienceQuerySchema.parse({
      segment: "paid_inactive_with_dialogs",
      limit: 50,
    });
    expect(audience.segment).toBe("paid_inactive_with_dialogs");

    const dryRun = reactivationCampaignDryRunSchema.parse({
      audienceSegment: "paid_inactive_with_dialogs",
    });
    expect(dryRun.audienceSegment).toBe("paid_inactive_with_dialogs");
  });

  it("rejects invalid bot funnel customer stuck days", () => {
    expect(() => botFunnelCustomersQuerySchema.parse({ minStuckDays: -1 })).toThrow();
  });

  it("defaults and validates data truth audit detail bucket filters", () => {
    const parsed = dataTruthAuditDetailsQuerySchema.parse({});
    expect(parsed.bucket).toBe("needs_review");
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(50);

    expect(
      dataTruthAuditDetailsQuerySchema.parse({
        bucket: "free_launch_meetings_charged",
        limit: 10,
      }).bucket,
    ).toBe("free_launch_meetings_charged");
    expect(() => dataTruthAuditDetailsQuerySchema.parse({ bucket: "unknown_bucket" })).toThrow();
  });

  it("rejects invalid calendar dates", () => {
    expect(() => funnelQuerySchema.parse({ dateFrom: "2026-99-99" })).toThrow();
    expect(() => funnelQuerySchema.parse({ dateFrom: "2026-02-31" })).toThrow();
  });

  it("accepts leap dates and rejects non-leap dates", () => {
    expect(funnelQuerySchema.parse({ dateFrom: "2024-02-29" }).dateFrom).toBe("2024-02-29");
    expect(() => funnelQuerySchema.parse({ dateFrom: "2025-02-29" })).toThrow();
  });

  it("omits whitespace-only optional text filters", () => {
    const funnel = funnelQuerySchema.parse({ chainId: "   ", platform: "\t" });
    expect(funnel.chainId).toBeUndefined();
    expect(funnel.platform).toBeUndefined();

    const cost = costQuerySchema.parse({ modelName: "   " });
    expect(cost.modelName).toBeUndefined();

    const dialogs = dialogsQuerySchema.parse({ funnelVersion: "   ", telegramUserId: "   ", search: "   " });
    expect(dialogs.funnelVersion).toBeUndefined();
    expect(dialogs.telegramUserId).toBeUndefined();
    expect(dialogs.search).toBeUndefined();
  });

  it("rejects unknown dialog query keys", () => {
    expect(() => dialogsQuerySchema.parse({ telegramUserID: "123" })).toThrow();
  });

  it("rejects invalid date ranges", () => {
    expect(() => funnelQuerySchema.parse({ dateFrom: "2026-01-02", dateTo: "2026-01-01" })).toThrow();
  });

  it("rejects invalid dialog message ranges", () => {
    expect(() => dialogsQuerySchema.parse({ messagesFrom: 5, messagesTo: 4 })).toThrow();
  });

  it("rejects invalid dialog cost ranges", () => {
    expect(() => dialogsQuerySchema.parse({ costFrom: 20, costTo: 10 })).toThrow();
  });

  it("exports reusable date validation", () => {
    expect(dateString.parse("2026-06-03")).toBe("2026-06-03");
    expect(() => dateString.parse("2026-06-31")).toThrow();
  });

  it("defaults and validates support ticket filters", () => {
    const parsed = supportTicketsQuerySchema.parse({
      category: " billing ",
      priority: "P1",
      search: "max",
      sourceChannel: "telegram_support_bot",
      status: "waiting_internal",
      unresolvedOnly: true,
    });

    expect(parsed).toEqual({
      category: "billing",
      limit: 50,
      page: 1,
      priority: "P1",
      search: "max",
      sourceChannel: "telegram_support_bot",
      status: "waiting_internal",
      unresolvedOnly: true,
    });

    expect(() => supportTicketsQuerySchema.parse({ status: "open" })).toThrow();
    expect(() => supportTicketsQuerySchema.parse({ priority: "P0" })).toThrow();
    expect(() => supportTicketsQuerySchema.parse({ sourceChannel: "email" })).toThrow();
    expect(() => supportTicketsQuerySchema.parse({ category: "x".repeat(101) })).toThrow();
    expect(() => supportTicketsQuerySchema.parse({ limit: 101 })).toThrow();
  });

  it("validates support ticket detail IDs", () => {
    expect(supportTicketDetailSchema.parse({ ticketId: " ticket/1 " }).ticketId).toBe("ticket/1");
    expect(() => supportTicketDetailSchema.parse({ ticketId: "" })).toThrow();
    expect(() => supportTicketDetailSchema.parse({ ticketId: "x".repeat(121) })).toThrow();
  });

  it("validates support summary date range and source channel", () => {
    expect(
      supportSummaryQuerySchema.parse({
        from: "2026-06-01",
        sourceChannel: "max_support",
        to: "2026-06-03",
      }),
    ).toEqual({
      from: "2026-06-01",
      sourceChannel: "max_support",
      to: "2026-06-03",
    });

    expect(() => supportSummaryQuerySchema.parse({ from: "2026-06-04", to: "2026-06-03" })).toThrow();
    expect(() => supportSummaryQuerySchema.parse({ from: "2026-06-01", to: "bad" })).toThrow();
    expect(() => supportSummaryQuerySchema.parse({ from: "2026-06-01", sourceChannel: "email", to: "2026-06-03" }))
      .toThrow();
  });

  it("validates support action batches", () => {
    const parsed = supportActionBatchSchema.parse({
      actionPlanId: "support-plan-1",
      planHash: "sha256:abc",
      expectedTicketUpdatedAt: "2026-06-03T11:09:36.831Z",
      expectedLastMessageId: "message-1",
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
      actions: [
        { type: "start_work" },
        { type: "add_internal_note", note: "Investigated billing mismatch" },
        { type: "update_priority", priority: "P2" },
        { type: "update_category", category: "billing_or_payment_issue" },
        { type: "set_waiting_internal", reason: "billing", message: "Please check invoice 42" },
        { type: "send_reply", text: "Exact reply text" },
        { type: "send_reply", textBase64: Buffer.from("Точный ответ клиенту", "utf8").toString("base64") },
        { type: "set_waiting_customer", message: "Waiting for customer confirmation" },
        { type: "resolve", finalResolutionType: "answered_question", resolutionSummary: "Customer received invoice" },
        { type: "close" },
      ],
    });

    expect(parsed.ticketId).toBe("ticket/1");
    expect(parsed.actions).toHaveLength(10);
  });

  it("rejects unsafe support action batches", () => {
    const base = {
      actionPlanId: "support-plan-1",
      planHash: "sha256:abc",
      expectedTicketUpdatedAt: "2026-06-03T11:09:36.831Z",
      expiresAt: "2099-06-03T11:39:36.831Z",
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
    };

    expect(() => supportActionBatchSchema.parse({ ...base, confirm: false, actions: [{ type: "start_work" }] }))
      .toThrow();
    expect(() => supportActionBatchSchema.parse({ ...base, confirm: true, actions: [] })).toThrow();
    expect(() =>
      supportActionBatchSchema.parse({ ...base, confirm: true, actions: [{ type: "send_reply", text: "   " }] }),
    ).toThrow();
    expect(() =>
      supportActionBatchSchema.parse({ ...base, confirm: true, actions: [{ type: "send_reply", textBase64: "not base64" }] }),
    ).toThrow();
    expect(() =>
      supportActionBatchSchema.parse({
        ...base,
        confirm: true,
        preflight: {
          ...base.preflight,
          unsupportedClaimRisk: true,
          safeToSendCustomerReply: false,
        },
        actions: [{ type: "send_reply", text: "Exact reply text" }],
      }),
    ).toThrow();
    expect(() =>
      supportActionBatchSchema.parse({
        ...base,
        confirm: true,
        actions: [{ type: "send_reply", text: "Exact reply text" }],
        preflight: undefined,
      }),
    ).toThrow();
    expect(() =>
      supportActionBatchSchema.parse({ ...base, confirm: true, actions: [{ type: "refund_customer" }] }),
    ).toThrow();
  });
});
