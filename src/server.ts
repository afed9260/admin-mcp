import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdminApiClient } from "./backend/admin-api-client.js";
import { SupportAutopilotApiClient } from "./backend/support-autopilot-api-client.js";
import { AdminMcpConfig } from "./config.js";
import { registerAdminTools, registerReadOnlyTools } from "./tools/register-tools.js";
import {
  registerSupportAutopilotTools,
  type SupportAutopilotToolScope,
} from "./tools/support-autopilot-tools.js";

export function createAdminMcpServer(
  config: AdminMcpConfig,
  supportAutopilotToolScope?: SupportAutopilotToolScope,
): McpServer {
  const server = new McpServer({ name: "admin-mcp", version: "0.1.0" });

  if (config.profile === "support_autopilot") {
    registerSupportAutopilotTools(
      server,
      new SupportAutopilotApiClient({
        baseUrl: config.adminApiBaseUrl,
        token: config.adminApiToken,
      }),
      supportAutopilotToolScope,
    );
    return server;
  }

  const client = new AdminApiClient({ baseUrl: config.adminApiBaseUrl, token: config.adminApiToken });
  if (config.profile === "readonly") {
    registerReadOnlyTools(server, client, config);
    return server;
  }

  registerAdminTools(server, client, config);
  return server;
}
