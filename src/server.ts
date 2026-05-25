import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdminApiClient } from "./backend/admin-api-client.js";
import { AdminMcpConfig } from "./config.js";
import { registerReadOnlyTools } from "./tools/register-tools.js";

export function createAdminMcpServer(config: AdminMcpConfig): McpServer {
  const server = new McpServer({ name: "admin-mcp", version: "0.1.0" });
  const client = new AdminApiClient({ baseUrl: config.adminApiBaseUrl, token: config.adminApiToken });
  registerReadOnlyTools(server, client, config);
  return server;
}
