import { AdminApiClient } from "../backend/admin-api-client.js";
import {
  productBacklogByKeySchema,
  productBacklogEvidenceUpsertSchema,
  productBacklogListSchema,
} from "./schemas.js";

export function createProductBacklogTools(client: AdminApiClient) {
  return {
    listItems(input: unknown) {
      const { includeArchived } = productBacklogListSchema.parse(input);
      return client.get(`/product-backlog/items?includeArchived=${includeArchived}`);
    },
    getByKey(input: unknown) {
      const { backlogKey } = productBacklogByKeySchema.parse(input);
      return client.get(`/product-backlog/items/by-key/${encodeURIComponent(backlogKey)}`);
    },
    upsertEvidence(input: unknown) {
      const body = productBacklogEvidenceUpsertSchema.parse(input);
      return client.post("/product-backlog/items/evidence-upsert", body);
    },
  };
}
