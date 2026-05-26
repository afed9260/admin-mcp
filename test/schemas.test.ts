import { describe, expect, it } from "vitest";
import {
  botFunnelCustomersQuerySchema,
  costQuerySchema,
  dialogsQuerySchema,
  funnelQuerySchema,
  nudgeHistoryQuerySchema,
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
    const parsed = botFunnelCustomersQuerySchema.parse({ hasDialogs: true, hasPayments: true });
    expect(parsed.hasDialogs).toBe(true);
    expect(parsed.hasPayments).toBe(true);
  });

  it("rejects invalid bot funnel customer stuck days", () => {
    expect(() => botFunnelCustomersQuerySchema.parse({ minStuckDays: -1 })).toThrow();
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
});
