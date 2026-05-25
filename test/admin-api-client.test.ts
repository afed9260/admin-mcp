import { describe, expect, it, vi } from "vitest";
import { AdminApiClient } from "../src/backend/admin-api-client.js";

describe("AdminApiClient", () => {
  it("sends bearer token and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });

    const client = new AdminApiClient({
      baseUrl: "https://malikbot.ru/new-admin",
      token: "secret",
      fetchImpl: fetchMock,
    });

    await client.get("/statistics/dialogs?page=1");

    expect(fetchMock).toHaveBeenCalledWith("https://malikbot.ru/new-admin/statistics/dialogs?page=1", {
      headers: { Authorization: "Bearer secret" },
      method: "GET",
    });
  });

  it("throws normalized backend errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: "Forbidden" }),
    });

    const client = new AdminApiClient({
      baseUrl: "https://malikbot.ru/new-admin",
      token: "secret",
      fetchImpl: fetchMock,
    });

    await expect(client.get("/nudge/rules")).rejects.toThrow("Forbidden");
  });
});
