import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "../config.js";
import { createServer } from "../server.js";

interface HttpOptions {
  port: number;
  host?: string;
}

/**
 * Streamable HTTP server.
 *
 * Each MCP session gets its own McpServer instance + transport, keyed by
 * the Mcp-Session-Id header. The same BC config is reused across sessions
 * (auth providers cache tokens, metadata cache lives per-server-instance).
 *
 * For multi-tenant deployments, you'd extract per-request config from
 * Authorization headers or query params and pass it into createServer().
 * That's left as a deliberate extension point — out of scope for v1.
 */
export async function runHttp(
  config: Config,
  options: HttpOptions,
): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  const sessions = new Map<
    string,
    { server: McpServer; transport: StreamableHTTPServerTransport }
  >();

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    if (!entry) {
      // Only an initialize request may create a new session.
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "No active MCP session. Send an `initialize` request first.",
          },
          id: null,
        });
        return;
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { server, transport });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      const server = createServer(config);
      await server.connect(transport);
      entry = { server, transport };
    }

    await entry.transport.handleRequest(req, res, req.body);
  });

  // GET (server-initiated SSE) and DELETE (session termination) share a handler.
  const handleSessionRequest = async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).send("Missing or unknown Mcp-Session-Id");
      return;
    }
    const entry = sessions.get(sessionId)!;
    await entry.transport.handleRequest(req, res);
  };
  app.get("/mcp", handleSessionRequest);
  app.delete("/mcp", handleSessionRequest);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", sessions: sessions.size });
  });

  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve) => {
    app.listen(options.port, host, () => {
      process.stderr.write(
        `bc-mcp-server: listening on http://${host}:${options.port}/mcp\n`,
      );
      resolve();
    });
  });
}
