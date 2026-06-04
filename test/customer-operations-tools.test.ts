import { describe, expect, it, vi } from "vitest";
import { AdminApiClient } from "../src/backend/admin-api-client.js";
import { createCustomerOperationsTools } from "../src/tools/customer-operations-tools.js";

function createClient() {
  return {
    get: vi.fn(async () => ({ ok: true })),
    post: vi.fn(async () => ({ ok: true })),
  } as unknown as AdminApiClient;
}

describe("createCustomerOperationsTools", () => {
  it("loads a customer operations profile by Telegram user id", async () => {
    const client = createClient();
    const tools = createCustomerOperationsTools(client);

    await expect(tools.getCustomerOperationsProfile({
      telegramUserId: 437078503,
      originType: "support_ticket",
      originId: "ticket-1",
    })).resolves.toEqual({ ok: true });

    expect(client.get).toHaveBeenCalledWith(
      "/customer-operations/profile?telegramUserId=437078503&originType=support_ticket&originId=ticket-1",
    );
  });

  it("dry-runs a customer dialog launch credit grant", async () => {
    const client = createClient();
    const tools = createCustomerOperationsTools(client);

    await expect(tools.dryRunCustomerDialogLaunchCredits({
      telegramUserId: 437078503,
      expectedTelegramUserId: 437078503,
      slots: 10,
      idempotencyKey: "support-ticket-ticket-1-dialog-credit",
      reason: "Customer paid but cannot launch dialogs",
    })).resolves.toEqual({ ok: true });

    expect(client.post).toHaveBeenCalledWith("/customer-operations/dialog-launch-credits/dry-run", {
      telegramUserId: 437078503,
      expectedTelegramUserId: 437078503,
      slots: 10,
      idempotencyKey: "support-ticket-ticket-1-dialog-credit",
      reason: "Customer paid but cannot launch dialogs",
    });
  });

  it("applies a customer dialog launch credit grant without forwarding confirm", async () => {
    const client = createClient();
    const tools = createCustomerOperationsTools(client);

    await expect(tools.applyCustomerDialogLaunchCredits({
      telegramUserId: 437078503,
      expectedTelegramUserId: 437078503,
      slots: 10,
      idempotencyKey: "support-ticket-ticket-1-dialog-credit",
      reason: "Confirmed paid customer needs dialog launch credits",
      confirm: true,
    })).resolves.toEqual({ ok: true });

    expect(client.post).toHaveBeenCalledWith("/customer-operations/dialog-launch-credits/apply", {
      telegramUserId: 437078503,
      expectedTelegramUserId: 437078503,
      slots: 10,
      idempotencyKey: "support-ticket-ticket-1-dialog-credit",
      reason: "Confirmed paid customer needs dialog launch credits",
    });
  });

  it("rejects apply without confirmation before reaching the backend", () => {
    const client = createClient();
    const tools = createCustomerOperationsTools(client);

    expect(() => tools.applyCustomerDialogLaunchCredits({
      telegramUserId: 437078503,
      expectedTelegramUserId: 437078503,
      idempotencyKey: "support-ticket-ticket-1-dialog-credit",
      reason: "Confirmed paid customer needs dialog launch credits",
    })).toThrow(/confirm/);

    expect(client.post).not.toHaveBeenCalled();
  });
});
