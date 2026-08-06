import { describe, expect, it, vi } from "vitest";
import {
  runCredentialSupervisorCommand,
} from "../src/runner/support-autopilot-credential-supervisor-main.js";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const ROOT = "C:\\support-autopilot\\credentials";
const HEAD_SHA = "a".repeat(40);
const activeState = {
  schemaVersion: 1,
  activeCredential: {
    issuedAt: "2026-08-06T09:00:00.000Z",
    expiresAt: "2026-08-07T08:00:00.000Z",
  },
  pendingRotation: null,
  updatedAt: "2026-08-06T09:05:00.000Z",
};

describe("credential supervisor command boundary", () => {
  it("returns a sanitized rotation decision from a strict journal", async () => {
    const readJsonFile = vi.fn().mockResolvedValue(activeState);

    await expect(runCredentialSupervisorCommand([
      "decision",
      "--state", "C:\\support-autopilot\\state\\rotation.json",
      "--credential-root", ROOT,
      "--now", "2026-08-07T02:00:00.001Z",
    ], { readJsonFile })).resolves.toEqual({
      expired: false,
      pendingRotation: false,
      rotate: true,
    });
  });

  it("marks an expired credential for recovery without reading its blob", async () => {
    await expect(runCredentialSupervisorCommand([
      "decision",
      "--state", "C:\\support-autopilot\\state\\rotation.json",
      "--credential-root", ROOT,
      "--now", "2026-08-07T08:00:00.000Z",
    ], { readJsonFile: vi.fn().mockResolvedValue(activeState) })).resolves.toEqual({
      expired: true,
      pendingRotation: false,
      rotate: true,
    });
  });

  it("validates a journal without echoing its contents", async () => {
    await expect(runCredentialSupervisorCommand([
      "validate-state",
      "--state", "C:\\support-autopilot\\state\\rotation.json",
      "--credential-root", ROOT,
    ], { readJsonFile: vi.fn().mockResolvedValue(activeState) }))
      .resolves.toEqual({ valid: true });
  });

  it("validates generated hash-only metadata", async () => {
    await expect(runCredentialSupervisorCommand([
      "validate-generated",
      "--metadata", "C:\\support-autopilot\\state\\candidate.json",
    ], {
      readJsonFile: vi.fn().mockResolvedValue({
        expiresAt: "2026-08-07T08:00:00.000Z",
        issuedAt: "2026-08-06T09:00:00.000Z",
        tokenSha256: "b".repeat(64),
      }),
    })).resolves.toEqual({ valid: true });
  });

  it("returns a tested recovery action for interrupted local stages", async () => {
    const runnerStoppedState = {
      ...activeState,
      pendingRotation: { requestId: REQUEST_ID, stage: "runner_stopped" },
    };
    await expect(runCredentialSupervisorCommand([
      "recovery-action",
      "--state", "C:\\support-autopilot\\state\\rotation.json",
      "--credential-root", ROOT,
      "--active-path", `${ROOT}\\support-autopilot.dpapi`,
    ], {
      pathExists: vi.fn().mockReturnValue(true),
      readJsonFile: vi.fn().mockResolvedValue(runnerStoppedState),
    })).resolves.toEqual({ action: "remove_orphan_candidate" });

    const serverAcceptedState = {
      ...activeState,
      pendingRotation: {
        candidatePath: `${ROOT}\\candidate-${REQUEST_ID}.dpapi`,
        expiresAt: "2026-08-07T08:00:00.000Z",
        expectedHeadSha: HEAD_SHA,
        issuedAt: "2026-08-06T09:00:00.000Z",
        requestId: REQUEST_ID,
        stage: "server_accepted",
        tokenSha256: "ca279688ba128c434863a6f4c5537dd5ee39c79fe6f882066e3d939e98c22717",
        workflowRunId: 42,
      },
    };
    await expect(runCredentialSupervisorCommand([
      "recovery-action",
      "--state", "C:\\support-autopilot\\state\\rotation.json",
      "--credential-root", ROOT,
      "--active-path", `${ROOT}\\support-autopilot.dpapi`,
    ], {
      pathExists: vi.fn().mockReturnValue(false),
      readJsonFile: vi.fn().mockResolvedValue(serverAcceptedState),
      secretProvider: { read: vi.fn().mockResolvedValue("old-token") },
    })).resolves.toEqual({ action: "rotate_fresh_candidate" });
  });

  it("verifies a decrypted candidate only by digest", async () => {
    const digest = "ca279688ba128c434863a6f4c5537dd5ee39c79fe6f882066e3d939e98c22717";
    const read = vi.fn().mockResolvedValue("candidate-token-value");

    await expect(runCredentialSupervisorCommand([
      "verify-candidate",
      "--candidate-path", `${ROOT}\\candidate-${REQUEST_ID}.dpapi`,
      "--digest", digest,
    ], { secretProvider: { read } })).resolves.toEqual({ matches: true });
  });

  it("selects a correlated workflow run without returning inventory extras", async () => {
    const run = {
      conclusion: "success",
      databaseId: 42,
      displayTitle: `Support Autopilot Credential Rotation action=enable request_id=${REQUEST_ID}`,
      event: "workflow_dispatch",
      headBranch: "support-autopilot-credential-rotation-v1",
      headSha: HEAD_SHA,
      status: "completed",
    };

    await expect(runCredentialSupervisorCommand([
      "select-run",
      "--inventory", "C:\\support-autopilot\\state\\runs.json",
      "--request-id", REQUEST_ID,
      "--expected-ref", "support-autopilot-credential-rotation-v1",
      "--expected-sha", HEAD_SHA,
    ], { readJsonFile: vi.fn().mockResolvedValue([run]) })).resolves.toEqual({
      workflowRunId: 42,
    });
  });

  it("locates a correlated workflow run before it completes", async () => {
    const run = {
      conclusion: null,
      databaseId: 42,
      displayTitle: `Support Autopilot Credential Rotation action=enable request_id=${REQUEST_ID}`,
      event: "workflow_dispatch",
      headBranch: "support-autopilot-credential-rotation-v1",
      headSha: HEAD_SHA,
      status: "queued",
    };

    await expect(runCredentialSupervisorCommand([
      "locate-run",
      "--inventory", "C:\\support-autopilot\\state\\runs.json",
      "--request-id", REQUEST_ID,
      "--expected-ref", "support-autopilot-credential-rotation-v1",
      "--expected-sha", HEAD_SHA,
    ], { readJsonFile: vi.fn().mockResolvedValue([run]) })).resolves.toEqual({
      status: "queued",
      workflowRunId: 42,
    });
  });

  it("distinguishes an absent run from an ambiguous inventory", async () => {
    const args = [
      "probe-run",
      "--inventory", "C:\\support-autopilot\\state\\runs.json",
      "--request-id", REQUEST_ID,
      "--expected-ref", "support-autopilot-credential-rotation-v1",
      "--expected-sha", HEAD_SHA,
    ];
    await expect(runCredentialSupervisorCommand(args, {
      readJsonFile: vi.fn().mockResolvedValue([]),
    })).resolves.toEqual({ found: false });

    const run = {
      conclusion: null,
      databaseId: 42,
      displayTitle: `Support Autopilot Credential Rotation action=enable request_id=${REQUEST_ID}`,
      event: "workflow_dispatch",
      headBranch: "support-autopilot-credential-rotation-v1",
      headSha: HEAD_SHA,
      status: "queued",
    };
    await expect(runCredentialSupervisorCommand(args, {
      readJsonFile: vi.fn().mockResolvedValue([run, { ...run, databaseId: 43 }]),
    })).rejects.toThrow("SUPPORT_AUTOPILOT_CREDENTIAL_SUPERVISOR_FAILED");
  });

  it("collapses all failures and never includes raw values", async () => {
    const error = await runCredentialSupervisorCommand([
      "verify-candidate",
      "--candidate-path", `${ROOT}\\candidate-${REQUEST_ID}.dpapi`,
      "--digest", "b".repeat(64),
    ], {
      secretProvider: {
        read: vi.fn().mockRejectedValue(new Error("raw-token-from-dpapi")),
      },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("SUPPORT_AUTOPILOT_CREDENTIAL_SUPERVISOR_FAILED");
    expect((error as Error).message).not.toContain("raw-token-from-dpapi");
  });
});
