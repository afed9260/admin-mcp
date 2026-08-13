import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  SYNTHETIC_JOB_ID,
  SYNTHETIC_LEASE_TOKEN,
} from "../src/synthetic/synthetic-support-autopilot-api.js";
import { createSyntheticSupportAutopilotMcpServer } from "../src/synthetic/synthetic-support-autopilot-mcp.js";
import { supportAutopilotToolNames } from "../src/tools/support-autopilot-tools.js";

const clients: Client[] = [];
const servers: ReturnType<typeof createSyntheticSupportAutopilotMcpServer>[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function connect() {
  const server = createSyntheticSupportAutopilotMcpServer();
  const client = new Client({ name: "synthetic-canary-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  clients.push(client);
  servers.push(server);
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("createSyntheticSupportAutopilotMcpServer", () => {
  it("exposes the exact production seven-tool contract", async () => {
    const client = await connect();
    expect((await client.listTools()).tools.map((tool) => tool.name))
      .toEqual(supportAutopilotToolNames);
  });

  it("runs the fictional lifecycle through normal MCP schemas", async () => {
    const client = await connect();
    const workerId = "support-synthetic.1";

    const claim = await client.callTool({
      arguments: { workerId },
      name: "claim_support_automation_job",
    });
    expect(claim.isError).not.toBe(true);
    const context = await client.callTool({
      arguments: { jobId: SYNTHETIC_JOB_ID, leaseToken: SYNTHETIC_LEASE_TOKEN, workerId },
      name: "get_support_automation_context",
    });
    expect(context.isError).not.toBe(true);
    const decision = await client.callTool({
      arguments: {
        decisionType: "request_information",
        evidenceFactKeys: ["ticket.state", "ticket.latest_message"],
        internalReasoning: "Synthetic evidence is sufficient.",
        jobId: SYNTHETIC_JOB_ID,
        leaseToken: SYNTHETIC_LEASE_TOKEN,
        proposedReply: "Переподключите только вымышленную интеграцию.",
        selectedPolicyId: "avito_reconnect_required.v1",
        workerId,
      },
      name: "submit_support_automation_decision",
    });
    expect(decision.isError).not.toBe(true);
    const decisionText = decision.content.find((item) => item.type === "text");
    expect(decisionText?.type).toBe("text");
    expect(JSON.parse(decisionText?.type === "text" ? decisionText.text : "null"))
      .toMatchObject({ customerAction: "none", ticketMutation: false });
  });

  it("keeps schema failures inside the synthetic MCP boundary", async () => {
    const client = await connect();
    await expect(client.callTool({
      arguments: { workerId: "UPPER CASE" },
      name: "claim_support_automation_job",
    })).resolves.toMatchObject({ isError: true });
  });
});
