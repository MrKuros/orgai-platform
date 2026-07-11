import { Application, Request, Response } from "express";
import { randomUUID } from "crypto";
import { createServer } from "./server";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { OrgAIClient } from "./api-client";

const transports: Record<string, SSEServerTransport> = {};
const httpTransports: Record<string, StreamableHTTPServerTransport> = {};

let lazyOrgCache: any = null;
let lazyOrgError: string | null = null;

export function mountMcpRoutes(app: Application): void {
  app.get('/mcp/health', async (req: Request, res: Response) => {
    const isApiMode = !!process.env.COMPLY_API_KEY;
    if (!isApiMode) {
      return res.json({ status: "ok", version: "0.3.0", mode: "standalone", orgName: null });
    }

    if (!lazyOrgCache && !lazyOrgError) {
      try {
        const client = new OrgAIClient();
        lazyOrgCache = await client.getOrgFromApiKey();
      } catch (e: any) {
        lazyOrgError = e.message;
      }
    }

    if (lazyOrgError) {
      return res.json({ status: "ok", version: "0.3.0", mode: "api", orgName: null, error: "Could not reach OrgAI API: " + lazyOrgError });
    }

    res.json({ status: "ok", version: "0.3.0", mode: "api", orgName: lazyOrgCache?.orgName || null });
  });

  app.get('/mcp/sse', async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new SSEServerTransport('/mcp/messages', res as any);

    transports[transport.sessionId] = transport;

    res.on("close", () => {
      delete transports[transport.sessionId];
    });

    await server.connect(transport);
  });

  app.post('/mcp/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports[sessionId];

    if (transport) {
      await transport.handlePostMessage(req as any, res as any);
    } else {
      res.status(404).send("Session not found");
    }
  });

  // Streamable HTTP transport (current MCP spec; SSE above is kept for older
  // clients). Cursor, Codex and newer clients connect here at /mcp.
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport = sessionId ? httpTransports[sessionId] : undefined;

    if (!transport) {
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: no valid session. Send an initialize request first.' },
          id: null
        });
        return;
      }
      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => { httpTransports[id] = newTransport; }
      });
      newTransport.onclose = () => {
        if (newTransport.sessionId) delete httpTransports[newTransport.sessionId];
      };
      await createServer().connect(newTransport);
      transport = newTransport;
    }

    await transport.handleRequest(req as any, res as any, req.body);
  });

  const handleHttpSession = async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? httpTransports[sessionId] : undefined;
    if (!transport) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transport.handleRequest(req as any, res as any);
  };
  app.get('/mcp', handleHttpSession);     // server-to-client notifications stream
  app.delete('/mcp', handleHttpSession);  // session termination
}