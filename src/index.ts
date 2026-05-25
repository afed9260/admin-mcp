import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createAdminMcpServer } from "./server.js";

const config = loadConfig();
const server = createAdminMcpServer(config);
const transport = new StdioServerTransport();

await server.connect(transport);
