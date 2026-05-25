export type AdminMcpConfig = {
  adminApiBaseUrl: string;
  adminApiToken: string;
  auditLogPath: string;
};

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): AdminMcpConfig {
  const rawAdminApiBaseUrl = env.ADMIN_API_BASE_URL?.trim();
  const adminApiToken = env.ADMIN_API_TOKEN;
  const auditLogPath = env.AUDIT_LOG_PATH ?? "./audit/admin-mcp.jsonl";

  if (!rawAdminApiBaseUrl) {
    throw new Error("ADMIN_API_BASE_URL is required");
  }

  let parsedAdminApiBaseUrl: URL;
  try {
    parsedAdminApiBaseUrl = new URL(rawAdminApiBaseUrl);
  } catch {
    throw new Error("ADMIN_API_BASE_URL must be a valid URL");
  }

  if (parsedAdminApiBaseUrl.protocol !== "https:") {
    throw new Error("ADMIN_API_BASE_URL must use https");
  }

  if (parsedAdminApiBaseUrl.username || parsedAdminApiBaseUrl.password) {
    throw new Error("ADMIN_API_BASE_URL must not include credentials");
  }

  if (parsedAdminApiBaseUrl.search) {
    throw new Error("ADMIN_API_BASE_URL must not include query string");
  }

  if (parsedAdminApiBaseUrl.hash) {
    throw new Error("ADMIN_API_BASE_URL must not include hash");
  }

  if (!adminApiToken) {
    throw new Error("ADMIN_API_TOKEN is required");
  }

  const adminApiBaseUrl = parsedAdminApiBaseUrl.href.replace(/\/$/, "");

  return { adminApiBaseUrl, adminApiToken, auditLogPath };
}
