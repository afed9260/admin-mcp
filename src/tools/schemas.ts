import { z } from "zod";

const hasValidDateRange = ({ dateFrom, dateTo }: { dateFrom?: string; dateTo?: string }) =>
  dateFrom === undefined || dateTo === undefined || dateFrom <= dateTo;

const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  });
const optionalDateString = dateString.optional();
const boundedSearch = optionalText(200);
const supportStatus = z.enum([
  "new",
  "needs_support_reply",
  "in_progress",
  "waiting_customer",
  "waiting_internal",
  "resolved",
  "closed",
]);
const supportPriority = z.enum(["P1", "P2", "P3", "P4"]);
const supportCategory = z.enum([
  "avito_connection_issue",
  "scenario_trigger_issue",
  "billing_or_payment_issue",
  "subscription_or_balance_issue",
  "manual_account_transfer",
  "how_to_question",
  "product_bug",
  "technical_bug",
  "lead_or_dialog_quality_issue",
  "meeting_or_success_issue",
  "refund_or_complaint",
  "do_not_contact",
  "other",
]);
const supportWaitingInternalReason = z.enum(["developer", "billing", "product", "owner", "external_service"]);
const supportResolutionType = z.enum([
  "answered_question",
  "fixed_account",
  "billing_resolved",
  "technical_issue_resolved",
  "workaround_provided",
  "not_reproducible",
  "duplicate",
  "customer_stopped_responding",
]);
const supportSourceChannel = z.enum(["telegram_support_bot", "max_support", "manual", "future_usedesk"]);
const isoDateTime = z.string().datetime({ offset: true });
const base64Text = z
  .string()
  .trim()
  .min(1)
  .max(7000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/)
  .refine((value) => {
    try {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      const encoded = Buffer.from(decoded, "utf8").toString("base64");

      return encoded.replace(/=+$/u, "") === value.replace(/=+$/u, "");
    } catch {
      return false;
    }
  }, "Invalid base64 text");
const supportActionSchema = z.union([
  z.object({ type: z.literal("start_work") }).strict(),
  z.object({ type: z.literal("add_internal_note"), note: z.string().trim().min(1).max(5000) }).strict(),
  z.object({ type: z.literal("update_priority"), priority: supportPriority }).strict(),
  z.object({ type: z.literal("update_category"), category: supportCategory }).strict(),
  z
    .object({
      type: z.literal("set_waiting_internal"),
      reason: supportWaitingInternalReason,
      message: optionalText(2000),
    })
    .strict(),
  z.object({ type: z.literal("send_reply"), text: z.string().trim().min(1).max(5000) }).strict(),
  z.object({ type: z.literal("send_reply"), textBase64: base64Text }).strict(),
  z.object({ type: z.literal("set_waiting_customer"), message: optionalText(2000) }).strict(),
  z
    .object({
      type: z.literal("resolve"),
      finalResolutionType: supportResolutionType,
      resolutionSummary: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z.object({ type: z.literal("close") }).strict(),
]);
const supportActionPreflightSchema = z
  .object({
    factsChecked: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    category: supportCategory,
    priority: supportPriority,
    nextStatus: supportStatus,
    investigationNeeded: z.boolean(),
    taskNeeded: z.boolean(),
    unsupportedClaimRisk: z.boolean(),
    safeToSendCustomerReply: z.boolean(),
    summary: z.string().trim().min(1).max(1000),
  })
  .strict();
const paidActivationSegment = z
  .enum(["paid_no_avito_no_dialogs", "paid_avito_no_dialogs", "paid_with_dialogs"])
  .optional();
const paidLifecycleStage = z
  .enum(["paid_no_avito_no_dialogs", "paid_avito_no_dialogs", "paid_with_dialogs", "active_recently", "inactive_30d"])
  .optional();
const dataTruthAuditBucket = z.enum([
  "meeting_without_charge",
  "charge_without_meeting",
  "duplicate_charge_chats",
  "failed_charge_rows",
  "free_launch_meetings_charged",
  "meeting_without_status_success",
  "status_success_without_meeting",
  "needs_review",
]);
const writeConfirmation = {
  confirm: z.literal(true),
  reason: z.string().trim().min(3).max(300),
};

export const funnelQuerySchema = z
  .object({
    groupBy: z.enum(["chain", "day", "week", "user"]).default("chain"),
    dateFrom: optionalDateString,
    dateTo: optionalDateString,
    chainId: optionalText(200),
    platform: optionalText(50),
  })
  .strict()
  .refine(hasValidDateRange, { path: ["dateTo"] });

export const costQuerySchema = z
  .object({
    groupBy: z.enum(["chain", "day", "week", "model"]).default("chain"),
    dateFrom: optionalDateString,
    dateTo: optionalDateString,
    chainId: optionalText(200),
    modelName: optionalText(200),
  })
  .strict()
  .refine(hasValidDateRange, { path: ["dateTo"] });

export const botFunnelQuerySchema = z
  .object({
    dateFrom: optionalDateString,
    dateTo: optionalDateString,
  })
  .strict()
  .refine(hasValidDateRange, { path: ["dateTo"] });

export const botFunnelCustomersQuerySchema = z
  .object({
    activationSegment: paidActivationSegment,
    step: optionalText(120),
    channel: optionalText(40),
    dateFrom: optionalDateString,
    dateTo: optionalDateString,
    minStuckDays: z.number().int().min(0).optional(),
    avitoConnected: z.boolean().optional(),
    hasAvito: z.boolean().optional(),
    hasDialogs: z.boolean().optional(),
    hasPayments: z.boolean().optional(),
    paidLifecycleStage,
    search: boundedSearch,
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasValidDateRange, { path: ["dateTo"] });

export const dataTruthAuditDetailsQuerySchema = z
  .object({
    bucket: dataTruthAuditBucket.default("needs_review"),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export const dialogsQuerySchema = z
  .object({
    status: z.enum(["pending", "successful", "failed", "paused"]).optional(),
    funnelVersion: optionalText(200),
    funnelVersionMissing: z.boolean().optional(),
    dateFrom: optionalDateString,
    dateTo: optionalDateString,
    telegramUserId: optionalText(40),
    search: boundedSearch,
    buyerReplied: z.boolean().optional(),
    assistantReplied: z.boolean().optional(),
    messagesFrom: z.number().int().min(0).optional(),
    messagesTo: z.number().int().min(0).optional(),
    costFrom: z.number().min(0).optional(),
    costTo: z.number().min(0).optional(),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasValidDateRange, { path: ["dateTo"] })
  .refine(
    ({ messagesFrom, messagesTo }) =>
      messagesFrom === undefined || messagesTo === undefined || messagesFrom <= messagesTo,
    { path: ["messagesTo"] },
  )
  .refine(
    ({ costFrom, costTo }) => costFrom === undefined || costTo === undefined || costFrom <= costTo,
    { path: ["costTo"] },
  );

export const dialogDetailQuerySchema = z
  .object({
    chatId: z.string().trim().min(1).max(300),
  })
  .strict();

export const supportTicketsQuerySchema = z
  .object({
    status: supportStatus.optional(),
    priority: supportPriority.optional(),
    category: optionalText(100),
    sourceChannel: supportSourceChannel.optional(),
    unresolvedOnly: z.boolean().optional(),
    search: boundedSearch,
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export const supportTicketDetailSchema = z
  .object({
    ticketId: z.string().trim().min(1).max(120),
  })
  .strict();

export const supportSummaryQuerySchema = z
  .object({
    from: dateString,
    to: dateString,
    sourceChannel: supportSourceChannel.optional(),
  })
  .strict()
  .refine(({ from, to }) => from <= to, { path: ["to"] });

export const supportActionBatchSchema = z
  .object({
    ticketId: z.string().trim().min(1).max(120),
    actionPlanId: z.string().trim().min(1).max(160),
    planHash: z.string().trim().min(8).max(160),
    expectedTicketUpdatedAt: isoDateTime,
    expectedLastMessageId: z.string().trim().min(1).max(160).optional(),
    expiresAt: isoDateTime,
    ...writeConfirmation,
    preflight: supportActionPreflightSchema,
    actions: z.array(supportActionSchema).min(1).max(20),
  })
  .strict()
  .refine(
    ({ actions, preflight }) =>
      preflight.safeToSendCustomerReply ||
      !actions.some((action) => action.type === "send_reply" || action.type === "resolve" || action.type === "close"),
    {
      message: "Customer-facing support actions require safe preflight",
      path: ["preflight", "safeToSendCustomerReply"],
    },
  );

export const nudgeCandidatesQuerySchema = z
  .object({
    ruleId: z.string().trim().min(1).max(120),
  })
  .strict();

export const nudgeHistoryQuerySchema = z
  .object({
    ruleId: z.string().trim().min(1).max(120),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export const nudgeRuleUpdateSchema = z
  .object({
    ...writeConfirmation,
    ruleId: z.string().trim().min(1).max(120),
    name: optionalText(255),
    description: z.string().trim().max(1000).nullable().optional(),
    targetSteps: z.array(z.string().trim().min(1).max(120)).min(1).max(20).optional(),
    minHoursStuck: z.number().min(0).max(24 * 365).optional(),
    messageText: optionalText(5000),
    messageParseMode: z.enum(["HTML", "Markdown"]).optional(),
    buttonText: z.string().trim().max(255).nullable().optional(),
    buttonCallbackData: z.string().trim().max(100).nullable().optional(),
    photos: z.array(z.string().trim().min(1).max(1000)).max(10).nullable().optional(),
  })
  .strict()
  .refine(
    ({ buttonCallbackData, buttonText, confirm, photos, reason, ruleId, ...update }) =>
      Object.values({ ...update, buttonCallbackData, buttonText, photos }).some((value) => value !== undefined),
    { message: "At least one rule field must be provided" },
  );

export const nudgePhotoUploadSchema = z
  .object({
    ...writeConfirmation,
    fileDataBase64: z.string().trim().min(1).max(14_000_000),
    fileName: z.string().trim().min(1).max(160),
    mimeType: z.enum(["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]),
  })
  .strict();

export const nudgeTestSendSchema = z
  .object({
    ...writeConfirmation,
    ruleId: z.string().trim().min(1).max(120),
    telegramUserId: z.number().int().positive(),
  })
  .strict();

export const reactivationCampaignRunsQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();

export const reactivationCampaignAudienceSegmentSchema = z.enum([
  "paid_avito_no_dialogs",
  "paid_no_avito_no_dialogs",
  "paid_no_dialogs_all",
]);

export const reactivationCampaignAudienceQuerySchema = z
  .object({
    segment: reactivationCampaignAudienceSegmentSchema.default("paid_avito_no_dialogs"),
    limit: z.number().int().min(1).max(500).default(500),
  })
  .strict();

const hasExactlyOneReactivationTarget = ({
  audienceSegment,
  telegramUserIds,
}: {
  audienceSegment?: string;
  telegramUserIds?: number[];
}) => Boolean(audienceSegment) !== Boolean(telegramUserIds?.length);

export const reactivationCampaignDryRunSchema = z
  .object({
    audienceSegment: reactivationCampaignAudienceSegmentSchema.optional(),
    telegramUserIds: z.array(z.number().int().positive()).min(1).max(500).optional(),
  })
  .strict()
  .refine(hasExactlyOneReactivationTarget, {
    message: "Provide either audienceSegment or telegramUserIds",
  });

export const reactivationCampaignApplySchema = z
  .object({
    ...writeConfirmation,
    audienceSegment: reactivationCampaignAudienceSegmentSchema.optional(),
    telegramUserIds: z.array(z.number().int().positive()).min(1).max(500).optional(),
  })
  .strict()
  .refine(hasExactlyOneReactivationTarget, {
    message: "Provide either audienceSegment or telegramUserIds",
  });

export const reactivationCampaignNotificationDryRunSchema = reactivationCampaignDryRunSchema;

export const reactivationCampaignNotificationSendSchema = reactivationCampaignApplySchema;

export type FunnelQuery = z.infer<typeof funnelQuerySchema>;
export type CostQuery = z.infer<typeof costQuerySchema>;
export type BotFunnelQuery = z.infer<typeof botFunnelQuerySchema>;
export type BotFunnelCustomersQuery = z.infer<typeof botFunnelCustomersQuerySchema>;
export type DataTruthAuditDetailsQuery = z.infer<typeof dataTruthAuditDetailsQuerySchema>;
export type DialogsQuery = z.infer<typeof dialogsQuerySchema>;
export type DialogDetailQuery = z.infer<typeof dialogDetailQuerySchema>;
export type SupportTicketsQuery = z.infer<typeof supportTicketsQuerySchema>;
export type SupportTicketDetail = z.infer<typeof supportTicketDetailSchema>;
export type SupportSummaryQuery = z.infer<typeof supportSummaryQuerySchema>;
export type SupportActionBatch = z.infer<typeof supportActionBatchSchema>;
export type NudgeCandidatesQuery = z.infer<typeof nudgeCandidatesQuerySchema>;
export type NudgeHistoryQuery = z.infer<typeof nudgeHistoryQuerySchema>;
export type NudgeRuleUpdate = z.infer<typeof nudgeRuleUpdateSchema>;
export type NudgePhotoUpload = z.infer<typeof nudgePhotoUploadSchema>;
export type NudgeTestSend = z.infer<typeof nudgeTestSendSchema>;
export type ReactivationCampaignRunsQuery = z.infer<typeof reactivationCampaignRunsQuerySchema>;
export type ReactivationCampaignAudienceQuery = z.infer<typeof reactivationCampaignAudienceQuerySchema>;
export type ReactivationCampaignDryRun = z.infer<typeof reactivationCampaignDryRunSchema>;
export type ReactivationCampaignApply = z.infer<typeof reactivationCampaignApplySchema>;
export type ReactivationCampaignNotificationDryRun = z.infer<typeof reactivationCampaignNotificationDryRunSchema>;
export type ReactivationCampaignNotificationSend = z.infer<typeof reactivationCampaignNotificationSendSchema>;
