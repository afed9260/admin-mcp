import { AdminApiClient } from "../backend/admin-api-client.js";
import { toSearchParams } from "../backend/search-params.js";
import {
  customerDialogLaunchCreditApplySchema,
  customerDialogLaunchCreditDryRunSchema,
  customerOperationsProfileQuerySchema,
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
  };
}
