import { Application, Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { createServer } from "./server";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { OrgAIClient } from "./api-client";
import { requireApiKey } from "../middleware/auth";

type SseEntry = { transport: SSEServerTransport; server: ReturnType<typeof createServer>; lastSeen: number };
type HttpEntry = { transport: StreamableHTTPServerTransport; server: ReturnType<typeof createServer>; lastSeen: number };

const transports: Record<string, SseEntry> = {};
const httpTransports: Record<string, HttpEntry> = {};

// Session hygiene: killed agents never send DELETE/close, so without a sweep
// these maps grow forever (each entry pins an McpServer + transport).
const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 min
const MAX_SESSIONS = 500;

function sweepIdle(map: Record<string, { transport: any; lastSeen: number }>) {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, e] of Object.entries(map)) {
    if (e.lastSeen < cutoff) {
      try { e.transport.close?.(); } catch { /* already gone */ }
      delete map[id];
    }
  }
}

// Reject a new session (or evict the oldest) once the cap is hit. We evict the
// oldest so a burst of dead sessions can't lock out live clients.
function evictOldestIfFull(map: Record<string, { transport: any; lastSeen: number }>) {
  const ids = Object.keys(map);
  if (ids.length < MAX_SESSIONS) return;
  let oldest: string | null = null;
  for (const id of ids) {
    if (!oldest || map[id].lastSeen < map[oldest].lastSeen) oldest = id;
  }
  if (oldest) {
    try { map[oldest].transport.close?.(); } catch { /* already gone */ }
    delete map[oldest];
  }
}

// Auth gate for the MCP endpoints. In API mode the tools run on the SERVER's
// COMPLY_API_KEY, so an unauthenticated caller could drive audit_query /
// get_policy for the org. Require a valid org API key. In standalone mode
// there is no org data to protect and the server is meant to run on localhost,
// so it stays open.
function mcpAuth(req: Request, res: Response, next: NextFunction) {
  if (!process.env.COMPLY_API_KEY) return next(); // standalone: open on localhost
  return requireApiKey(req, res, next);
}

const sweepInterval = setInterval(() => {
  sweepIdle(transports);
  sweepIdle(httpTransports);
}, 5 * 60 * 1000);
sweepInterval.unref?.();

let lazyOrgCache: any = null;
let lazyOrgError: string | null = null;
let lazyOrgAt = 0;
const LAZY_TTL_MS = 60_000; // retry after a transient failure / refresh cache

export function mountMcpRoutes(app: Application): void {
  app.get('/mcp/health', async (req: Request, res: Response) => {
    const isApiMode = !!process.env.COMPLY_API_KEY;
    if (!isApiMode) {
      return res.json({ status: "ok", version: "0.3.0", mode: "standalone", orgName: null });
    }

    if (Date.now() - lazyOrgAt > LAZY_TTL_MS) {
      lazyOrgCache = null;
      lazyOrgError = null;
    }
    if (!lazyOrgCache && !lazyOrgError) {
      try {
        const client = new OrgAIClient();
        lazyOrgCache = await client.getOrgFromApiKey();
      } catch (e: any) {
        lazyOrgError = e.message;
      }
      lazyOrgAt = Date.now();
    }

    if (lazyOrgError) {
      return res.json({ status: "ok", version: "0.3.0", mode: "api", orgName: null, error: "Could not reach OrgAI API: " + lazyOrgError });
    }

    res.json({ status: "ok", version: "0.3.0", mode: "api", orgName: lazyOrgCache?.orgName || null });
  });

  app.get('/mcp/sse', mcpAuth, async (req: Request, res: Response) => {
    sweepIdle(transports);
    evictOldestIfFull(transports);
    const server = createServer();
    const transport = new SSEServerTransport('/mcp/messages', res as any);

    transports[transport.sessionId] = { transport, server, lastSeen: Date.now() };

    res.on("close", () => {
      delete transports[transport.sessionId];
    });

    await server.connect(transport);
  });

  app.post('/mcp/messages', mcpAuth, async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const entry = transports[sessionId];

    if (entry) {
      entry.lastSeen = Date.now();
      // Pass the already-parsed body: express.json() drained the stream, so
      // the SDK's getRawBody() would otherwise hang/400 on an empty stream.
      await entry.transport.handlePostMessage(req as any, res as any, req.body);
    } else {
      res.status(404).send("Session not found");
    }
  });

  // Streamable HTTP transport (current MCP spec; SSE above is kept for older
  // clients). Cursor, Codex and newer clients connect here at /mcp.
  app.post('/mcp', mcpAuth, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let entry = sessionId ? httpTransports[sessionId] : undefined;

    if (!entry) {
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: no valid session. Send an initialize request first.' },
          id: null
        });
        return;
      }
      sweepIdle(httpTransports);
      evictOldestIfFull(httpTransports);
      const server = createServer();
      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => { httpTransports[id] = { transport: newTransport, server, lastSeen: Date.now() }; }
      });
      newTransport.onclose = () => {
        if (newTransport.sessionId) delete httpTransports[newTransport.sessionId];
      };
      await server.connect(newTransport);
      entry = { transport: newTransport, server, lastSeen: Date.now() };
    }

    entry.lastSeen = Date.now();
    await entry.transport.handleRequest(req as any, res as any, req.body);
  });

  const handleHttpSession = async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const entry = sessionId ? httpTransports[sessionId] : undefined;
    if (!entry) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    entry.lastSeen = Date.now();
    await entry.transport.handleRequest(req as any, res as any);
  };
  app.get('/mcp', mcpAuth, handleHttpSession);     // server-to-client notifications stream
  app.delete('/mcp', mcpAuth, handleHttpSession);  // session termination
}