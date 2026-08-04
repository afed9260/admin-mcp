import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
  });

  it("reads availability and health from fixed endpoints", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ workAvailable: false, retryAfterMs: 5_000 })
      .mockResolvedValueOnce({ pendingJobs: 0, activeLeases: 0 });
    const client = await connect({ get, post: vi.fn() });

    await client.callTool({ name: "get_support_automation_work_availability", arguments: {} });
    await client.callTool({ name: "get_support_automation_health", arguments: {} });

    expect(get).toHaveBeenNthCalledWith(1, "/support-automation/work-availability");
    expect(get).toHaveBeenNthCalledWith(2, "/support-automation/health");
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

  it.each([
    ["get_support_automation_work_availability", { unexpected: true }],
    ["get_support_automation_health", { unexpected: true }],
    ["claim_support_automation_job", { workerId: "UPPERCASE" }],
    ["claim_support_automation_job", { workerId: "support-worker.1", unexpected: true }],
    ["renew_support_automation_lease", {
      jobId: "not-a-uuid",
      leaseToken: "A".repeat(43),
      workerId: "support-worker.1",
    }],
    ["renew_support_automation_lease", {
      jobId: "5cc98548-b99e-4e93-93ed-7281499fc4c7",
      leaseToken: "short",
      workerId: "support-worker.1",
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
