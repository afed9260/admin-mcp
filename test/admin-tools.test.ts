import { describe, expect, it, vi } from "vitest";
import { AdminApiClient } from "../src/backend/admin-api-client.js";
import { createDialogTools } from "../src/tools/dialog-tools.js";
import { createNudgeTools } from "../src/tools/nudge-tools.js";
import { createStatisticsTools } from "../src/tools/statistics-tools.js";

function createClient() {
  return {
    get: vi.fn(async (path: string) => ({ path })),
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
});
