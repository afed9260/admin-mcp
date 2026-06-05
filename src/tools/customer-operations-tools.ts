import { AdminApiClient } from "../backend/admin-api-client.js";
import { toSearchParams } from "../backend/search-params.js";
import {
  customerDialogLaunchCreditApplySchema,
  customerDialogLaunchCreditDryRunSchema,
  customerOperationsProfileQuerySchema,
  referralManualReviewApproveSchema,
  referralManualReviewListSchema,
  referralManualReviewRejectSchema,
} from "./schemas.js";

function omitConfirmation(input: Record<string, unknown>): Record<string, unknown> {
  const { confirm, ...body } = input;
  return body;
}

export function createCustomerOperationsTools(client: AdminApiClient) {
  return {
    getCustomerOperationsProfile(input: unknown) {
      const query = customerOperationsProfileQuerySchema.parse(input);
      return client.get(`/customer-operations/profile?${toSearchParams(query)}`);
    },

    dryRunCustomerDialogLaunchCredits(input: unknown) {
      const body = customerDialogLaunchCreditDryRunSchema.parse(input);
      return client.post("/customer-operations/dialog-launch-credits/dry-run", body);
    },

    applyCustomerDialogLaunchCredits(input: unknown) {
      const mutation = customerDialogLaunchCreditApplySchema.parse(input);
      return client.post("/customer-operations/dialog-launch-credits/apply", omitConfirmation(mutation));
    },

    listReferralManualReviewItems(input: unknown) {
      const query = referralManualReviewListSchema.parse(input);
      return client.get(`/customer-operations/referral/manual-review?${toSearchParams(query)}`);
    },

    approveReferralManualReviewGrant(input: unknown) {
      const mutation = referralManualReviewApproveSchema.parse(input);
      const { grantId, ...body } = mutation;
      return client.post(
        `/customer-operations/referral/manual-review/${encodeURIComponent(grantId)}/approve`,
        body,
      );
    },

    rejectReferralManualReviewGrant(input: unknown) {
      const mutation = referralManualReviewRejectSchema.parse(input);
      const { grantId, ...body } = mutation;
      return client.post(
        `/customer-operations/referral/manual-review/${encodeURIComponent(grantId)}/reject`,
        body,
      );
    },
  };
}
