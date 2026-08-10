import { AdminApiClient, AdminApiClientOptions } from "./admin-api-client.js";
import { BackendError } from "./backend-error.js";

export interface SupportAutomationWorkerIdentity {
  workerId: string;
}

export interface SupportAutomationRevisionLeaseIdentity extends SupportAutomationWorkerIdentity {
  leaseToken: string;
  revisionJobId: string;
}

export interface SupportAutomationRevisionDecisionInput
  extends SupportAutomationRevisionLeaseIdentity {
  decisionType: "auto_reply" | "request_information" | "auto_reply_and_escalate";
  evidenceFactKeys: Array<"ticket.state" | "ticket.latest_message">;
  expectedLatestMessageId: string;
  expectedTicketVersion: number;
  internalReasoning: string;
  proposedReply: string;
  selectedPolicyId:
    | "request_missing_reference.v1"
    | "kb_instruction.v1"
    | "avito_reconnect_required.v1"
    | "dialog_launches_exhausted.v1"
    | "scenario_trigger_guidance.v1"
    | "service_restored_retry.v1"
    | "unclassified.v1";
}

export type SupportAutomationRevisionFailureCode =
  | "runner_process_failed"
  | "runner_output_invalid"
  | "runner_tool_failed"
  | "runner_timeout";

export class SupportAutopilotApiClient extends AdminApiClient {
  constructor(options: AdminApiClientOptions) {
    super(options);
  }

  override async get<T>(path: string): Promise<T> {
    this.assertAllowedPath(path);
    return super.get<T>(path);
  }

  override async post<T>(path: string, body: unknown): Promise<T> {
    this.assertAllowedPath(path);
    return super.post<T>(path, body);
  }

  override async put<T>(path: string, body: unknown): Promise<T> {
    this.assertAllowedPath(path);
    return super.put<T>(path, body);
  }

  override async postForm<T>(path: string, body: FormData): Promise<T> {
    this.assertAllowedPath(path);
    return super.postForm<T>(path, body);
  }

  claimSupportAutomationRevision(
    input: SupportAutomationWorkerIdentity,
  ): Promise<unknown> {
    return this.post("/support-automation/revisions/claim", input);
  }

  renewSupportAutomationRevisionLease(
    input: SupportAutomationRevisionLeaseIdentity,
  ): Promise<unknown> {
    const { revisionJobId, ...body } = input;
    return this.post(
      `/support-automation/revisions/${revisionJobId}/lease/renew`,
      body,
    );
  }

  getSupportAutomationRevisionContext(
    input: SupportAutomationRevisionLeaseIdentity,
  ): Promise<unknown> {
    const { revisionJobId, ...body } = input;
    return this.post(`/support-automation/revisions/${revisionJobId}/context`, body);
  }

  submitSupportAutomationRevision(
    input: SupportAutomationRevisionDecisionInput,
  ): Promise<unknown> {
    const { revisionJobId, ...body } = input;
    return this.post(`/support-automation/revisions/${revisionJobId}/decision`, body);
  }

  failSupportAutomationRevision(
    input: SupportAutomationRevisionLeaseIdentity & {
      failureCode: SupportAutomationRevisionFailureCode;
    },
  ): Promise<unknown> {
    const { revisionJobId, ...body } = input;
    return this.post(`/support-automation/revisions/${revisionJobId}/failure`, body);
  }

  private assertAllowedPath(path: string): void {
    let decodedPath = path.split(/[?#]/, 1)[0] ?? "";
    try {
      for (let depth = 0; depth < 4; depth += 1) {
        const next = decodeURIComponent(decodedPath);
        if (next === decodedPath) {
          break;
        }
        decodedPath = next;
      }
    } catch {
      throw this.outsideNamespace(path);
    }

    const segments = decodedPath.split("/");
    if (
      !(decodedPath === "/support-automation" || decodedPath.startsWith("/support-automation/"))
      || segments.some((segment) => segment === "." || segment === "..")
      || /%[a-f0-9]{2}/i.test(decodedPath)
      || decodedPath.includes("\\")
      || decodedPath.includes("\0")
    ) {
      throw this.outsideNamespace(path);
    }
  }

  private outsideNamespace(path: string): BackendError {
    return new BackendError(
      "Support autopilot endpoint is outside the allowed namespace",
      0,
      path,
    );
  }
}
