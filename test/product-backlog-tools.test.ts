import { describe, expect, it, vi } from "vitest";
import { AdminApiClient } from "../src/backend/admin-api-client.js";
import { createProductBacklogTools } from "../src/tools/product-backlog-tools.js";
import {
  productBacklogByKeySchema,
  productBacklogEvidenceUpsertSchema,
  productBacklogListSchema,
} from "../src/tools/schemas.js";

describe("product backlog tools", () => {
  const body = {
    backlogKey: "branch-triage",
    title: "Разобрать ветки СДЛК",
    itemType: "tech_debt",
    productArea: "cross_product",
    description: "Проверить уникальную работу",
    evidence: ["report.md"],
    confirm: true,
    reason: "Аудит",
  };

  it("uses only fixed read and write endpoints", async () => {
    const client = {
      get: vi.fn(async () => ({ data: { item: null } })),
      post: vi.fn(async () => ({ data: { action: "created" } })),
    } as unknown as AdminApiClient;
    const tools = createProductBacklogTools(client);
    await tools.listItems({ includeArchived: true });
    await tools.getByKey({ backlogKey: "branch-triage" });
    await tools.upsertEvidence(body);
    expect(client.get).toHaveBeenNthCalledWith(1, "/product-backlog/items?includeArchived=true");
    expect(client.get).toHaveBeenNthCalledWith(2, "/product-backlog/items/by-key/branch-triage");
    expect(client.post).toHaveBeenCalledWith("/product-backlog/items/evidence-upsert", body);
  });

  it("rejects unknown fields, unsafe keys, and a write without explicit confirmation", async () => {
    expect(() => productBacklogListSchema.parse({ limit: 1000 })).toThrow();
    expect(() => productBacklogByKeySchema.parse({ backlogKey: "../customers" })).toThrow();
    expect(() => productBacklogEvidenceUpsertSchema.parse({ ...body, confirm: false })).toThrow();
    expect(() => productBacklogEvidenceUpsertSchema.parse({ ...body, priority: "p0" })).toThrow();
    expect(() => productBacklogEvidenceUpsertSchema.parse({ ...body, reason: " " })).toThrow();
    const client = { post: vi.fn() } as unknown as AdminApiClient;
    expect(() => createProductBacklogTools(client).upsertEvidence({ ...body, confirm: false })).toThrow();
    expect(client.post).not.toHaveBeenCalled();
  });
});
