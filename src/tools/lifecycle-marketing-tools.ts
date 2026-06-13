import { AdminApiClient } from "../backend/admin-api-client.js";
import { toSearchParams } from "../backend/search-params.js";
import {
  lifecycleMarketingSegmentsQuerySchema,
  lifecycleMarketingSegmentUsersQuerySchema,
} from "./schemas.js";

export function createLifecycleMarketingTools(client: AdminApiClient) {
  return {
    async getLifecycleMarketingSegments(input: unknown) {
      lifecycleMarketingSegmentsQuerySchema.parse(input);
      return client.get("/lifecycle-marketing/segments");
    },

    async listLifecycleMarketingSegmentUsers(input: unknown) {
      const { segmentId, page, limit } = lifecycleMarketingSegmentUsersQuerySchema.parse(input);
      return client.get(
        `/lifecycle-marketing/segments/${encodeURIComponent(segmentId)}/users?${toSearchParams({ page, limit })}`,
      );
    },
  };
}
