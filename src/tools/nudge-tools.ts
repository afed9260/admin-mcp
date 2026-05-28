import { AdminApiClient } from "../backend/admin-api-client.js";
import { toSearchParams } from "../backend/search-params.js";
import {
  nudgeCandidatesQuerySchema,
  nudgeHistoryQuerySchema,
  nudgePhotoUploadSchema,
  nudgeRuleUpdateSchema,
  nudgeTestSendSchema,
} from "./schemas.js";

function omitConfirmation(input: Record<string, unknown>) {
  const { confirm, reason, ruleId, ...body } = input;
  return body;
}

export function createNudgeTools(client: AdminApiClient) {
  return {
    async listNudgeRules() {
      return client.get("/nudge/rules");
    },

    async getNudgeRuleCandidates(input: unknown) {
      const query = nudgeCandidatesQuerySchema.parse(input);
      return client.get(`/nudge/rules/${encodeURIComponent(query.ruleId)}/candidates`);
    },

    async getNudgeHistory(input: unknown) {
      const query = nudgeHistoryQuerySchema.parse(input);
      return client.get(`/nudge/history?${toSearchParams(query)}`);
    },

    async updateNudgeRule(input: unknown) {
      const mutation = nudgeRuleUpdateSchema.parse(input);
      return client.put(`/nudge/rules/${encodeURIComponent(mutation.ruleId)}`, omitConfirmation(mutation));
    },

    async uploadNudgePhoto(input: unknown) {
      const upload = nudgePhotoUploadSchema.parse(input);
      const bytes = Buffer.from(upload.fileDataBase64, "base64");
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: upload.mimeType }), upload.fileName);
      return client.postForm("/nudge/upload-photo", form);
    },

    async sendNudgeTest(input: unknown) {
      const mutation = nudgeTestSendSchema.parse(input);
      return client.post(`/nudge/rules/${encodeURIComponent(mutation.ruleId)}/test-send`, {
        telegramUserId: mutation.telegramUserId,
      });
    },
  };
}
