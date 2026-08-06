import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  credentialTokenMatchesDigest,
  locateCredentialRotationRun,
  parseCredentialRotationState,
  parseGeneratedCredentialMetadata,
  planCredentialRotationRecovery,
  selectCredentialRotationRun,
  shouldRotateCredential,
} from "../src/runner/support-autopilot-credential-supervisor.js";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const HEAD_SHA = "a".repeat(40);
const ISSUED_AT = "2026-08-06T09:00:00.000Z";
const EXPIRES_AT = "2026-08-07T08:00:00.000Z";
const CREDENTIAL_ROOT = "C:\\support-autopilot\\credentials";
const CANDIDATE_PATH = `${CREDENTIAL_ROOT}\\candidate-${REQUEST_ID}.dpapi`;

describe("support autopilot credential supervisor policy", () => {
  it("parses strict generated metadata without accepting extra fields", () => {
    expect(parseGeneratedCredentialMetadata({
      tokenSha256: "b".repeat(64),
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
    })).toEqual({
      tokenSha256: "b".repeat(64),
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
    });

    expect(() => parseGeneratedCredentialMetadata({
      tokenSha256: "b".repeat(64),
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
      token: "forbidden",
    })).toThrow("invalid generated credential metadata");
  });

  it("rotates only when fewer than six hours remain", () => {
    const metadata = { issuedAt: ISSUED_AT, expiresAt: EXPIRES_AT };

    expect(shouldRotateCredential(
      { ...metadata, tokenSha256: "b".repeat(64) },
      new Date("2026-08-07T02:00:00.000Z"),
    )).toBe(false);
    expect(shouldRotateCredential(
      metadata,
      new Date("2026-08-07T02:00:00.001Z"),
    )).toBe(true);
  });

  it("enforces stage-specific recovery fields in the non-secret journal", () => {
    const base = {
      schemaVersion: 1,
      activeCredential: { issuedAt: ISSUED_AT, expiresAt: EXPIRES_AT },
      updatedAt: "2026-08-06T09:05:00.000Z",
    } as const;
    const runnerStopped = {
      ...base,
      pendingRotation: {
        stage: "runner_stopped",
        requestId: REQUEST_ID,
      },
    };
    const candidate = {
      requestId: REQUEST_ID,
      candidatePath: CANDIDATE_PATH,
      tokenSha256: "c".repeat(64),
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
    };
    const stageStates = [
      runnerStopped,
      { ...base, pendingRotation: { ...candidate, stage: "candidate_ready" } },
      {
        ...base,
        pendingRotation: {
          ...candidate,
          stage: "dispatch_prepared",
          expectedHeadSha: HEAD_SHA,
        },
      },
      {
        ...base,
        pendingRotation: {
          ...candidate,
          stage: "workflow_dispatched",
          expectedHeadSha: HEAD_SHA,
          workflowRunId: 123456,
        },
      },
      {
      ...base,
      pendingRotation: {
          ...candidate,
        stage: "server_accepted",
        expectedHeadSha: HEAD_SHA,
        workflowRunId: 123456,
      },
      },
      {
        ...base,
        pendingRotation: {
          ...candidate,
          stage: "candidate_promoted",
          expectedHeadSha: HEAD_SHA,
          workflowRunId: 123456,
        },
      },
    ];
    const serverAccepted = stageStates[4];

    for (const state of stageStates) {
      expect(parseCredentialRotationState(state, CREDENTIAL_ROOT)).toEqual(state);
    }
    expect(() => parseCredentialRotationState({
      ...serverAccepted,
      pendingRotation: { ...serverAccepted.pendingRotation, rawToken: "forbidden" },
    }, CREDENTIAL_ROOT)).toThrow("invalid credential rotation state");
    expect(() => parseCredentialRotationState({
      ...serverAccepted,
      pendingRotation: { ...serverAccepted.pendingRotation, workflowRunId: null },
    }, CREDENTIAL_ROOT)).toThrow("invalid credential rotation state");
    expect(() => parseCredentialRotationState({
      ...serverAccepted,
      pendingRotation: {
        ...serverAccepted.pendingRotation,
        candidatePath: `${CREDENTIAL_ROOT}\\..\\unrelated.dpapi`,
      },
    }, CREDENTIAL_ROOT)).toThrow("credential candidate path mismatch");
  });

  it("compares a decrypted candidate token to the expected digest", () => {
    const token = "candidate-token-value";
    const digest = createHash("sha256").update(token, "utf8").digest("hex");

    expect(credentialTokenMatchesDigest(token, digest)).toBe(true);
    expect(credentialTokenMatchesDigest(`${token}-wrong`, digest)).toBe(false);
  });

  it("plans every interruption recovery without guessing", () => {
    const candidate = {
      candidatePath: CANDIDATE_PATH,
      expiresAt: EXPIRES_AT,
      issuedAt: ISSUED_AT,
      requestId: REQUEST_ID,
      tokenSha256: "c".repeat(64),
    };

    expect(planCredentialRotationRecovery({
      requestId: REQUEST_ID,
      stage: "runner_stopped",
    }, { candidateExists: true })).toBe("remove_orphan_candidate");
    expect(planCredentialRotationRecovery({
      requestId: REQUEST_ID,
      stage: "runner_stopped",
    }, { candidateExists: false })).toBe("generate_candidate");
    expect(planCredentialRotationRecovery({
      ...candidate,
      stage: "candidate_ready",
    }, { candidateExists: false })).toBe("restart_with_fresh_candidate");
    expect(planCredentialRotationRecovery({
      ...candidate,
      expectedHeadSha: HEAD_SHA,
      stage: "dispatch_prepared",
    }, { candidateExists: true })).toBe("inspect_correlated_workflow");
    expect(planCredentialRotationRecovery({
      ...candidate,
      expectedHeadSha: HEAD_SHA,
      stage: "server_accepted",
      workflowRunId: 42,
    }, { candidateExists: false, activeMatchesCandidate: false }))
      .toBe("rotate_fresh_candidate");
    expect(planCredentialRotationRecovery({
      ...candidate,
      expectedHeadSha: HEAD_SHA,
      stage: "server_accepted",
      workflowRunId: 42,
    }, { candidateExists: false, activeMatchesCandidate: true }))
      .toBe("finalize_existing_promotion");
  });

  it("selects exactly one successful workflow run at the expected main SHA", () => {
    const title = `Support Autopilot Credential Rotation action=enable request_id=${REQUEST_ID}`;
    const run = {
      databaseId: 42,
      displayTitle: title,
      event: "workflow_dispatch",
      headBranch: "main",
      headSha: HEAD_SHA,
      status: "completed",
      conclusion: "success",
    };

    expect(selectCredentialRotationRun([run], {
      requestId: REQUEST_ID,
      expectedHeadSha: HEAD_SHA,
    })).toEqual(run);
  });

  it("locates the exact in-progress run before completion", () => {
    const run = {
      conclusion: null,
      databaseId: 42,
      displayTitle: `Support Autopilot Credential Rotation action=enable request_id=${REQUEST_ID}`,
      event: "workflow_dispatch",
      headBranch: "main",
      headSha: HEAD_SHA,
      status: "in_progress",
    };

    expect(locateCredentialRotationRun([run], {
      requestId: REQUEST_ID,
      expectedHeadSha: HEAD_SHA,
    })).toEqual(run);
  });

  it("fails closed for missing, ambiguous, stale, or unsuccessful runs", () => {
    const title = `Support Autopilot Credential Rotation action=enable request_id=${REQUEST_ID}`;
    const run = {
      databaseId: 42,
      displayTitle: title,
      event: "workflow_dispatch",
      headBranch: "main",
      headSha: HEAD_SHA,
      status: "completed",
      conclusion: "success",
    };
    const expected = { requestId: REQUEST_ID, expectedHeadSha: HEAD_SHA };

    expect(() => selectCredentialRotationRun([], expected))
      .toThrow("credential rotation run not found");
    expect(() => selectCredentialRotationRun([run, { ...run, databaseId: 43 }], expected))
      .toThrow("credential rotation run is ambiguous");
    expect(() => selectCredentialRotationRun([{ ...run, displayTitle: `${title}-near-match` }], expected))
      .toThrow("credential rotation run not found");
    expect(() => selectCredentialRotationRun([{ ...run, headBranch: "feature" }], expected))
      .toThrow("credential rotation run branch mismatch");
    expect(() => selectCredentialRotationRun([{ ...run, headSha: "d".repeat(40) }], expected))
      .toThrow("credential rotation run revision mismatch");
    expect(() => selectCredentialRotationRun([{ ...run, conclusion: "failure" }], expected))
      .toThrow("credential rotation run did not succeed");
    expect(() => selectCredentialRotationRun([{ ...run, rawToken: "forbidden" }], expected))
      .toThrow("invalid credential rotation run inventory");
  });
});
