import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  SupportAutomationRevisionDecisionInput,
  SupportAutomationRevisionLeaseIdentity,
  SupportAutomationWorkerIdentity,
} from "../backend/support-autopilot-api-client.js";

export interface SupportAutopilotClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  claimSupportAutomationRevision(input: SupportAutomationWorkerIdentity): Promise<unknown>;
  renewSupportAutomationRevisionLease(input: SupportAutomationRevisionLeaseIdentity): Promise<unknown>;
  getSupportAutomationRevisionContext(input: SupportAutomationRevisionLeaseIdentity): Promise<unknown>;
  submitSupportAutomationRevision(input: SupportAutomationRevisionDecisionInput): Promise<unknown>;
}

export const initialSupportAutopilotToolNames = [
  "get_support_automation_work_availability",
  "claim_support_automation_job",
  "renew_support_automation_lease",
  "get_support_automation_context",
  "get_support_automation_attachment",
  "submit_support_automation_decision",
  "get_support_automation_health",
] as const;

const revisionLeaseToolNames = [
  "claim_support_automation_revision",
  "renew_support_automation_revision_lease",
] as const;

export const revisionSupportAutopilotToolNames = [
  "get_support_automation_revision_context",
  "submit_support_automation_revision",
] as const;

export const supportAutopilotToolNames = [
  ...initialSupportAutopilotToolNames,
  ...revisionLeaseToolNames,
  ...revisionSupportAutopilotToolNames,
] as const;

export type SupportAutopilotToolScope = "initial" | "revision";

export function parseSupportAutopilotToolScope(
  value: string | undefined,
): SupportAutopilotToolScope {
  if (value === "initial" || value === "revision") {
    return value;
  }
  throw new Error("SUPPORT_AUTOPILOT_WORK_KIND_INVALID");
}

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
const revisionLeaseIdentitySchema = z.object({
  revisionJobId: jobIdSchema,
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
const revisionDecisionInputSchema = revisionLeaseIdentitySchema.extend({
  decisionType: z.enum([
    "auto_reply",
    "request_information",
    "auto_reply_and_escalate",
  ]),
  evidenceFactKeys: z.array(z.enum(["ticket.state", "ticket.latest_message"]))
    .min(1)
    .max(2)
    .refine((keys) => new Set(keys).size === keys.length, "Evidence keys must be unique"),
  expectedLatestMessageId: latestMessageIdSchema,
  expectedTicketVersion: z.number().int().nonnegative().safe(),
  internalReasoning: boundedUtf8(2_000),
  proposedReply: boundedUtf8(4_000),
  selectedPolicyId: policyIdSchema,
}).strict();
const boundedOutputUtf8 = (maximumBytes: number) => z.string().refine(
  (value) => Buffer.byteLength(value, "utf8") <= maximumBytes,
  `Must not exceed ${maximumBytes} UTF-8 bytes`,
);
const isoTimestampSchema = z.string().datetime({ offset: true });
const revisionClaimResponseSchema = z.object({
  attemptCount: z.number().int().positive().safe(),
  leaseExpiresAt: isoTimestampSchema,
  leaseToken: leaseTokenSchema,
  revisionJobId: jobIdSchema,
  sequence: z.number().int().positive().safe(),
}).strict().nullable();
const revisionRenewResponseSchema = z.object({
  leaseExpiresAt: isoTimestampSchema,
  leaseToken: leaseTokenSchema,
  revisionJobId: jobIdSchema,
}).strict();
const evidenceFactBaseSchema = {
  contractVersion: z.literal("v1"),
  expiresAt: isoTimestampSchema,
  observedAt: isoTimestampSchema,
  sensitivityClass: z.literal("support_internal"),
  sourceEndpoint: z.literal("/support-agent/internal/automation/revisions/context"),
  sourceService: z.literal("support_automation"),
  subjectId: jobIdSchema,
  subjectType: z.literal("ticket"),
  valueHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  volatility: z.literal("volatile"),
};
const ticketStateEvidenceSchema = z.object({
  ...evidenceFactBaseSchema,
  factKey: z.literal("ticket.state"),
  normalizedValue: z.object({
    aiState: boundedOutputUtf8(128),
    automationVersion: z.number().int().nonnegative().safe(),
    category: boundedOutputUtf8(128).nullable(),
    priority: boundedOutputUtf8(32),
    status: boundedOutputUtf8(128),
  }).strict(),
}).strict();
const latestMessageEvidenceSchema = z.object({
  ...evidenceFactBaseSchema,
  factKey: z.literal("ticket.latest_message"),
  normalizedValue: z.object({
    authorType: boundedOutputUtf8(64),
    createdAt: isoTimestampSchema,
    direction: boundedOutputUtf8(32),
    latestMessageId: latestMessageIdSchema,
  }).strict(),
}).strict();
const revisionContextResponseSchema = z.object({
  currentContext: z.object({
    attachments: z.array(z.object({
      attachmentRef: attachmentRefSchema,
      byteSize: z.number().int().nonnegative().max(8 * 1024 * 1024).nullable(),
      contentType: z.literal("image"),
      height: z.number().int().positive().max(20 * 1024),
      sourceMessageId: latestMessageIdSchema,
      width: z.number().int().positive().max(20 * 1024),
    }).strict()).max(100),
    contextTruncated: z.boolean(),
    currentTicket: z.object({
      aiState: boundedOutputUtf8(128),
      automationVersion: z.number().int().nonnegative().safe(),
      category: boundedOutputUtf8(128).nullable(),
      latestMessageId: latestMessageIdSchema,
      previousTicketsCount: z.number().int().nonnegative().safe(),
      priority: boundedOutputUtf8(32),
      status: boundedOutputUtf8(128),
      subject: boundedOutputUtf8(512).nullable(),
    }).strict(),
    customerAlias: z.string().regex(/^customer_[a-f0-9]{24}$/),
    customerDeliveryEnabled: z.literal(false),
    diagnosticCapabilities: z.tuple([]),
    evidenceFacts: z.array(z.discriminatedUnion("factKey", [
      ticketStateEvidenceSchema,
      latestMessageEvidenceSchema,
    ])).length(2),
    messages: z.array(z.object({
      authorType: boundedOutputUtf8(64),
      createdAt: isoTimestampSchema,
      direction: boundedOutputUtf8(32),
      messageId: latestMessageIdSchema,
      text: boundedOutputUtf8(8 * 1024),
      textTruncated: z.boolean(),
    }).strict()).max(50).refine(
      (messages) => messages.reduce(
        (total, message) => total + Buffer.byteLength(message.text, "utf8"),
        0,
      ) <= 48 * 1024,
      "Revision context messages exceed the aggregate UTF-8 limit",
    ),
  }).strict(),
  customerAction: z.literal("none"),
  fences: z.object({
    expectedLatestMessageId: latestMessageIdSchema,
    expectedTicketVersion: z.number().int().nonnegative().safe(),
  }).strict(),
  mode: z.literal("revision"),
  priorDraft: z.object({
    decisionType: z.enum(["auto_reply", "request_information", "auto_reply_and_escalate"]),
    proposedReply: boundedUtf8(4_096),
    selectedPolicyId: policyIdSchema,
  }).strict(),
  revisionJobId: jobIdSchema,
  revisionRequest: z.object({
    factKey: z.literal("owner_requested_revision"),
    requestedAt: isoTimestampSchema,
    sequence: z.number().int().positive().safe(),
  }).strict(),
  ticketMutation: z.literal(false),
}).strict().superRefine((value, context) => {
  const evidenceFacts = value.currentContext.evidenceFacts;
  const factKeys = evidenceFacts.map((fact) => fact.factKey);
  if (new Set(factKeys).size !== 2) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Revision evidence facts must be unique",
      path: ["currentContext", "evidenceFacts"],
    });
  }
  if (new Set(evidenceFacts.map((fact) => fact.subjectId)).size !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Revision evidence facts must describe the same ticket",
      path: ["currentContext", "evidenceFacts"],
    });
  }
  const stateFact = evidenceFacts.find((fact) => fact.factKey === "ticket.state");
  const latestMessageFact = evidenceFacts.find(
    (fact) => fact.factKey === "ticket.latest_message",
  );
  if (
    stateFact?.factKey !== "ticket.state"
    || stateFact.normalizedValue.automationVersion
      !== value.currentContext.currentTicket.automationVersion
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Revision state evidence does not match the current ticket",
      path: ["currentContext", "evidenceFacts"],
    });
  }
  if (
    latestMessageFact?.factKey !== "ticket.latest_message"
    || latestMessageFact.normalizedValue.latestMessageId
      !== value.currentContext.currentTicket.latestMessageId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Revision latest-message evidence does not match the current ticket",
      path: ["currentContext", "evidenceFacts"],
    });
  }
  if (
    value.currentContext.currentTicket.latestMessageId
      !== value.fences.expectedLatestMessageId
    || value.currentContext.currentTicket.automationVersion
      !== value.fences.expectedTicketVersion
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Revision context fences do not match the current ticket",
      path: ["fences"],
    });
  }
});
const revisionDecisionResponseSchema = z.object({
  customerAction: z.literal("none"),
  outcome: z.enum(["revision_recorded", "stale_cancelled", "requeued_unavailable"]),
  revisionStatus: z.enum(["cancelled", "completed", "pending"]),
  ticketMutation: z.literal(false),
}).strict();
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

function registerInitialSupportAutopilotTools(
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

function registerRevisionLeaseTools(
  server: McpServer,
  client: SupportAutopilotClient,
): void {
  server.registerTool(
    "claim_support_automation_revision",
    {
      description: "Claim one immutable support reply revision using a bounded lease.",
      inputSchema: claimInputSchema,
      annotations: queueMutationAnnotations,
    },
    async (input) => toolResponse(revisionClaimResponseSchema.parse(
      await client.claimSupportAutomationRevision(input),
    )),
  );

  server.registerTool(
    "renew_support_automation_revision_lease",
    {
      description: "Renew the current support revision lease and rotate its one-time token.",
      inputSchema: revisionLeaseIdentitySchema,
      annotations: queueMutationAnnotations,
    },
    async (input) => {
      const renewed = revisionRenewResponseSchema.parse(
        await client.renewSupportAutomationRevisionLease(input),
      );
      if (renewed.revisionJobId !== input.revisionJobId) {
        throw new Error("Revision renewal response does not match request");
      }
      return toolResponse(renewed);
    },
  );
}

function registerRevisionExecutionTools(
  server: McpServer,
  client: SupportAutopilotClient,
): void {
  server.registerTool(
    "get_support_automation_revision_context",
    {
      description: "Read canonical private context for the current leased support revision.",
      inputSchema: revisionLeaseIdentitySchema,
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      const context = revisionContextResponseSchema.parse(
        await client.getSupportAutomationRevisionContext(input),
      );
      if (context.revisionJobId !== input.revisionJobId) {
        throw new Error("Revision context response does not match request");
      }
      return toolResponse(context);
    },
  );

  server.registerTool(
    "submit_support_automation_revision",
    {
      description: [
        "Record one revised support draft without customer action or ticket mutation.",
        "Pass exactly the revision lease, fences, evidence, reasoning, policy, decision type, and non-empty proposed reply.",
      ].join(" "),
      inputSchema: revisionDecisionInputSchema,
      annotations: queueMutationAnnotations,
    },
    async (input) => toolResponse(revisionDecisionResponseSchema.parse(
      await client.submitSupportAutomationRevision(input),
    )),
  );
}

export function registerSupportAutopilotTools(
  server: McpServer,
  client: SupportAutopilotClient,
  scope?: SupportAutopilotToolScope,
): void {
  if (scope !== "revision") {
    registerInitialSupportAutopilotTools(server, client);
  }
  if (scope === undefined) {
    registerRevisionLeaseTools(server, client);
  }
  if (scope !== "initial") {
    registerRevisionExecutionTools(server, client);
  }
}
