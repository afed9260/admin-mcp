import { z } from "zod";

const ROTATION_LEAD_MS = 6 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:\\/;

const canonicalIso = z.string().refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
});

const credentialWindowFields = {
  issuedAt: canonicalIso,
  expiresAt: canonicalIso,
};

function validateCredentialLifetime(
  value: { issuedAt: string; expiresAt: string },
  context: z.RefinementCtx,
): void {
  const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
  if (lifetime <= 0 || lifetime > 24 * 60 * 60 * 1000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "invalid credential lifetime",
    });
  }
}

const credentialWindowSchema = z.object(credentialWindowFields)
  .strict()
  .superRefine(validateCredentialLifetime);

const generatedCredentialMetadataSchema = z.object({
  ...credentialWindowFields,
  tokenSha256: z.string().regex(SHA256_PATTERN),
}).strict().superRefine(validateCredentialLifetime);

const pendingRotationSchema = z.object({
  ...credentialWindowFields,
  tokenSha256: z.string().regex(SHA256_PATTERN),
  stage: z.enum([
    "candidate_ready",
    "runner_stopped",
    "workflow_dispatched",
    "server_accepted",
    "candidate_promoted",
  ]),
  requestId: z.string().regex(UUID_PATTERN),
  candidatePath: z.string()
    .regex(WINDOWS_ABSOLUTE_PATH_PATTERN)
    .refine((value) => !value.includes("\0")),
  expectedHeadSha: z.string().regex(GIT_SHA_PATTERN),
  workflowRunId: z.number().int().positive().safe().nullable(),
}).strict().superRefine(validateCredentialLifetime);

const credentialRotationStateSchema = z.object({
  schemaVersion: z.literal(1),
  activeCredential: credentialWindowSchema.nullable(),
  pendingRotation: pendingRotationSchema.nullable(),
  updatedAt: canonicalIso,
}).strict();

export type GeneratedCredentialMetadata = z.infer<typeof generatedCredentialMetadataSchema>;
export type CredentialRotationState = z.infer<typeof credentialRotationStateSchema>;

export interface CredentialRotationRun {
  conclusion: string | null;
  databaseId: number;
  displayTitle: string;
  event: string;
  headSha: string;
  status: string;
}

export function parseGeneratedCredentialMetadata(value: unknown): GeneratedCredentialMetadata {
  const parsed = generatedCredentialMetadataSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("invalid generated credential metadata");
  }
  return parsed.data;
}

export function parseCredentialRotationState(value: unknown): CredentialRotationState {
  const parsed = credentialRotationStateSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("invalid credential rotation state");
  }
  return parsed.data;
}

export function shouldRotateCredential(
  metadata: Pick<GeneratedCredentialMetadata, "issuedAt" | "expiresAt">,
  now = new Date(),
  leadTimeMs = ROTATION_LEAD_MS,
): boolean {
  const parsed = credentialWindowSchema.parse(metadata);
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(leadTimeMs) || leadTimeMs < 0) {
    throw new Error("invalid credential rotation clock");
  }
  return Date.parse(parsed.expiresAt) - now.getTime() <= leadTimeMs;
}

export function credentialRotationRunTitle(requestId: string): string {
  if (!UUID_PATTERN.test(requestId)) {
    throw new Error("invalid credential rotation request id");
  }
  return `Support Autopilot Credential Rotation / enable / ${requestId}`;
}

export function selectCredentialRotationRun(
  runs: unknown,
  expected: { requestId: string; expectedHeadSha: string },
): CredentialRotationRun {
  if (!Array.isArray(runs) || !GIT_SHA_PATTERN.test(expected.expectedHeadSha)) {
    throw new Error("invalid credential rotation run inventory");
  }
  const title = credentialRotationRunTitle(expected.requestId);
  const matches = runs.filter((value) => isRecord(value) && value.displayTitle === title);
  if (matches.length === 0) {
    throw new Error("credential rotation run not found");
  }
  if (matches.length !== 1) {
    throw new Error("credential rotation run is ambiguous");
  }
  const run = matches[0];
  if (!isCredentialRotationRun(run)) {
    throw new Error("invalid credential rotation run inventory");
  }
  if (run.event !== "workflow_dispatch") {
    throw new Error("credential rotation run event mismatch");
  }
  if (run.headSha !== expected.expectedHeadSha) {
    throw new Error("credential rotation run revision mismatch");
  }
  if (run.status !== "completed" || run.conclusion !== "success") {
    throw new Error("credential rotation run did not succeed");
  }
  return run;
}

function isCredentialRotationRun(value: unknown): value is CredentialRotationRun {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Number.isSafeInteger(value.databaseId)
    && Number(value.databaseId) > 0
    && typeof value.displayTitle === "string"
    && typeof value.event === "string"
    && typeof value.headSha === "string"
    && typeof value.status === "string"
    && (typeof value.conclusion === "string" || value.conclusion === null)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
