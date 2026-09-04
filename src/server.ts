import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createAuthProvider } from "./bc/auth/types.js";
import { BCClient } from "./bc/client.js";
import { MetadataCache } from "./bc/metadata.js";
import type { Config } from "./config.js";
import { registerTools } from "./tools/index.js";

const SERVER_NAME = "bc-mcp-server";
const SERVER_VERSION = "0.1.0";

export function createServer(config: Config): McpServer {
  const auth = createAuthProvider(config);
  const client = new BCClient(config, auth);
  const metadata = new MetadataCache(client, config);

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
      instructions: buildInstructions(config),
    },
  );

  registerTools(server, { client, metadata, config });
  return server;
}

function buildInstructions(config: Config): string {
  const lines = [
    `MCP server for Microsoft Dynamics 365 Business Central.`,
    `Auth: ${config.authType}.`,
    `Base URL: ${config.baseUrl}`,
    config.defaultCompany
      ? `Default company: ${config.defaultCompany} (override per-call with the \`company\` argument).`
      : `No default company set — call bc_list_companies first, then pass \`company\` to other tools.`,
    config.readOnly
      ? `READ-ONLY MODE: write tools (create/update/delete/invoke) are disabled.`
      : config.requireWriteConfirmation
        ? `Writes require \`confirm: true\` on the tool call.`
        : `Writes do NOT require confirmation — be careful.`,
    `Standard discovery flow: bc_list_companies → bc_list_entity_sets → bc_get_entity_schema → bc_list_entities.`,
  ];
  return lines.join("\n");
}
