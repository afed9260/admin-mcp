import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { sanitizeForLog } from "../util/sanitize.js";

export type AuditEvent = {
  timestamp: string;
  toolName: string;
  input: unknown;
  endpoint: string;
  status: "success" | "failure";
  metadata?: Record<string, unknown>;
};

export async function appendAuditEvent(filePath: string, event: AuditEvent): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const sanitized = sanitizeForLog(event);
  await appendFile(filePath, `${JSON.stringify(sanitized)}\n`, "utf8");
}
