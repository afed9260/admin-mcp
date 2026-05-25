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

  it("redacts nested secret keys in objects and arrays", async () => {
    dir = await mkdtemp(join(tmpdir(), "admin-mcp-"));
    const file = join(dir, "audit.jsonl");

    await appendAuditEvent(file, {
      timestamp: "2026-05-25T00:00:00.000Z",
      toolName: "update_dialog",
      input: {
        nested: {
          authorization: "Bearer nested-token",
          auth: "auth-secret",
          apiKey: "api-key-secret",
          api_key: "api-key-secret",
          accessKey: "access-key-secret",
          access_key: "access-key-secret",
          jwt: "jwt-secret",
          session: "session-secret",
          sessionId: "session-id-secret",
          session_id: "session-id-secret",
          children: [{ password: "password-secret" }, { cookie: "cookie-secret" }],
        },
      },
      endpoint: "/statistics/dialogs",
      status: "success",
    });

    const content = await readFile(file, "utf8");
    expect(content).toContain("\"authorization\":\"[REDACTED]\"");
    expect(content).toContain("\"session_id\":\"[REDACTED]\"");
    expect(content).toContain("\"auth\":\"[REDACTED]\"");
    expect(content).toContain("\"apiKey\":\"[REDACTED]\"");
    expect(content).toContain("\"api_key\":\"[REDACTED]\"");
    expect(content).toContain("\"accessKey\":\"[REDACTED]\"");
    expect(content).toContain("\"access_key\":\"[REDACTED]\"");
    expect(content).toContain("\"jwt\":\"[REDACTED]\"");
    expect(content).toContain("\"sessionId\":\"[REDACTED]\"");
    expect(content).not.toContain("nested-token");
    expect(content).not.toContain("session-id-secret");
    expect(content).not.toContain("cookie-secret");
  });

  it("redacts secret-bearing string patterns", async () => {
    dir = await mkdtemp(join(tmpdir(), "admin-mcp-"));
    const file = join(dir, "audit.jsonl");

    await appendAuditEvent(file, {
      timestamp: "2026-05-25T00:00:00.000Z",
      toolName: "list_dialogs",
      input: {
        authorizationHeader: "Authorization: Bearer abc",
        bearerToken: "Bearer abc123",
        passwordPair: "password=abc",
        secretPair: "secret=def",
        authorizationPair: "authorization=ghi",
        secretHeader: "secret: xyz",
        apiKeyHeader: "apiKey: key",
        cookieHeader: "Cookie: sid=abc; sessionId=def",
        urls: [
          "https://malikbot.ru/new-admin?token=abc",
          "https://malikbot.ru/new-admin?api_key=abc",
          "https://malikbot.ru/new-admin?access_token=abc",
          "https://malikbot.ru/new-admin?jwt=abc",
          "https://malikbot.ru/new-admin?sessionId=abc",
        ],
      },
      endpoint: "/statistics/dialogs",
      status: "failure",
      metadata: { reason: "Authorization: Bearer abc" },
    });

    const content = await readFile(file, "utf8");
    expect(content).not.toContain("Bearer abc");
    expect(content).not.toContain("abc123");
    expect(content).not.toContain("password=abc");
    expect(content).not.toContain("secret=def");
    expect(content).not.toContain("authorization=ghi");
    expect(content).not.toContain("secret: xyz");
    expect(content).not.toContain("apiKey: key");
    expect(content).not.toContain("sid=abc");
    expect(content).not.toContain("sessionId=def");
    expect(content).not.toContain("token=abc");
    expect(content).not.toContain("api_key=abc");
    expect(content).not.toContain("access_token=abc");
    expect(content).not.toContain("jwt=abc");
    expect(content).not.toContain("sessionId=abc");
  });

  it("keeps non-secret author and authentication metadata visible", async () => {
    dir = await mkdtemp(join(tmpdir(), "admin-mcp-"));
    const file = join(dir, "audit.jsonl");

    await appendAuditEvent(file, {
      timestamp: "2026-05-25T00:00:00.000Z",
      toolName: "list_dialogs",
      input: {
        authorName: "Ada",
        authoredBy: "Grace",
        authenticated: true,
        auth: "secret",
      },
      endpoint: "/statistics/dialogs",
      status: "success",
    });

    const content = await readFile(file, "utf8");
    expect(content).toContain("\"authorName\":\"Ada\"");
    expect(content).toContain("\"authoredBy\":\"Grace\"");
    expect(content).toContain("\"authenticated\":true");
    expect(content).toContain("\"auth\":\"[REDACTED]\"");
  });
});
