import { describe, expect, it } from "vitest";
import { toSearchParams } from "../src/backend/search-params.js";

describe("toSearchParams", () => {
  it("omits undefined and empty strings", () => {
    expect(toSearchParams({ groupBy: "chain", chainId: "", page: 1, missing: undefined })).toBe("groupBy=chain&page=1");
  });
});
