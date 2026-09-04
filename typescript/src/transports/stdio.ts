import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function runStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio runs until the parent closes stdin. Log to stderr so we don't
  // pollute the JSON-RPC stream on stdout.
  process.stderr.write("bc-mcp-server: connected over stdio\n");
}
