import { AdminApiClient } from "../backend/admin-api-client.js";
import { toSearchParams } from "../backend/search-params.js";
import { dialogDetailQuerySchema, dialogsQuerySchema } from "./schemas.js";

export function createDialogTools(client: AdminApiClient) {
  return {
    async listDialogs(input: unknown) {
      const query = dialogsQuerySchema.parse(input);
      return client.get(`/statistics/dialogs?${toSearchParams(query)}`);
    },

    async getDialog(input: unknown) {
      const query = dialogDetailQuerySchema.parse(input);
      return client.get(`/statistics/dialogs/${encodeURIComponent(query.chatId)}`);
    },
  };
}
