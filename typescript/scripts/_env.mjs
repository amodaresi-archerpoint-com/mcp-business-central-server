// Shared helpers for the dev scripts in this folder.
//
// The server itself has no dotenv dependency — in normal use the MCP client
// supplies environment variables via its `env` block. These scripts run the
// server directly, so they read .env themselves.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const tsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Read a dotenv-style file into a plain object. Values are passed through
 * verbatim — BC_COMPANY may legitimately be percent-encoded, and the server
 * handles that itself.
 */
export function loadEnvFile(file = ".env") {
  const full = path.join(tsRoot, file);
  if (!existsSync(full)) {
    throw new Error(
      `${file} not found in ${tsRoot}. Copy .env.detailed.example to .env and fill it in.`,
    );
  }
  const env = {};
  for (const line of readFileSync(full, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z_0-9]*)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

/**
 * Launch the built server over stdio and return a connected MCP client.
 * Requires `npm run build` first.
 */
export async function connect({ envFile = ".env", name = "dev-script" } = {}) {
  const entry = path.join(tsRoot, "dist", "index.js");
  if (!existsSync(entry)) {
    throw new Error(`${entry} not found. Run \`npm run build\` first.`);
  }
  const client = new Client({ name, version: "0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { ...process.env, ...loadEnvFile(envFile) },
    cwd: tsRoot,
    stderr: "pipe",
  });
  await client.connect(transport);
  transport.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));
  return client;
}

/** Call a tool and flatten the text content. */
export async function callTool(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return {
    isError: res.isError === true,
    text: (res.content ?? []).map((c) => c.text ?? "").join("\n"),
  };
}

/** Parse a tool's JSON text result, tolerating the {result:…} envelope. */
export function parseResult(text) {
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === "object" && "result" in parsed
    ? parsed.result
    : parsed;
}
