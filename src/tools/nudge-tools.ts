import { AdminApiClient } from "../backend/admin-api-client.js";
import { toSearchParams } from "../backend/search-params.js";
import { nudgeCandidatesQuerySchema, nudgeHistoryQuerySchema } from "./schemas.js";

export function createNudgeTools(client: AdminApiClient) {
  return {
    async listNudgeRules() {
      return client.get("/nudge/rules");
    },

    async getNudgeRuleCandidates(input: unknown) {
      const query = nudgeCandidatesQuerySchema.parse(input);
      return client.get(`/nudge/rules/${encodeURIComponent(query.ruleId)}/candidates`);
    },

    async getNudgeHistory(input: unknown) {
      const query = nudgeHistoryQuerySchema.parse(input);
      return client.get(`/nudge/history?${toSearchParams(query)}`);
    },
  };
}
