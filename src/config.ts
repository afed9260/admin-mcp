export type AdminMcpProfile = "admin" | "readonly" | "support_autopilot";

export type AdminMcpConfig = {
  adminApiBaseUrl: string;
  adminApiToken: string;
  auditLogPath: string;
  enableWriteTools: boolean;
  profile: AdminMcpProfile;
};

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): AdminMcpConfig {
  const rawAdminApiBaseUrl = env.ADMIN_API_BASE_URL?.trim();
  const auditLogPath = env.AUDIT_LOG_PATH ?? "./audit/admin-mcp.jsonl";
  const enableWriteTools = env.ADMIN_MCP_ENABLE_WRITE === "true";
  const profile = parseProfile(env.ADMIN_MCP_PROFILE);
  const adminApiToken = profile === "support_autopilot"
    ? env.SUPPORT_AUTOPILOT_SERVICE_TOKEN
    : env.ADMIN_API_TOKEN ?? env.ADMIN_MCP_TOKEN;

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

  if (!adminApiToken?.trim()) {
    throw new Error(profile === "support_autopilot"
      ? "SUPPORT_AUTOPILOT_SERVICE_TOKEN is required"
      : "ADMIN_API_TOKEN is required");
  }

  if (profile !== "admin" && enableWriteTools) {
    throw new Error("ADMIN_MCP_ENABLE_WRITE is allowed only for the admin profile");
  }

  const adminApiBaseUrl = parsedAdminApiBaseUrl.href.replace(/\/$/, "");

  return { adminApiBaseUrl, adminApiToken, auditLogPath, enableWriteTools, profile };
}

function parseProfile(value: string | undefined): AdminMcpProfile {
  const profile = value?.trim() || "admin";
  if (profile === "admin" || profile === "readonly" || profile === "support_autopilot") {
    return profile;
  }
  throw new Error("ADMIN_MCP_PROFILE must be admin, readonly, or support_autopilot");
}
