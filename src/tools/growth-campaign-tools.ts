import { AdminApiClient } from "../backend/admin-api-client.js";
import { toSearchParams } from "../backend/search-params.js";
import {
  reactivationCampaignApplySchema,
  reactivationCampaignDryRunSchema,
  reactivationCampaignRunsQuerySchema,
} from "./schemas.js";

const reactivationCampaignBasePath = "/growth-campaigns/reactivation-2026-06-wave-1";

function omitConfirmation(input: Record<string, unknown>): Record<string, unknown> {
  const { confirm, reason, ...body } = input;
  return body;
}

export function createGrowthCampaignTools(client: AdminApiClient) {
  return {
    async listReactivationCampaignRuns(input: unknown) {
      const query = reactivationCampaignRunsQuerySchema.parse(input);
      return client.get(`${reactivationCampaignBasePath}/runs?${toSearchParams(query)}`);
    },

    async dryRunReactivationDialogCredits(input: unknown) {
      const body = reactivationCampaignDryRunSchema.parse(input);
      return client.post(`${reactivationCampaignBasePath}/dry-run`, body);
    },

    async applyReactivationDialogCredits(input: unknown) {
      const mutation = reactivationCampaignApplySchema.parse(input);
      return client.post(`${reactivationCampaignBasePath}/apply`, omitConfirmation(mutation));
    },
  };
}
