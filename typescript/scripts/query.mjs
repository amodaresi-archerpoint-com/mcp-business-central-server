#!/usr/bin/env node
// Call any tool on the server against the live BC environment in .env.
//
//   npm run query -- bc_list_entity_sets
//   npm run query -- bc_list_entities '{"entitySet":"ItemList","top":5}'
//   npm run query -- bc_get_entity_schema '{"entitySet":"ItemList"}'
//   npm run query -- bc_list_entities '{"entitySet":"CSMAutomation","top":50}'
//
// Reads .env from the package root (override with BC_ENV_FILE).
import { callTool, connect } from "./_env.mjs";

const [toolName, jsonArgs = "{}"] = process.argv.slice(2);

if (!toolName || toolName === "--help" || toolName === "-h") {
  console.log(
    `Usage: node scripts/query.mjs <toolName> '<jsonArgs>'\n\n` +
      `Examples:\n` +
      `  node scripts/query.mjs bc_list_companies\n` +
      `  node scripts/query.mjs bc_list_entity_sets\n` +
      `  node scripts/query.mjs bc_list_entities '{"entitySet":"ItemList","top":5}'\n\n` +
      `Pass --tools to list the available tool names.`,
  );
  process.exit(toolName ? 0 : 1);
}

let args;
try {
  args = JSON.parse(jsonArgs);
} catch (err) {
  console.error(`Second argument must be valid JSON: ${err.message}`);
  console.error(`Received: ${jsonArgs}`);
  console.error(`Tip: on PowerShell, wrap the JSON in single quotes.`);
  process.exit(1);
}

let client;
try {
  client = await connect({
    envFile: process.env["BC_ENV_FILE"] ?? ".env",
    name: "query",
  });

  if (toolName === "--tools") {
    const { tools } = await client.listTools();
    for (const t of tools) console.log(`${t.name}\t${t.title ?? ""}`);
  } else {
    const { isError, text } = await callTool(client, toolName, args);
    if (isError) {
      console.error(`TOOL ERROR (${toolName}):\n${text}`);
      process.exitCode = 1;
    } else {
      console.log(text);
    }
  }
} catch (err) {
  console.error(`FATAL: ${err?.message ?? err}`);
  process.exitCode = 1;
} finally {
  await client?.close().catch(() => {});
}
