import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import {
  parseSupportAutopilotToolScope,
  registerSupportAutopilotTools,
  type SupportAutopilotToolScope,
} from "../tools/support-autopilot-tools.js";
import { SyntheticSupportAutopilotApi } from "./synthetic-support-autopilot-api.js";

export function createSyntheticSupportAutopilotMcpServer(
  scope?: SupportAutopilotToolScope,
): McpServer {
  const server = new McpServer({
    name: "support-autopilot-synthetic",
    version: "0.1.0",
  });
  registerSupportAutopilotTools(server, new SyntheticSupportAutopilotApi(), scope);
  return server;
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  const server = createSyntheticSupportAutopilotMcpServer(
    parseSupportAutopilotToolScope(process.env.SUPPORT_AUTOPILOT_WORK_KIND),
  );
  await server.connect(new StdioServerTransport());
}
