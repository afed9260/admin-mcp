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

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  });
const optionalDateString = dateString.optional();
const boundedSearch = optionalText(200);

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
    step: optionalText(120),
    channel: optionalText(40),
    dateFrom: optionalDateString,
    dateTo: optionalDateString,
    minStuckDays: z.number().int().min(0).optional(),
    avitoConnected: z.boolean().optional(),
    search: boundedSearch,
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasValidDateRange, { path: ["dateTo"] });

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

export type FunnelQuery = z.infer<typeof funnelQuerySchema>;
export type CostQuery = z.infer<typeof costQuerySchema>;
export type BotFunnelQuery = z.infer<typeof botFunnelQuerySchema>;
export type BotFunnelCustomersQuery = z.infer<typeof botFunnelCustomersQuerySchema>;
export type DialogsQuery = z.infer<typeof dialogsQuerySchema>;
export type DialogDetailQuery = z.infer<typeof dialogDetailQuerySchema>;
export type NudgeCandidatesQuery = z.infer<typeof nudgeCandidatesQuerySchema>;
export type NudgeHistoryQuery = z.infer<typeof nudgeHistoryQuerySchema>;
