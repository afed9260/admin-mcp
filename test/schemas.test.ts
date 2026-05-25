import { describe, expect, it } from "vitest";
import { dialogsQuerySchema, funnelQuerySchema, nudgeHistoryQuerySchema } from "../src/tools/schemas.js";

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
});
