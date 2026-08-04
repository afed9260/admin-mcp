import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_JOB_ID,
  SYNTHETIC_LATEST_MESSAGE_ID,
  SYNTHETIC_LEASE_TOKEN,
  SYNTHETIC_RENEWED_LEASE_TOKEN,
  SyntheticSupportAutopilotApi,
} from "../src/synthetic/synthetic-support-autopilot-api.js";

const workerId = "support-synthetic.1";

function leaseBody(leaseToken = SYNTHETIC_LEASE_TOKEN) {
  return { leaseToken, workerId };
}

function decisionBody(override: Record<string, unknown> = {}) {
  return {
    decisionType: "request_information",
    evidenceFactKeys: ["ticket.state", "ticket.latest_message"],
    expectedLatestMessageId: SYNTHETIC_LATEST_MESSAGE_ID,
    expectedTicketVersion: 1,
    internalReasoning: "Synthetic evidence is sufficient.",
    leaseToken: SYNTHETIC_LEASE_TOKEN,
    proposedReply: "Please reconnect the fictional integration.",
    selectedPolicyId: "avito_reconnect_required.v1",
    workerId,
    ...override,
  };
}

async function claimAndRead(api: SyntheticSupportAutopilotApi, leaseToken = SYNTHETIC_LEASE_TOKEN) {
  await api.post("/support-automation/jobs/claim", { workerId });
  return api.post(`/support-automation/jobs/${SYNTHETIC_JOB_ID}/context`, {
    leaseToken,
    workerId,
  });
}

describe("SyntheticSupportAutopilotApi", () => {
  it("completes one deterministic fictional shadow lifecycle", async () => {
    const api = new SyntheticSupportAutopilotApi();

    await expect(api.post("/support-automation/work-availability", { workerId }))
      .resolves.toEqual({ retryAfterMs: 5_000, workAvailable: true });
    await expect(api.post("/support-automation/jobs/claim", { workerId }))
      .resolves.toMatchObject({ jobId: SYNTHETIC_JOB_ID, leaseToken: SYNTHETIC_LEASE_TOKEN });
    await expect(api.post(`/support-automation/jobs/${SYNTHETIC_JOB_ID}/context`, leaseBody()))
      .resolves.toMatchObject({
        attachmentRefs: [],
        mode: "shadow",
        ticket: {
          latestMessage: { id: SYNTHETIC_LATEST_MESSAGE_ID },
          version: 1,
        },
      });
    await expect(api.post(
      `/support-automation/jobs/${SYNTHETIC_JOB_ID}/decision`,
      decisionBody(),
    )).resolves.toEqual({
      customerAction: "none",
      jobStatus: "completed",
      outcome: "shadow_recorded",
      ticketMutation: false,
    });
    await expect(api.get("/support-automation/health")).resolves.toEqual({
      activeLeases: 0,
      completedJobs: 1,
      pendingJobs: 0,
      synthetic: true,
    });
    await expect(api.post("/support-automation/work-availability", { workerId }))
      .resolves.toEqual({ retryAfterMs: 5_000, workAvailable: false });
  });

  it("rotates the lease once and rejects the previous token", async () => {
    const api = new SyntheticSupportAutopilotApi();
    await api.post("/support-automation/jobs/claim", { workerId });

    await expect(api.post(
      `/support-automation/jobs/${SYNTHETIC_JOB_ID}/lease/renew`,
      leaseBody(),
    )).resolves.toMatchObject({
      jobId: SYNTHETIC_JOB_ID,
      leaseToken: SYNTHETIC_RENEWED_LEASE_TOKEN,
    });
    await expect(api.post(
      `/support-automation/jobs/${SYNTHETIC_JOB_ID}/context`,
      leaseBody(),
    )).rejects.toThrow("SYNTHETIC_SUPPORT_AUTOPILOT_INVALID");
    await expect(api.post(
      `/support-automation/jobs/${SYNTHETIC_JOB_ID}/context`,
      leaseBody(SYNTHETIC_RENEWED_LEASE_TOKEN),
    )).resolves.toMatchObject({ mode: "shadow" });
    await expect(api.post(
      `/support-automation/jobs/${SYNTHETIC_JOB_ID}/decision`,
      decisionBody({ leaseToken: SYNTHETIC_RENEWED_LEASE_TOKEN }),
    )).resolves.toMatchObject({ outcome: "shadow_recorded" });
  });

  it("fails closed for invalid lifecycle operations", async () => {
    const api = new SyntheticSupportAutopilotApi();

    await expect(api.post(
      `/support-automation/jobs/${SYNTHETIC_JOB_ID}/context`,
      leaseBody(),
    )).rejects.toThrow("SYNTHETIC_SUPPORT_AUTOPILOT_INVALID");
    await expect(api.post("/support-automation/jobs/claim", { workerId: "wrong-worker.1" }))
      .rejects.toThrow("SYNTHETIC_SUPPORT_AUTOPILOT_INVALID");
    await api.post("/support-automation/jobs/claim", { workerId });
    await expect(api.post(
      `/support-automation/jobs/${SYNTHETIC_JOB_ID}/decision`,
      decisionBody(),
    )).rejects.toThrow("SYNTHETIC_SUPPORT_AUTOPILOT_INVALID");
    await expect(api.post(
      `/support-automation/jobs/${SYNTHETIC_JOB_ID}/context`,
      leaseBody("X".repeat(43)),
    )).rejects.toThrow("SYNTHETIC_SUPPORT_AUTOPILOT_INVALID");
    await expect(api.post(
      `/support-automation/jobs/${SYNTHETIC_JOB_ID}/attachments/att_${"a".repeat(64)}`,
      leaseBody(),
    )).rejects.toThrow("SYNTHETIC_SUPPORT_AUTOPILOT_INVALID");
    await expect(api.get("/support-automation/unknown"))
      .rejects.toThrow("SYNTHETIC_SUPPORT_AUTOPILOT_INVALID");
  });

  it.each([
    ["stale ticket version", { expectedTicketVersion: 2 }],
    ["stale latest message", { expectedLatestMessageId: "7cc98548-b99e-4e93-93ed-7281499fc4c7" }],
  ])("rejects %s and a duplicate decision", async (_name, override) => {
    const api = new SyntheticSupportAutopilotApi();
    await claimAndRead(api);
    await expect(api.post(
      `/support-automation/jobs/${SYNTHETIC_JOB_ID}/decision`,
      decisionBody(override),
    )).rejects.toThrow("SYNTHETIC_SUPPORT_AUTOPILOT_INVALID");

    await expect(api.post(
      `/support-automation/jobs/${SYNTHETIC_JOB_ID}/decision`,
      decisionBody(),
    )).resolves.toMatchObject({ outcome: "shadow_recorded" });
    await expect(api.post(
      `/support-automation/jobs/${SYNTHETIC_JOB_ID}/decision`,
      decisionBody(),
    )).rejects.toThrow("SYNTHETIC_SUPPORT_AUTOPILOT_INVALID");
  });
});
