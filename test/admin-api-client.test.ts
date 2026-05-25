import { describe, expect, it, vi } from "vitest";
import { AdminApiClient } from "../src/backend/admin-api-client.js";
import { BackendError } from "../src/backend/backend-error.js";

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

  it("accepts paths without a leading slash", async () => {
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

    await client.get("statistics/dialogs?page=1");

    expect(fetchMock).toHaveBeenCalledWith("https://malikbot.ru/new-admin/statistics/dialogs?page=1", {
      headers: { Authorization: "Bearer secret" },
      method: "GET",
    });
  });

  it("normalizes duplicate leading slashes for API paths", async () => {
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

    await client.get("//statistics/dialogs");

    expect(fetchMock).toHaveBeenCalledWith("https://malikbot.ru/new-admin/statistics/dialogs", {
      headers: { Authorization: "Bearer secret" },
      method: "GET",
    });
  });

  it("preserves base path when base URL has a trailing slash", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });

    const client = new AdminApiClient({
      baseUrl: "https://malikbot.ru/new-admin/",
      token: "secret",
      fetchImpl: fetchMock,
    });

    await client.get("/statistics/dialogs");

    expect(fetchMock).toHaveBeenCalledWith("https://malikbot.ru/new-admin/statistics/dialogs", {
      headers: { Authorization: "Bearer secret" },
      method: "GET",
    });
  });

  it("rejects absolute URLs", async () => {
    const fetchMock = vi.fn();
    const client = new AdminApiClient({
      baseUrl: "https://malikbot.ru/new-admin",
      token: "secret",
      fetchImpl: fetchMock,
    });

    await expect(client.get("https://evil.test/x")).rejects.toMatchObject({
      endpoint: "https://evil.test/x",
      status: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects protocol-relative URLs with host-like paths", async () => {
    const fetchMock = vi.fn();
    const client = new AdminApiClient({
      baseUrl: "https://malikbot.ru/new-admin",
      token: "secret",
      fetchImpl: fetchMock,
    });

    await expect(client.get("//evil.test/x")).rejects.toMatchObject({
      endpoint: "//evil.test/x",
      status: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws BackendError when a successful response contains invalid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });

    const client = new AdminApiClient({
      baseUrl: "https://malikbot.ru/new-admin",
      token: "secret",
      fetchImpl: fetchMock,
    });

    await expect(client.get("/statistics/dialogs")).rejects.toMatchObject({
      endpoint: "/statistics/dialogs",
      message: "Backend returned invalid JSON",
      status: 200,
    });
    await expect(client.get("/statistics/dialogs")).rejects.toBeInstanceOf(BackendError);
  });

  it("returns undefined for 204 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error("No body");
      },
    });

    const client = new AdminApiClient({
      baseUrl: "https://malikbot.ru/new-admin",
      token: "secret",
      fetchImpl: fetchMock,
    });

    await expect(client.get("/nudge/rules")).resolves.toBeUndefined();
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

    await expect(client.get("/nudge/rules")).rejects.toMatchObject({
      endpoint: "/nudge/rules",
      message: "Forbidden",
      status: 403,
    });
    await expect(client.get("/nudge/rules")).rejects.toBeInstanceOf(BackendError);
  });

  it("uses fallback messages for non-JSON errors without leaking tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("secret");
      },
    });

    const client = new AdminApiClient({
      baseUrl: "https://malikbot.ru/new-admin",
      token: "secret",
      fetchImpl: fetchMock,
    });

    await expect(client.get("/nudge/rules")).rejects.toMatchObject({
      endpoint: "/nudge/rules",
      message: "Backend request failed: 500",
      status: 500,
    });

    try {
      await client.get("/nudge/rules");
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });
});
