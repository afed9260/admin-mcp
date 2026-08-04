import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AdminApiClient } from "./backend/admin-api-client.js";
import { SupportAutopilotApiClient } from "./backend/support-autopilot-api-client.js";
import { AdminMcpConfig } from "./config.js";
import { registerAdminTools, registerReadOnlyTools } from "./tools/register-tools.js";

export function createAdminMcpServer(config: AdminMcpConfig): McpServer {
  const server = new McpServer({ name: "admin-mcp", version: "0.1.0" });

  if (config.profile === "support_autopilot") {
    registerSupportAutopilotFoundationTools(
      server,
      new SupportAutopilotApiClient({
        baseUrl: config.adminApiBaseUrl,
        token: config.adminApiToken,
      }),
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

function registerSupportAutopilotFoundationTools(
  server: McpServer,
  client: SupportAutopilotApiClient,
): void {
  // Unit 4 will register only lease-scoped tools through this restricted client.
  void client;
  server.server.registerCapabilities({ tools: {} });
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
}
