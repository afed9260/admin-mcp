import { AdminApiClient } from "../backend/admin-api-client.js";
import { toSearchParams } from "../backend/search-params.js";
import {
  reactivationCampaignAudienceQuerySchema,
  reactivationCampaignApplySchema,
  reactivationCampaignDryRunSchema,
  reactivationCampaignNotificationDryRunSchema,
  reactivationCampaignNotificationSendSchema,
  reactivationCampaignRunsQuerySchema,
  reactivationCampaignStateQuerySchema,
  reactivationSendEligibilityQuerySchema,
  reactivationWave2PreviewQuerySchema,
  reactivationWave2ReadinessQuerySchema,
  reactivationWave2SendSchema,
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

    async listReactivationCampaignAudience(input: unknown) {
      const query = reactivationCampaignAudienceQuerySchema.parse(input);
      return client.get(`${reactivationCampaignBasePath}/audience?${toSearchParams(query)}`);
    },

    async getReactivationCampaignState(input: unknown) {
      const query = reactivationCampaignStateQuerySchema.parse(input);
      return client.get(`${reactivationCampaignBasePath}/state?${toSearchParams(query)}`);
    },

    async getReactivationDeliveryEligibility(input: unknown) {
      const query = reactivationSendEligibilityQuerySchema.parse(input);
      return client.get(`${reactivationCampaignBasePath}/send-eligibility?${toSearchParams(query)}`);
    },

    async getReactivationWave2Readiness(input: unknown) {
      const query = reactivationWave2ReadinessQuerySchema.parse(input);
      return client.get(`${reactivationCampaignBasePath}/wave-2-readiness?${toSearchParams(query)}`);
    },

    async getReactivationWave2Preview(input: unknown) {
      const query = reactivationWave2PreviewQuerySchema.parse(input);
      return client.get(`${reactivationCampaignBasePath}/wave-2-preview?${toSearchParams(query)}`);
    },

    async sendReactivationWave2Preview(input: unknown) {
      const body = reactivationWave2SendSchema.parse(input);
      return client.post(`${reactivationCampaignBasePath}/wave-2-send`, body);
    },

    async dryRunReactivationDialogCredits(input: unknown) {
      const body = reactivationCampaignDryRunSchema.parse(input);
      return client.post(`${reactivationCampaignBasePath}/dry-run`, body);
    },

    async applyReactivationDialogCredits(input: unknown) {
      const mutation = reactivationCampaignApplySchema.parse(input);
      return client.post(`${reactivationCampaignBasePath}/apply`, omitConfirmation(mutation));
    },

    async dryRunReactivationNotification(input: unknown) {
      const body = reactivationCampaignNotificationDryRunSchema.parse(input);
      return client.post(`${reactivationCampaignBasePath}/notification-dry-run`, body);
    },

    async sendReactivationNotification(input: unknown) {
      const mutation = reactivationCampaignNotificationSendSchema.parse(input);
      return client.post(`${reactivationCampaignBasePath}/notification-send`, omitConfirmation(mutation));
    },
  };
}
