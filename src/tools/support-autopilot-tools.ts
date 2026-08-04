import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "node:crypto";
import { z } from "zod";

export interface SupportAutopilotClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export const supportAutopilotToolNames = [
  "get_support_automation_work_availability",
  "claim_support_automation_job",
  "renew_support_automation_lease",
  "get_support_automation_context",
  "get_support_automation_attachment",
  "submit_support_automation_decision",
  "get_support_automation_health",
] as const;

const workerIdSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9._:-]{1,62}[a-z0-9])$/);
const jobIdSchema = z.string().uuid();
const leaseTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const attachmentRefSchema = z.string().regex(/^att_[a-f0-9]{64}$/);
const latestMessageIdSchema = z.string().uuid();
const policyIdSchema = z.enum([
  "request_missing_reference.v1",
  "kb_instruction.v1",
  "avito_reconnect_required.v1",
  "dialog_launches_exhausted.v1",
  "scenario_trigger_guidance.v1",
  "service_restored_retry.v1",
  "unclassified.v1",
]);
const decisionTypeSchema = z.enum([
  "auto_reply",
  "request_information",
  "auto_reply_and_escalate",
  "escalate",
]);
const boundedUtf8 = (maximumBytes: number) => z.string().trim().min(1).refine(
  (value) => Buffer.byteLength(value, "utf8") <= maximumBytes,
  `Must not exceed ${maximumBytes} UTF-8 bytes`,
);

const noInputSchema = z.object({}).strict();
const claimInputSchema = z.object({ workerId: workerIdSchema }).strict();
const leaseIdentitySchema = z.object({
  jobId: jobIdSchema,
  leaseToken: leaseTokenSchema,
  workerId: workerIdSchema,
}).strict();
const attachmentInputSchema = leaseIdentitySchema.extend({
  attachmentRef: attachmentRefSchema,
}).strict();
const decisionInputSchema = leaseIdentitySchema.extend({
  decisionType: decisionTypeSchema,
  evidenceFactKeys: z.array(z.enum(["ticket.state", "ticket.latest_message"]))
    .min(1)
    .max(2)
    .refine((keys) => new Set(keys).size === keys.length, "Evidence keys must be unique"),
  expectedLatestMessageId: latestMessageIdSchema,
  expectedTicketVersion: z.number().int().nonnegative().safe(),
  internalReasoning: boundedUtf8(2_000),
  proposedReply: boundedUtf8(4_000).nullable(),
  selectedPolicyId: policyIdSchema,
}).strict().superRefine((value, context) => {
  if (value.decisionType !== "escalate" && value.proposedReply === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A proposed reply is required for this decision",
      path: ["proposedReply"],
    });
  }
});
const attachmentResponseSchema = z.object({
  dataBase64: z.string().min(1).max(Math.ceil((8 * 1024 * 1024) / 3) * 4),
  metadata: z.object({
    attachmentRef: attachmentRefSchema,
    byteSize: z.number().int().positive().max(8 * 1024 * 1024),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    height: z.number().int().positive().max(20 * 1024),
    sourceMessageId: z.string().uuid(),
    width: z.number().int().positive().max(20 * 1024),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.dataBase64)
    || Buffer.from(value.dataBase64, "base64").toString("base64") !== value.dataBase64
    || Buffer.byteLength(value.dataBase64, "base64") !== value.metadata.byteSize
    || value.metadata.contentHash !== `sha256:${createHash("sha256")
      .update(Buffer.from(value.dataBase64, "base64"))
      .digest("hex")}`
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Attachment bytes do not match metadata",
      path: ["dataBase64"],
    });
  }
});

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
  client: SupportAutopilotClient,
): void {
  server.registerTool(
    "get_support_automation_work_availability",
    {
      description: "Check whether the restricted support automation queue has claimable work.",
      inputSchema: claimInputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ workerId }) => toolResponse(await client.post(
      "/support-automation/work-availability",
      { workerId },
    )),
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
      inputSchema: leaseIdentitySchema,
      annotations: queueMutationAnnotations,
    },
    async ({ jobId, leaseToken, workerId }) => toolResponse(await client.post(
      `/support-automation/jobs/${jobId}/lease/renew`,
      { leaseToken, workerId },
    )),
  );

  server.registerTool(
    "get_support_automation_context",
    {
      description: "Read minimized context for the current leased support automation job.",
      inputSchema: leaseIdentitySchema,
      annotations: readOnlyAnnotations,
    },
    async ({ jobId, leaseToken, workerId }) => toolResponse(await client.post(
      `/support-automation/jobs/${jobId}/context`,
      { leaseToken, workerId },
    )),
  );

  server.registerTool(
    "get_support_automation_attachment",
    {
      description: "Read one bounded image attached to the current leased support job.",
      inputSchema: attachmentInputSchema,
      annotations: queueMutationAnnotations,
    },
    async ({ attachmentRef, jobId, leaseToken, workerId }) => {
      const raw = await client.post(
        `/support-automation/jobs/${jobId}/attachments/${attachmentRef}`,
        { leaseToken, workerId },
      );
      const attachment = attachmentResponseSchema.parse(raw);
      if (attachment.metadata.attachmentRef !== attachmentRef) {
        throw new Error("Attachment response does not match request");
      }
      return {
        content: [
          {
            type: "image" as const,
            data: attachment.dataBase64,
            mimeType: attachment.metadata.contentType,
          },
          {
            type: "text" as const,
            text: JSON.stringify({ metadata: attachment.metadata }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "submit_support_automation_decision",
    {
      description: [
        "Record one structured shadow decision without customer or ticket mutation.",
        "Pass exactly these top-level fields: workerId, jobId, leaseToken, decisionType, evidenceFactKeys, expectedLatestMessageId, expectedTicketVersion, internalReasoning, proposedReply, selectedPolicyId.",
        "Do not add a decision object or aliases.",
      ].join(" "),
      inputSchema: decisionInputSchema,
      annotations: queueMutationAnnotations,
    },
    async ({ jobId, ...body }) => toolResponse(await client.post(
      `/support-automation/jobs/${jobId}/decision`,
      body,
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
