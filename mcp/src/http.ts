import express, { Request, Response } from "express";
import { createServer } from "./server";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { OrgAIClient } from "./api-client";

const app = express();
app.use(express.json());

const transports: Record<string, SSEServerTransport> = {};

let lazyOrgCache: any = null;
let lazyOrgError: string | null = null;

app.get("/health", async (req, res) => {
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

app.get("/sse", async (req: Request, res: Response) => {
  const server = createServer();
  const transport = new SSEServerTransport("/messages", res as any);
  
  transports[transport.sessionId] = transport;
  
  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];

  if (transport) {
    await transport.handlePostMessage(req as any, res as any);
  } else {
    res.status(404).send("Session not found");
  }
});

const PORT = process.env.PORT || 3001;
const httpServer = app.listen(PORT, () => {
  console.log(`Comply MCP server listening on port ${PORT}`);
});

process.on("SIGTERM", () => {
  httpServer.close(() => {
    process.exit(0);
  });
});
