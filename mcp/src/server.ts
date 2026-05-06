import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools";

export function createServer() {
  const server = new McpServer({
    name: "orgai-comply",
    version: "0.3.0"
  });

  registerTools(server);

  return server;
}
