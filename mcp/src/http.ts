import express, { Request, Response } from "express";
import { createServer } from "./server";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { OrgAIClient } from "./api-client";

import cors from 'cors';

const app = express();

const allowedOrigins = process.env.COMPLY_CORS_ORIGINS
  ? process.env.COMPLY_CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true
}));

app.use(express.json());

type SseEntry = { transport: SSEServerTransport; lastSeen: number };
const transports: Record<string, SseEntry> = {};

// Session hygiene: killed agents never close cleanly, so sweep idle sessions
// and cap the map so it can't grow unbounded.
const SESSION_IDLE_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 500;

function sweepIdle() {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, e] of Object.entries(transports)) {
    if (e.lastSeen < cutoff) {
      try { e.transport.close?.(); } catch { /* already gone */ }
      delete transports[id];
    }
  }
}

function evictOldestIfFull() {
  const ids = Object.keys(transports);
  if (ids.length < MAX_SESSIONS) return;
  let oldest: string | null = null;
  for (const id of ids) {
    if (!oldest || transports[id].lastSeen < transports[oldest].lastSeen) oldest = id;
  }
  if (oldest) {
    try { transports[oldest].transport.close?.(); } catch { /* already gone */ }
    delete transports[oldest];
  }
}

const sweepInterval = setInterval(sweepIdle, 5 * 60 * 1000);
sweepInterval.unref?.();

let lazyOrgCache: any = null;
let lazyOrgError: string | null = null;
let lazyOrgAt = 0;
const LAZY_TTL_MS = 60_000; // retry after a transient failure / refresh cache

app.get("/health", async (req, res) => {
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

app.get("/sse", async (req: Request, res: Response) => {
  sweepIdle();
  evictOldestIfFull();
  const server = createServer();
  const transport = new SSEServerTransport("/messages", res as any);

  transports[transport.sessionId] = { transport, lastSeen: Date.now() };

  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const entry = transports[sessionId];

  if (entry) {
    entry.lastSeen = Date.now();
    // Pass the parsed body: express.json() already drained the stream, so the
    // SDK's getRawBody() would 400 on an empty stream without it.
    await entry.transport.handlePostMessage(req as any, res as any, req.body);
  } else {
    res.status(404).send("Session not found");
  }
});

const PORT = process.env.PORT || 3000;
const httpServer = app.listen(PORT, () => {
  console.log(`Comply MCP server listening on port ${PORT}`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => {
    process.exit(0);
  });
});
