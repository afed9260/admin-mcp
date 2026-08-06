import { createHash, timingSafeEqual } from "node:crypto";
import { win32 } from "node:path";
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

const pendingRotationIdentityFields = {
  requestId: z.string().regex(UUID_PATTERN),
};
const pendingRotationCandidateFields = {
  ...pendingRotationIdentityFields,
  ...credentialWindowFields,
  tokenSha256: z.string().regex(SHA256_PATTERN),
  candidatePath: z.string()
    .regex(WINDOWS_ABSOLUTE_PATH_PATTERN)
    .refine((value) => !value.includes("\0")),
};
const pendingRotationSchema = z.union([
  z.object({
    ...pendingRotationIdentityFields,
    stage: z.literal("runner_stopped"),
  }).strict(),
  z.object({
    ...pendingRotationCandidateFields,
    stage: z.literal("candidate_ready"),
  }).strict(),
  z.object({
    ...pendingRotationCandidateFields,
    stage: z.literal("dispatch_prepared"),
    expectedHeadSha: z.string().regex(GIT_SHA_PATTERN),
  }).strict(),
  z.object({
    ...pendingRotationCandidateFields,
    stage: z.literal("workflow_dispatched"),
    expectedHeadSha: z.string().regex(GIT_SHA_PATTERN),
    workflowRunId: z.number().int().positive().safe(),
  }).strict(),
  z.object({
    ...pendingRotationCandidateFields,
    stage: z.literal("server_accepted"),
    expectedHeadSha: z.string().regex(GIT_SHA_PATTERN),
    workflowRunId: z.number().int().positive().safe(),
  }).strict(),
  z.object({
    ...pendingRotationCandidateFields,
    stage: z.literal("candidate_promoted"),
    expectedHeadSha: z.string().regex(GIT_SHA_PATTERN),
    workflowRunId: z.number().int().positive().safe(),
  }).strict(),
]).superRefine((value, context) => {
  if ("issuedAt" in value) {
    validateCredentialLifetime(value, context);
  }
});

const credentialRotationStateSchema = z.object({
  schemaVersion: z.literal(1),
  activeCredential: credentialWindowSchema.nullable(),
  pendingRotation: pendingRotationSchema.nullable(),
  updatedAt: canonicalIso,
}).strict();

const credentialRotationRunSchema = z.object({
  conclusion: z.string().nullable(),
  databaseId: z.number().int().positive().safe(),
  displayTitle: z.string(),
  event: z.string(),
  headBranch: z.string(),
  headSha: z.string(),
  status: z.string(),
}).strict();

export type GeneratedCredentialMetadata = z.infer<typeof generatedCredentialMetadataSchema>;
export type CredentialRotationState = z.infer<typeof credentialRotationStateSchema>;
export type PendingCredentialRotation = NonNullable<CredentialRotationState["pendingRotation"]>;
export type CredentialRotationRecoveryAction =
  | "complete_correlated_workflow"
  | "finalize_existing_promotion"
  | "generate_candidate"
  | "inspect_correlated_workflow"
  | "prepare_dispatch"
  | "promote_candidate"
  | "remove_orphan_candidate"
  | "restart_with_fresh_candidate"
  | "rotate_fresh_candidate"
  | "verify_and_start";

export type CredentialRotationRun = z.infer<typeof credentialRotationRunSchema>;

export function parseGeneratedCredentialMetadata(value: unknown): GeneratedCredentialMetadata {
  const parsed = generatedCredentialMetadataSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("invalid generated credential metadata");
  }
  return parsed.data;
}

export function parseCredentialRotationState(
  value: unknown,
  credentialRoot: string,
): CredentialRotationState {
  const parsed = credentialRotationStateSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("invalid credential rotation state");
  }

  const root = normalizeCredentialRoot(credentialRoot);
  const pending = parsed.data.pendingRotation;
  if (pending !== null && "candidatePath" in pending) {
    const expectedPath = win32.join(root, `candidate-${pending.requestId}.dpapi`);
    if (win32.normalize(pending.candidatePath).toLocaleLowerCase("en-US")
      !== expectedPath.toLocaleLowerCase("en-US")) {
      throw new Error("credential candidate path mismatch");
    }
  }
  return parsed.data;
}

export function shouldRotateCredential(
  metadata: Pick<GeneratedCredentialMetadata, "issuedAt" | "expiresAt">,
  now = new Date(),
  leadTimeMs = ROTATION_LEAD_MS,
): boolean {
  const parsed = credentialWindowSchema.parse({
    issuedAt: metadata.issuedAt,
    expiresAt: metadata.expiresAt,
  });
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(leadTimeMs) || leadTimeMs < 0) {
    throw new Error("invalid credential rotation clock");
  }
  return Date.parse(parsed.expiresAt) - now.getTime() < leadTimeMs;
}

export function credentialTokenMatchesDigest(token: string, expectedDigest: string): boolean {
  if (
    typeof token !== "string"
    || token.length === 0
    || token.length > 8192
    || token.trim() !== token
    || token.includes("\r")
    || token.includes("\n")
    || !SHA256_PATTERN.test(expectedDigest)
  ) {
    return false;
  }

  const actual = createHash("sha256").update(token, "utf8").digest();
  const expected = Buffer.from(expectedDigest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function planCredentialRotationRecovery(
  pending: PendingCredentialRotation,
  facts: { candidateExists: boolean; activeMatchesCandidate?: boolean },
): CredentialRotationRecoveryAction {
  if (pending.stage === "runner_stopped") {
    return facts.candidateExists ? "remove_orphan_candidate" : "generate_candidate";
  }
  if (pending.stage === "candidate_ready") {
    return facts.candidateExists ? "prepare_dispatch" : "restart_with_fresh_candidate";
  }
  if (pending.stage === "dispatch_prepared") {
    return facts.candidateExists
      ? "inspect_correlated_workflow"
      : "restart_with_fresh_candidate";
  }
  if (pending.stage === "workflow_dispatched") {
    return "complete_correlated_workflow";
  }
  if (pending.stage === "server_accepted") {
    if (facts.candidateExists) {
      return "promote_candidate";
    }
    if (facts.activeMatchesCandidate === true) {
      return "finalize_existing_promotion";
    }
    if (facts.activeMatchesCandidate === false) {
      return "rotate_fresh_candidate";
    }
    throw new Error("active credential match fact is required");
  }
  return "verify_and_start";
}

export function credentialRotationRunTitle(requestId: string): string {
  if (!UUID_PATTERN.test(requestId)) {
    throw new Error("invalid credential rotation request id");
  }
  return `Support Autopilot Credential Rotation action=enable request_id=${requestId}`;
}

export function selectCredentialRotationRun(
  runs: unknown,
  expected: { requestId: string; expectedHeadSha: string },
): CredentialRotationRun {
  const run = locateCredentialRotationRun(runs, expected);
  if (run.status !== "completed" || run.conclusion !== "success") {
    throw new Error("credential rotation run did not succeed");
  }
  return run;
}

export function locateCredentialRotationRun(
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
  const parsed = credentialRotationRunSchema.safeParse(matches[0]);
  if (!parsed.success) {
    throw new Error("invalid credential rotation run inventory");
  }
  const run = parsed.data;
  if (run.event !== "workflow_dispatch") {
    throw new Error("credential rotation run event mismatch");
  }
  if (run.headBranch !== "main") {
    throw new Error("credential rotation run branch mismatch");
  }
  if (run.headSha !== expected.expectedHeadSha) {
    throw new Error("credential rotation run revision mismatch");
  }
  return run;
}

function normalizeCredentialRoot(value: string): string {
  if (
    typeof value !== "string"
    || !WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
    || value.includes("\0")
  ) {
    throw new Error("invalid credential root");
  }
  return win32.resolve(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
