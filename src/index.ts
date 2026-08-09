import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createAdminMcpServer } from "./server.js";
import { parseSupportAutopilotToolScope } from "./tools/support-autopilot-tools.js";

const config = loadConfig();
const server = createAdminMcpServer(
  config,
  config.profile === "support_autopilot"
    ? parseSupportAutopilotToolScope(process.env.SUPPORT_AUTOPILOT_WORK_KIND)
    : undefined,
);
const transport = new StdioServerTransport();

await server.connect(transport);
