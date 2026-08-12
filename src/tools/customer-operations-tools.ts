import { AdminApiClient } from "../backend/admin-api-client.js";
import { toSearchParams } from "../backend/search-params.js";
import {
  customerBillingReconciliationQuerySchema,
  customerDialogLaunchCreditApplySchema,
  customerDialogLaunchCreditDryRunSchema,
  customerOperationsProfileQuerySchema,
  referralManualReviewApproveSchema,
  referralManualReviewListSchema,
  referralManualReviewRejectSchema,
  successfulDialogDebtRecoveryApplySchema,
  successfulDialogDebtRecoveryDryRunSchema,
  successfulDialogExistingSlotRecoveryApplySchema,
  successfulDialogExistingSlotRecoveryDryRunSchema,
} from "./schemas.js";

export function createCustomerOperationsTools(client: AdminApiClient) {
  return {
    getCustomerOperationsProfile(input: unknown) {
      const query = customerOperationsProfileQuerySchema.parse(input);
      return client.get(`/customer-operations/profile?${toSearchParams(query)}`);
    },

    getCustomerBillingReconciliation(input: unknown) {
      const query = customerBillingReconciliationQuerySchema.parse(input);
      return client.get(`/customer-operations/billing-reconciliation?${toSearchParams(query)}`);
    },

    dryRunCustomerDialogLaunchCredits(input: unknown) {
      const body = customerDialogLaunchCreditDryRunSchema.parse(input);
      return client.post("/customer-operations/dialog-launch-credits/dry-run", body);
    },

    applyCustomerDialogLaunchCredits(input: unknown) {
      const mutation = customerDialogLaunchCreditApplySchema.parse(input);
      return client.post("/customer-operations/dialog-launch-credits/apply", mutation);
    },

    dryRunSuccessfulDialogDebtRecovery(input: unknown) {
      const body = successfulDialogDebtRecoveryDryRunSchema.parse(input);
      return client.post("/customer-operations/successful-dialog-debt-recovery/dry-run", body);
    },

    applySuccessfulDialogDebtRecovery(input: unknown) {
      const mutation = successfulDialogDebtRecoveryApplySchema.parse(input);
      return client.post("/customer-operations/successful-dialog-debt-recovery/apply", mutation);
    },

    dryRunSuccessfulDialogExistingSlotRecovery(input: unknown) {
      const body = successfulDialogExistingSlotRecoveryDryRunSchema.parse(input);
      return client.post("/customer-operations/successful-dialog-debt-recovery/existing-slots/dry-run", body);
    },

    applySuccessfulDialogExistingSlotRecovery(input: unknown) {
      const mutation = successfulDialogExistingSlotRecoveryApplySchema.parse(input);
      return client.post("/customer-operations/successful-dialog-debt-recovery/existing-slots/apply", mutation);
    },

    listReferralManualReviewItems(input: unknown) {
      const query = referralManualReviewListSchema.parse(input);
      return client.get(`/customer-operations/referral-manual-review?${toSearchParams(query)}`);
    },

    approveReferralManualReviewGrant(input: unknown) {
      const mutation = referralManualReviewApproveSchema.parse(input);
      const { grantId, ...body } = mutation;
      return client.post(
        `/customer-operations/referral-manual-review/${encodeURIComponent(grantId)}/approve`,
        body,
      );
    },

    rejectReferralManualReviewGrant(input: unknown) {
      const mutation = referralManualReviewRejectSchema.parse(input);
      const { grantId, ...body } = mutation;
      return client.post(
        `/customer-operations/referral-manual-review/${encodeURIComponent(grantId)}/reject`,
        body,
      );
    },
  };
}
