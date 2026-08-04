import type { SupportAutopilotClient } from "../tools/support-autopilot-tools.js";

export const SYNTHETIC_JOB_ID = "5cc98548-b99e-4e93-93ed-7281499fc4c7";
export const SYNTHETIC_LATEST_MESSAGE_ID = "6cc98548-b99e-4e93-93ed-7281499fc4c7";
export const SYNTHETIC_LEASE_TOKEN = "S".repeat(43);
export const SYNTHETIC_RENEWED_LEASE_TOKEN = "R".repeat(43);

const SYNTHETIC_WORKER_ID = "support-synthetic.1";
const LEASE_EXPIRES_AT = "2099-01-01T00:00:00.000Z";
const DECISION_PATH = `/support-automation/jobs/${SYNTHETIC_JOB_ID}/decision`;
const CONTEXT_PATH = `/support-automation/jobs/${SYNTHETIC_JOB_ID}/context`;
const RENEW_PATH = `/support-automation/jobs/${SYNTHETIC_JOB_ID}/lease/renew`;

type SyntheticState = "available" | "claimed" | "context_read" | "decided";

export class SyntheticSupportAutopilotApi implements SupportAutopilotClient {
  private activeLeaseToken = SYNTHETIC_LEASE_TOKEN;
  private renewed = false;
  private state: SyntheticState = "available";

  async get<T>(path: string): Promise<T> {
    if (path !== "/support-automation/health") {
      throw this.invalid();
    }
    return this.result<T>({
      activeLeases: this.state === "claimed" || this.state === "context_read" ? 1 : 0,
      completedJobs: this.state === "decided" ? 1 : 0,
      pendingJobs: this.state === "available" ? 1 : 0,
      synthetic: true,
    });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    if (path === "/support-automation/work-availability") {
      this.assertWorkerBody(body);
      return this.result<T>({
        retryAfterMs: 5_000,
        workAvailable: this.state === "available",
      });
    }
    if (path === "/support-automation/jobs/claim") {
      this.assertWorkerBody(body);
      if (this.state !== "available") {
        throw this.invalid();
      }
      this.state = "claimed";
      return this.result<T>({
        jobId: SYNTHETIC_JOB_ID,
        leaseExpiresAt: LEASE_EXPIRES_AT,
        leaseToken: this.activeLeaseToken,
      });
    }
    if (path === RENEW_PATH) {
      this.assertLeaseBody(body);
      if (
        (this.state !== "claimed" && this.state !== "context_read")
        || this.renewed
      ) {
        throw this.invalid();
      }
      this.renewed = true;
      this.activeLeaseToken = SYNTHETIC_RENEWED_LEASE_TOKEN;
      return this.result<T>({
        jobId: SYNTHETIC_JOB_ID,
        leaseExpiresAt: LEASE_EXPIRES_AT,
        leaseToken: this.activeLeaseToken,
      });
    }
    if (path === CONTEXT_PATH) {
      this.assertLeaseBody(body);
      if (this.state !== "claimed") {
        throw this.invalid();
      }
      this.state = "context_read";
      return this.result<T>(this.context());
    }
    if (path === DECISION_PATH) {
      this.assertDecisionBody(body);
      if (this.state !== "context_read") {
        throw this.invalid();
      }
      this.state = "decided";
      return this.result<T>({
        customerAction: "none",
        jobStatus: "completed",
        outcome: "shadow_recorded",
        ticketMutation: false,
      });
    }
    throw this.invalid();
  }

  private context() {
    return {
      attachmentRefs: [],
      evidenceFacts: {
        "ticket.latest_message": {
          id: SYNTHETIC_LATEST_MESSAGE_ID,
          text: "Как переподключить тестовую интеграцию Авито?",
        },
        "ticket.state": {
          category: "avito_connection_issue",
          priority: "P3",
          status: "open",
          version: 1,
        },
      },
      jobId: SYNTHETIC_JOB_ID,
      leaseExpiresAt: LEASE_EXPIRES_AT,
      mode: "shadow",
      policyCandidates: [{ policyId: "avito_reconnect_required.v1" }],
      ticket: {
        category: "avito_connection_issue",
        latestMessage: {
          author: "synthetic_customer",
          id: SYNTHETIC_LATEST_MESSAGE_ID,
          text: "Как переподключить тестовую интеграцию Авито?",
        },
        priority: "P3",
        status: "open",
        version: 1,
      },
    };
  }

  private assertWorkerBody(body: unknown): void {
    if (!this.isRecord(body) || Object.keys(body).length !== 1 || body.workerId !== SYNTHETIC_WORKER_ID) {
      throw this.invalid();
    }
  }

  private assertLeaseBody(body: unknown): void {
    if (
      !this.isRecord(body)
      || Object.keys(body).length !== 2
      || body.workerId !== SYNTHETIC_WORKER_ID
      || body.leaseToken !== this.activeLeaseToken
    ) {
      throw this.invalid();
    }
  }

  private assertDecisionBody(body: unknown): void {
    if (
      !this.isRecord(body)
      || body.workerId !== SYNTHETIC_WORKER_ID
      || body.leaseToken !== this.activeLeaseToken
      || body.expectedLatestMessageId !== SYNTHETIC_LATEST_MESSAGE_ID
      || body.expectedTicketVersion !== 1
    ) {
      throw this.invalid();
    }
  }

  private invalid(): Error {
    return new Error("SYNTHETIC_SUPPORT_AUTOPILOT_INVALID");
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private result<T>(value: unknown): T {
    return value as T;
  }
}
