import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendAuditEvent } from "../src/audit/audit-log.js";

let dir: string | undefined;

afterEach(async () => {
  if (dir) {
    await rm(dir, { force: true, recursive: true });
    dir = undefined;
  }
});

describe("appendAuditEvent", () => {
  it("writes sanitized JSONL records", async () => {
    dir = await mkdtemp(join(tmpdir(), "admin-mcp-"));
    const file = join(dir, "audit.jsonl");

    await appendAuditEvent(file, {
      timestamp: "2026-05-25T00:00:00.000Z",
      toolName: "list_dialogs",
      input: { search: "abc", ADMIN_API_TOKEN: "secret" },
      endpoint: "/statistics/dialogs",
      status: "success",
      metadata: { itemCount: 1 },
    });

    const content = await readFile(file, "utf8");
    expect(content).toContain("\"toolName\":\"list_dialogs\"");
    expect(content).toContain("\"ADMIN_API_TOKEN\":\"[REDACTED]\"");
  });
});
