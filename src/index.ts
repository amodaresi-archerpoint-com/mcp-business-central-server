#!/usr/bin/env node
import { loadConfigFromEnv } from "./config.js";
import { createServer } from "./server.js";
import { runHttp } from "./transports/http.js";
import { runStdio } from "./transports/stdio.js";

interface CliArgs {
  transport: "stdio" | "http";
  port: number;
  host: string | undefined;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    transport: "stdio",
    port: 3000,
    host: undefined,
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--transport=http" || arg === "--http") {
      args.transport = "http";
    } else if (arg === "--transport=stdio" || arg === "--stdio") {
      args.transport = "stdio";
    } else if (arg.startsWith("--port=")) {
      args.port = Number(arg.slice("--port=".length));
    } else if (arg.startsWith("--host=")) {
      args.host = arg.slice("--host=".length);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage(): void {
  process.stderr.write(
    `bc-mcp-server — MCP server for Microsoft Dynamics 365 Business Central

Usage: bc-mcp-server [options]

Options:
  --transport=stdio     Use stdio transport (default).
  --transport=http      Use Streamable HTTP transport.
  --port=N              HTTP port (default 3000).
  --host=ADDR           HTTP bind address (default 127.0.0.1).
  -h, --help            Show this help.

Environment:
  BC_BASE_URL           Required. Full BC API base URL up to /api/v2.0 (or custom).
  BC_COMPANY            Default company name or GUID.
  BC_AUTH_TYPE          oauth_client_credentials | basic
  BC_TENANT_ID, BC_CLIENT_ID, BC_CLIENT_SECRET   for OAuth.
  BC_USER, BC_PASS                               for basic auth.
  BC_READ_ONLY                  true to disable writes (default false).
  BC_REQUIRE_WRITE_CONFIRMATION  true to require confirm:true on writes (default true).
  BC_METADATA_CACHE_TTL_SEC      seconds, default 3600.
  BC_REQUEST_TIMEOUT_MS          default 30000.
  BC_REJECT_UNAUTHORIZED         set to false ONLY for on-prem with self-signed certs.
`,
  );
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv);
  let config;
  try {
    config = loadConfigFromEnv();
  } catch (err) {
    process.stderr.write(`Configuration error:\n${formatError(err)}\n\n`);
    printUsage();
    process.exit(1);
  }

  if (cli.transport === "http") {
    const opts: { port: number; host?: string } = { port: cli.port };
    if (cli.host !== undefined) opts.host = cli.host;
    await runHttp(config, opts);
  } else {
    const server = createServer(config);
    await runStdio(server);
  }
}

function formatError(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err) {
    const zodErr = err as { issues: Array<{ path: unknown[]; message: string }> };
    return zodErr.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
  }
  return err instanceof Error ? err.message : String(err);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${formatError(err)}\n`);
  process.exit(1);
});
