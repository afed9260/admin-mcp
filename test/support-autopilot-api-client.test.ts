import { describe, expect, it, vi } from "vitest";
import { SupportAutopilotApiClient } from "../src/backend/support-autopilot-api-client.js";

describe("SupportAutopilotApiClient", () => {
  const createClient = (fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  })) => ({
    client: new SupportAutopilotApiClient({
      baseUrl: "https://malikbot.ru/new-admin",
      token: "support-token",
      fetchImpl,
    }),
    fetchImpl,
  });

  it("allows only the dedicated support automation API namespace", async () => {
    const { client, fetchImpl } = createClient();

    await client.get("/support-automation/health");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://malikbot.ru/new-admin/support-automation/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each([
    "/support-inbox/tickets",
    "/customer-operations/profile",
    "/support-automation/../support-inbox/tickets",
    "/support-automation/%2e%2e/support-inbox/tickets",
    "/support-automation/%252e%252e/support-inbox/tickets",
    "https://evil.test/support-automation/health",
  ])("rejects an out-of-profile path before network IO: %s", async (path) => {
    const { client, fetchImpl } = createClient();

    await expect(client.get(path)).rejects.toThrow("Support autopilot endpoint is outside the allowed namespace");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
