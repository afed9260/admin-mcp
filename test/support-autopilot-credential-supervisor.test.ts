import { describe, expect, it } from "vitest";
import {
  parseCredentialRotationState,
  parseGeneratedCredentialMetadata,
  selectCredentialRotationRun,
  shouldRotateCredential,
} from "../src/runner/support-autopilot-credential-supervisor.js";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const HEAD_SHA = "a".repeat(40);
const ISSUED_AT = "2026-08-06T09:00:00.000Z";
const EXPIRES_AT = "2026-08-07T08:00:00.000Z";

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

  it("rotates at the six-hour lead boundary but not before it", () => {
    const metadata = { issuedAt: ISSUED_AT, expiresAt: EXPIRES_AT };

    expect(shouldRotateCredential(
      metadata,
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
        expectedHeadSha: HEAD_SHA,
      },
    };
    const serverAccepted = {
      ...base,
      pendingRotation: {
        stage: "server_accepted",
        requestId: REQUEST_ID,
        candidatePath: "C:\\support-autopilot\\credentials\\candidate.dpapi",
        tokenSha256: "c".repeat(64),
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
        expectedHeadSha: HEAD_SHA,
        workflowRunId: 123456,
      },
    };

    expect(parseCredentialRotationState(runnerStopped)).toEqual(runnerStopped);
    expect(parseCredentialRotationState(serverAccepted)).toEqual(serverAccepted);
    expect(() => parseCredentialRotationState({
      ...serverAccepted,
      pendingRotation: { ...serverAccepted.pendingRotation, rawToken: "forbidden" },
    })).toThrow("invalid credential rotation state");
    expect(() => parseCredentialRotationState({
      ...serverAccepted,
      pendingRotation: { ...serverAccepted.pendingRotation, workflowRunId: null },
    })).toThrow("invalid credential rotation state");
  });

  it("selects exactly one successful workflow run at the expected main SHA", () => {
    const title = `Support Autopilot Credential Rotation / enable / ${REQUEST_ID}`;
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

  it("fails closed for missing, ambiguous, stale, or unsuccessful runs", () => {
    const title = `Support Autopilot Credential Rotation / enable / ${REQUEST_ID}`;
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
  });
});
