import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupportAutopilotApiClient } from "../backend/support-autopilot-api-client.js";

export const supportAutopilotToolNames = [
  "get_support_automation_work_availability",
  "claim_support_automation_job",
  "renew_support_automation_lease",
  "get_support_automation_health",
] as const;

const workerIdSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9._:-]{1,62}[a-z0-9])$/);
const jobIdSchema = z.string().uuid();
const leaseTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const noInputSchema = z.object({}).strict();
const claimInputSchema = z.object({ workerId: workerIdSchema }).strict();
const renewInputSchema = z.object({
  jobId: jobIdSchema,
  leaseToken: leaseTokenSchema,
  workerId: workerIdSchema,
}).strict();

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

const queueMutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

function toolResponse(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function registerSupportAutopilotTools(
  server: McpServer,
  client: SupportAutopilotApiClient,
): void {
  server.registerTool(
    "get_support_automation_work_availability",
    {
      description: "Check whether the restricted support automation queue has claimable work.",
      inputSchema: noInputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => toolResponse(await client.get("/support-automation/work-availability")),
  );

  server.registerTool(
    "claim_support_automation_job",
    {
      description: "Claim one support automation job using a bounded server lease.",
      inputSchema: claimInputSchema,
      annotations: queueMutationAnnotations,
    },
    async ({ workerId }) => toolResponse(await client.post("/support-automation/jobs/claim", {
      workerId,
    })),
  );

  server.registerTool(
    "renew_support_automation_lease",
    {
      description: "Renew an active support automation job lease and rotate its one-time token.",
      inputSchema: renewInputSchema,
      annotations: queueMutationAnnotations,
    },
    async ({ jobId, leaseToken, workerId }) => toolResponse(await client.post(
      `/support-automation/jobs/${jobId}/lease/renew`,
      { leaseToken, workerId },
    )),
  );

  server.registerTool(
    "get_support_automation_health",
    {
      description: "Read aggregate health counters for the support automation queue.",
      inputSchema: noInputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => toolResponse(await client.get("/support-automation/health")),
  );
}
