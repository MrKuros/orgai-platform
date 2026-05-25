import { Application, Request, Response } from "express";
import { createServer } from "./server";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { OrgAIClient } from "./api-client";

const transports: Record<string, SSEServerTransport> = {};

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
}