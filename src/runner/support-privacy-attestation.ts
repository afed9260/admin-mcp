export interface SupportPrivacyAttestationExpectation {
  attestationId: string;
  expiresAt: string;
}

export function assertSupportPrivacyAttestation(
  raw: string,
  expected: SupportPrivacyAttestationExpectation,
  now = new Date(),
): void {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) {
      throw new Error("invalid attestation");
    }
    const keys = Object.keys(value).sort();
    const exactKeys = [
      "attestationId",
      "dataControlsApproved",
      "expiresAt",
      "modelTrainingDisabled",
      "privacyGateApproved",
      "workspaceType",
    ].sort();
    const expiry = typeof value.expiresAt === "string" ? new Date(value.expiresAt) : null;
    const workspaceApproved = value.workspaceType === "business"
      || value.workspaceType === "enterprise"
      || value.workspaceType === "edu"
      || ((value.workspaceType === "plus" || value.workspaceType === "pro")
        && value.modelTrainingDisabled === true);
    if (
      keys.length !== exactKeys.length
      || !keys.every((key, index) => key === exactKeys[index])
      || value.attestationId !== expected.attestationId
      || value.expiresAt !== expected.expiresAt
      || !expiry
      || Number.isNaN(expiry.getTime())
      || expiry.toISOString() !== value.expiresAt
      || expiry.getTime() <= now.getTime()
      || value.dataControlsApproved !== true
      || value.privacyGateApproved !== true
      || typeof value.modelTrainingDisabled !== "boolean"
      || !workspaceApproved
    ) {
      throw new Error("invalid attestation");
    }
  } catch {
    throw new Error("SUPPORT_PRIVACY_ATTESTATION_INVALID");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
