import { describe, expect, it } from "vitest";
import { assertSupportPrivacyAttestation } from "../src/runner/support-privacy-attestation.js";

const expectation = {
  attestationId: "support-privacy-v1",
  expiresAt: "2026-08-30T00:00:00.000Z",
};
const now = new Date("2026-08-05T10:00:00.000Z");

function attestation(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    attestationId: expectation.attestationId,
    dataControlsApproved: true,
    expiresAt: expectation.expiresAt,
    modelTrainingDisabled: true,
    privacyGateApproved: true,
    workspaceType: "pro",
    ...overrides,
  });
}

describe("support privacy attestation", () => {
  it.each([
    ["pro", true],
    ["plus", true],
    ["business", false],
    ["enterprise", false],
    ["edu", false],
  ])("accepts an approved %s workspace", (workspaceType, modelTrainingDisabled) => {
    expect(() => assertSupportPrivacyAttestation(
      attestation({ modelTrainingDisabled, workspaceType }),
      expectation,
      now,
    )).not.toThrow();
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["wrong id", attestation({ attestationId: "other" })],
    ["expired", attestation({ expiresAt: "2026-08-04T00:00:00.000Z" })],
    ["Pro training enabled", attestation({ modelTrainingDisabled: false })],
    ["privacy not approved", attestation({ privacyGateApproved: false })],
    ["data controls not approved", attestation({ dataControlsApproved: false })],
    ["unknown workspace", attestation({ workspaceType: "team" })],
    ["extra key", attestation({ note: "unexpected" })],
  ])("rejects %s", (_name, value) => {
    expect(() => assertSupportPrivacyAttestation(value, expectation, now))
      .toThrow("SUPPORT_PRIVACY_ATTESTATION_INVALID");
  });
});
