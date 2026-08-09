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

  it("uses fixed revision endpoints and keeps failure reporting host-only", async () => {
    const { client, fetchImpl } = createClient();
    const lease = {
      revisionJobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      leaseToken: "A".repeat(43),
      workerId: "support-worker.1",
    };

    await client.claimSupportAutomationRevision({ workerId: lease.workerId });
    await client.renewSupportAutomationRevisionLease(lease);
    await client.getSupportAutomationRevisionContext(lease);
    await client.submitSupportAutomationRevision({
      ...lease,
      decisionType: "request_information",
      evidenceFactKeys: ["ticket.state", "ticket.latest_message"],
      expectedLatestMessageId: "6cc98548-b99e-4e93-93ed-7281499fc4c7",
      expectedTicketVersion: 7,
      internalReasoning: "The prior draft needs one precise clarification.",
      proposedReply: "Уточните, пожалуйста, идентификатор объявления.",
      selectedPolicyId: "request_missing_reference.v1",
    });
    await client.failSupportAutomationRevision({
      ...lease,
      failureCode: "runner_timeout",
    });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://malikbot.ru/new-admin/support-automation/revisions/claim",
      `https://malikbot.ru/new-admin/support-automation/revisions/${lease.revisionJobId}/lease/renew`,
      `https://malikbot.ru/new-admin/support-automation/revisions/${lease.revisionJobId}/context`,
      `https://malikbot.ru/new-admin/support-automation/revisions/${lease.revisionJobId}/decision`,
      `https://malikbot.ru/new-admin/support-automation/revisions/${lease.revisionJobId}/failure`,
    ]);
    expect(fetchImpl.mock.calls[4]?.[1]).toMatchObject({
      body: JSON.stringify({
        leaseToken: lease.leaseToken,
        workerId: lease.workerId,
        failureCode: "runner_timeout",
      }),
      method: "POST",
    });
  });
});
