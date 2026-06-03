import { AdminApiClient } from "../backend/admin-api-client.js";
import { toSearchParams } from "../backend/search-params.js";
import {
  supportActionBatchSchema,
  supportSummaryQuerySchema,
  supportTicketDetailSchema,
  supportTicketsQuerySchema,
} from "./schemas.js";

export function createSupportTools(client: AdminApiClient) {
  return {
    async listSupportTickets(input: unknown) {
      const query = supportTicketsQuerySchema.parse(input);
      return client.get(`/support-inbox/tickets?${toSearchParams(query)}`);
    },

    async getSupportTicket(input: unknown) {
      const query = supportTicketDetailSchema.parse(input);
      return client.get(`/support-inbox/tickets/${encodeURIComponent(query.ticketId)}`);
    },

    async getSupportSummary(input: unknown) {
      const query = supportSummaryQuerySchema.parse(input);
      return client.get(`/support-inbox/summary?${toSearchParams(query)}`);
    },

    async getSupportWaitingItems() {
      return client.get("/support-inbox/tickets?status=waiting_internal&page=1&limit=50");
    },

    async investigateSupportTicket(input: unknown) {
      const query = supportTicketDetailSchema.parse(input);
      return client.post(`/support-inbox/tickets/${encodeURIComponent(query.ticketId)}/investigations/run`, {});
    },

    async getSupportInvestigation(input: unknown) {
      const query = supportTicketDetailSchema.parse(input);
      return client.get(`/support-inbox/tickets/${encodeURIComponent(query.ticketId)}/investigations/latest`);
    },

    async executeSupportActionBatch(input: unknown) {
      const { ticketId, ...body } = supportActionBatchSchema.parse(input);
      return client.post(`/support-inbox/tickets/${encodeURIComponent(ticketId)}/action-batches`, body);
    },
  };
}
