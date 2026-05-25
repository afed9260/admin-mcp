export type AdminMcpConfig = {
  adminApiBaseUrl: string;
  adminApiToken: string;
  auditLogPath: string;
};

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): AdminMcpConfig {
  const adminApiBaseUrl = env.ADMIN_API_BASE_URL?.replace(/\/$/, "");
  const adminApiToken = env.ADMIN_API_TOKEN;
  const auditLogPath = env.AUDIT_LOG_PATH ?? "./audit/admin-mcp.jsonl";

  if (!adminApiBaseUrl) {
    throw new Error("ADMIN_API_BASE_URL is required");
  }

  if (!adminApiToken) {
    throw new Error("ADMIN_API_TOKEN is required");
  }

  return { adminApiBaseUrl, adminApiToken, auditLogPath };
}
