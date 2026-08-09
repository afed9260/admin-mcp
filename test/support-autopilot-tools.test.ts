import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportAutopilotApiClient } from "../src/backend/support-autopilot-api-client.js";
import {
  registerSupportAutopilotTools,
  supportAutopilotToolNames,
} from "../src/tools/support-autopilot-tools.js";

const servers: McpServer[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.restoreAllMocks();
});

async function connect(client: Partial<SupportAutopilotApiClient>) {
  const server = new McpServer({ name: "support-autopilot-test", version: "0.0.0" });
  registerSupportAutopilotTools(server, client as SupportAutopilotApiClient);

  const mcpClient = new Client({ name: "support-autopilot-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  servers.push(server);
  clients.push(mcpClient);
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return mcpClient;
}

describe("registerSupportAutopilotTools", () => {
  it("registers exactly the restricted queue tools with correct annotations", async () => {
    const client = await connect({ get: vi.fn(), post: vi.fn() });
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(supportAutopilotToolNames);
    expect(tools.find((tool) => tool.name === "get_support_automation_work_availability")?.annotations)
      .toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    expect(tools.find((tool) => tool.name === "get_support_automation_health")?.annotations)
      .toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    expect(tools.find((tool) => tool.name === "claim_support_automation_job")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(tools.find((tool) => tool.name === "renew_support_automation_lease")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(tools.find((tool) => tool.name === "get_support_automation_context")?.annotations)
      .toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    expect(tools.find((tool) => tool.name === "get_support_automation_attachment")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(tools.find((tool) => tool.name === "submit_support_automation_decision")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(tools.find((tool) => tool.name === "claim_support_automation_revision")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(tools.find((tool) => tool.name === "renew_support_automation_revision_lease")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(tools.find((tool) => tool.name === "get_support_automation_revision_context")?.annotations)
      .toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    expect(tools.find((tool) => tool.name === "submit_support_automation_revision")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(tools.map((tool) => tool.name)).not.toContain("fail_support_automation_revision");
    const decisionDescription = tools.find(
      (tool) => tool.name === "submit_support_automation_decision",
    )?.description;
    expect(decisionDescription).toContain("exactly these top-level fields");
    expect(decisionDescription).toContain("evidenceFactKeys");
    expect(decisionDescription).toContain("Do not add a decision object or aliases");
  });

  it("posts availability heartbeat and reads health from fixed endpoints", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ pendingJobs: 0, activeLeases: 0 });
    const post = vi.fn().mockResolvedValueOnce({ workAvailable: false, retryAfterMs: 5_000 });
    const client = await connect({ get, post });

    await client.callTool({
      name: "get_support_automation_work_availability",
      arguments: { workerId: "support-worker.1" },
    });
    await client.callTool({ name: "get_support_automation_health", arguments: {} });

    expect(post).toHaveBeenCalledWith("/support-automation/work-availability", {
      workerId: "support-worker.1",
    });
    expect(get).toHaveBeenCalledWith("/support-automation/health");
  });

  it("claims a job using only the validated worker id", async () => {
    const post = vi.fn().mockResolvedValue({ jobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7" });
    const client = await connect({ get: vi.fn(), post });

    await client.callTool({
      name: "claim_support_automation_job",
      arguments: { workerId: "support-worker.1" },
    });

    expect(post).toHaveBeenCalledWith("/support-automation/jobs/claim", {
      workerId: "support-worker.1",
    });
  });

  it("renews a lease through the fixed job endpoint without logging its token", async () => {
    const leaseToken = "A".repeat(43);
    const post = vi.fn().mockResolvedValue({
      jobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      leaseExpiresAt: "2026-08-04T12:10:00.000Z",
      leaseToken: "B".repeat(43),
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = await connect({ get: vi.fn(), post });

    await client.callTool({
      name: "renew_support_automation_lease",
      arguments: {
        jobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
        leaseToken,
        workerId: "support-worker.1",
      },
    });

    expect(post).toHaveBeenCalledWith(
      "/support-automation/jobs/5cc98548-b99e-4e93-93ed-7281499fc4c7/lease/renew",
      { leaseToken, workerId: "support-worker.1" },
    );
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reads lease-scoped context through one fixed endpoint", async () => {
    const post = vi.fn().mockResolvedValue({ mode: "shadow", messages: [] });
    const client = await connect({ get: vi.fn(), post });
    const jobId = "5cc98548-b99e-4e93-93ed-7281499fc4c7";
    const leaseToken = "A".repeat(43);

    await client.callTool({
      name: "get_support_automation_context",
      arguments: { jobId, leaseToken, workerId: "support-worker.1" },
    });

    expect(post).toHaveBeenCalledWith(`/support-automation/jobs/${jobId}/context`, {
      leaseToken,
      workerId: "support-worker.1",
    });
  });

  it("returns an attachment as one image block plus safe metadata", async () => {
    const dataBase64 = Buffer.from("image").toString("base64");
    const attachmentRef = `att_${"a".repeat(64)}`;
    const post = vi.fn().mockResolvedValue({
      dataBase64,
      metadata: {
        attachmentRef,
        byteSize: 5,
        contentHash: `sha256:${createHash("sha256")
          .update(Buffer.from(dataBase64, "base64"))
          .digest("hex")}`,
        contentType: "image/png",
        height: 1,
        sourceMessageId: "6cc98548-b99e-4e93-93ed-7281499fc4c7",
        width: 1,
      },
    });
    const client = await connect({ get: vi.fn(), post });

    const result = await client.callTool({
      name: "get_support_automation_attachment",
      arguments: {
        attachmentRef,
        jobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
        leaseToken: "A".repeat(43),
        workerId: "support-worker.1",
      },
    });

    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toMatchObject({
      type: "image",
      data: dataBase64,
      mimeType: "image/png",
    });
    expect(JSON.stringify(result.content[1])).not.toContain(dataBase64);
  });

  it("submits one exact bounded shadow decision without a job id in the body", async () => {
    const post = vi.fn().mockResolvedValue({
      customerAction: "none",
      jobStatus: "completed",
      outcome: "shadow_recorded",
      ticketMutation: false,
    });
    const client = await connect({ get: vi.fn(), post });
    const jobId = "5cc98548-b99e-4e93-93ed-7281499fc4c7";
    const body = {
      decisionType: "escalate",
      evidenceFactKeys: ["ticket.state"],
      expectedLatestMessageId: "6cc98548-b99e-4e93-93ed-7281499fc4c7",
      expectedTicketVersion: 7,
      internalReasoning: "Insufficient evidence.",
      leaseToken: "A".repeat(43),
      proposedReply: null,
      selectedPolicyId: "unclassified.v1",
      workerId: "support-worker.1",
    };

    await client.callTool({
      name: "submit_support_automation_decision",
      arguments: { jobId, ...body },
    });

    expect(post).toHaveBeenCalledWith(`/support-automation/jobs/${jobId}/decision`, body);
  });

  it("exposes four strict revision tools while failure remains host-only", async () => {
    const claimSupportAutomationRevision = vi.fn().mockResolvedValue({ revisionJobId: "id" });
    const renewSupportAutomationRevisionLease = vi.fn().mockResolvedValue({ leaseToken: "B".repeat(43) });
    const getSupportAutomationRevisionContext = vi.fn().mockResolvedValue({ mode: "revision" });
    const submitSupportAutomationRevision = vi.fn().mockResolvedValue({ outcome: "revision_recorded" });
    const client = await connect({
      get: vi.fn(),
      post: vi.fn(),
      claimSupportAutomationRevision,
      renewSupportAutomationRevisionLease,
      getSupportAutomationRevisionContext,
      submitSupportAutomationRevision,
    });
    const lease = {
      revisionJobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      leaseToken: "A".repeat(43),
      workerId: "support-worker.1",
    };

    await client.callTool({
      name: "claim_support_automation_revision",
      arguments: { workerId: lease.workerId },
    });
    await client.callTool({
      name: "renew_support_automation_revision_lease",
      arguments: lease,
    });
    await client.callTool({
      name: "get_support_automation_revision_context",
      arguments: lease,
    });
    await client.callTool({
      name: "submit_support_automation_revision",
      arguments: {
        ...lease,
        decisionType: "request_information",
        evidenceFactKeys: ["ticket.state", "ticket.latest_message"],
        expectedLatestMessageId: "6cc98548-b99e-4e93-93ed-7281499fc4c7",
        expectedTicketVersion: 7,
        internalReasoning: "The prior draft needs one clarification.",
        proposedReply: "Уточните, пожалуйста, номер объявления.",
        selectedPolicyId: "request_missing_reference.v1",
      },
    });

    expect(claimSupportAutomationRevision).toHaveBeenCalledWith({
      workerId: lease.workerId,
    });
    expect(renewSupportAutomationRevisionLease).toHaveBeenCalledWith(lease);
    expect(getSupportAutomationRevisionContext).toHaveBeenCalledWith(lease);
    expect(submitSupportAutomationRevision).toHaveBeenCalledWith(expect.objectContaining({
      ...lease,
      proposedReply: "Уточните, пожалуйста, номер объявления.",
    }));
  });

  it.each([
    ["get_support_automation_work_availability", {}],
    ["get_support_automation_work_availability", { workerId: "support-worker.1", unexpected: true }],
    ["get_support_automation_health", { unexpected: true }],
    ["claim_support_automation_job", { workerId: "UPPERCASE" }],
    ["claim_support_automation_job", { workerId: "support-worker.1", unexpected: true }],
    ["renew_support_automation_lease", {
      jobId: "not-a-uuid",
      leaseToken: "A".repeat(43),
      workerId: "support-worker.1",
    }],
    ["get_support_automation_attachment", {
      attachmentRef: "att_invalid",
      jobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      leaseToken: "A".repeat(43),
      workerId: "support-worker.1",
    }],
    ["submit_support_automation_decision", {
      decisionType: "escalate",
      evidenceFactKeys: [],
      expectedLatestMessageId: "6cc98548-b99e-4e93-93ed-7281499fc4c7",
      expectedTicketVersion: 7,
      internalReasoning: "Insufficient evidence.",
      jobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      leaseToken: "A".repeat(43),
      proposedReply: null,
      selectedPolicyId: "unclassified.v1",
      workerId: "support-worker.1",
    }],
    ["submit_support_automation_decision", {
      decisionType: "auto_reply",
      evidenceFactKeys: ["ticket.state"],
      expectedLatestMessageId: "6cc98548-b99e-4e93-93ed-7281499fc4c7",
      expectedTicketVersion: 7,
      internalReasoning: "Known policy.",
      jobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      leaseToken: "A".repeat(43),
      proposedReply: null,
      selectedPolicyId: "avito_reconnect_required.v1",
      workerId: "support-worker.1",
    }],
    ["renew_support_automation_lease", {
      jobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      leaseToken: "short",
      workerId: "support-worker.1",
    }],
    ["claim_support_automation_revision", {
      workerId: "support-worker.1",
      ticketMutation: false,
    }],
    ["renew_support_automation_revision_lease", {
      revisionJobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      leaseToken: "A".repeat(43),
      workerId: "support-worker.1",
      customerAction: "none",
    }],
    ["submit_support_automation_revision", {
      revisionJobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      leaseToken: "A".repeat(43),
      workerId: "support-worker.1",
      decisionType: "escalate",
      evidenceFactKeys: ["ticket.state"],
      expectedLatestMessageId: "6cc98548-b99e-4e93-93ed-7281499fc4c7",
      expectedTicketVersion: 7,
      internalReasoning: "No reply.",
      proposedReply: "A reply",
      selectedPolicyId: "unclassified.v1",
    }],
    ["submit_support_automation_revision", {
      revisionJobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      leaseToken: "A".repeat(43),
      workerId: "support-worker.1",
      decisionType: "auto_reply",
      evidenceFactKeys: ["ticket.state"],
      expectedLatestMessageId: "6cc98548-b99e-4e93-93ed-7281499fc4c7",
      expectedTicketVersion: 7,
      internalReasoning: "Known policy.",
      proposedReply: "A reply",
      selectedPolicyId: "kb_instruction.v1",
      executionAuthorized: false,
    }],
  ])("rejects invalid input for %s before backend IO", async (name, args) => {
    const get = vi.fn();
    const post = vi.fn();
    const client = await connect({ get, post });

    const result = await client.callTool({ name, arguments: args });

    expect(result.isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
