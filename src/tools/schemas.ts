import { z } from "zod";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDateString = dateString.optional();
const boundedSearch = z.string().trim().max(200).optional();

export const funnelQuerySchema = z.object({
  groupBy: z.enum(["chain", "day", "week", "user"]).default("chain"),
  dateFrom: optionalDateString,
  dateTo: optionalDateString,
  chainId: z.string().trim().max(200).optional(),
  platform: z.string().trim().max(50).optional(),
});

export const costQuerySchema = z.object({
  groupBy: z.enum(["chain", "day", "week", "model"]).default("chain"),
  dateFrom: optionalDateString,
  dateTo: optionalDateString,
  chainId: z.string().trim().max(200).optional(),
  modelName: z.string().trim().max(200).optional(),
});

export const botFunnelQuerySchema = z.object({
  dateFrom: optionalDateString,
  dateTo: optionalDateString,
});

export const dialogsQuerySchema = z.object({
  status: z.enum(["pending", "successful", "failed", "paused"]).optional(),
  funnelVersion: z.string().trim().max(200).optional(),
  dateFrom: optionalDateString,
  dateTo: optionalDateString,
  telegramUserId: z.string().trim().max(40).optional(),
  search: boundedSearch,
  buyerReplied: z.boolean().optional(),
  assistantReplied: z.boolean().optional(),
  messagesFrom: z.number().int().min(0).optional(),
  messagesTo: z.number().int().min(0).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
});

export const dialogDetailQuerySchema = z.object({
  chatId: z.string().trim().min(1).max(300),
});

export const nudgeCandidatesQuerySchema = z.object({
  ruleId: z.string().trim().min(1).max(120),
});

export const nudgeHistoryQuerySchema = z.object({
  ruleId: z.string().trim().min(1).max(120),
  limit: z.number().int().min(1).max(100).default(50),
});

export type FunnelQuery = z.infer<typeof funnelQuerySchema>;
export type CostQuery = z.infer<typeof costQuerySchema>;
export type BotFunnelQuery = z.infer<typeof botFunnelQuerySchema>;
export type DialogsQuery = z.infer<typeof dialogsQuerySchema>;
export type DialogDetailQuery = z.infer<typeof dialogDetailQuerySchema>;
export type NudgeCandidatesQuery = z.infer<typeof nudgeCandidatesQuerySchema>;
export type NudgeHistoryQuery = z.infer<typeof nudgeHistoryQuerySchema>;
