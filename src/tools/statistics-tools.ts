import { AdminApiClient } from "../backend/admin-api-client.js";
import { toSearchParams } from "../backend/search-params.js";
import {
  botFunnelCustomersQuerySchema,
  botFunnelQuerySchema,
  costQuerySchema,
  dataTruthAuditDetailsQuerySchema,
  funnelQuerySchema,
} from "./schemas.js";

export function createStatisticsTools(client: AdminApiClient) {
  function withEndOfDay(dateTo: string | undefined) {
    return dateTo ? `${dateTo} 23:59:59` : undefined;
  }

  return {
    async getFunnelStats(input: unknown) {
      const query = funnelQuerySchema.parse(input);
      return client.get(`/statistics/funnel?${toSearchParams(query)}`);
    },

    async getCostStats(input: unknown) {
      const query = costQuerySchema.parse(input);
      const summaryQuery = { ...query, dateTo: withEndOfDay(query.dateTo) };
      const detailedQuery = {
        dateFrom: query.dateFrom,
        dateTo: withEndOfDay(query.dateTo),
        chainId: query.chainId,
      };
      const [summary, detailed] = await Promise.all([
        client.get(`/statistics/costs?${toSearchParams(summaryQuery)}`),
        client.get(`/statistics/costs/detailed?${toSearchParams(detailedQuery)}`),
      ]);
      return { summary, detailed };
    },

    async getBotFunnelStats(input: unknown) {
      const query = botFunnelQuerySchema.parse(input);
      return client.get(`/statistics/bot-funnel?${toSearchParams(query)}`);
    },

    async getDataTruthAudit() {
      return client.get("/statistics/data-truth-audit");
    },

    async getIdentityMappingAudit() {
      return client.get("/statistics/identity-mapping-audit");
    },

    async listDataTruthAuditDetails(input: unknown) {
      const query = dataTruthAuditDetailsQuerySchema.parse(input);
      return client.get(`/statistics/data-truth-audit/details?${toSearchParams(query)}`);
    },

    async listBotFunnelCustomers(input: unknown) {
      const query = botFunnelCustomersQuerySchema.parse(input);
      return client.get(`/statistics/bot-funnel-customers?${toSearchParams(query)}`);
    },
  };
}
