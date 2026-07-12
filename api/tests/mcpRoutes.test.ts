import 'express-async-errors';
import express from 'express';
import request from 'supertest';
import { mountMcpRoutes } from '../src/mcp/routes';
import { errorHandler } from '../src/middleware/errorHandler';

// In-process verification of the MCP route fixes. Standalone mode (no
// COMPLY_API_KEY) keeps the auth gate open so we can drive the transports.
function makeApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  mountMcpRoutes(app);
  app.use(errorHandler); // surfaces AppError(401) from the auth gate
  return app;
}

describe('MCP routes', () => {
  const prevKey = process.env.COMPLY_API_KEY;
  afterAll(() => {
    if (prevKey === undefined) delete process.env.COMPLY_API_KEY;
    else process.env.COMPLY_API_KEY = prevKey;
  });

  describe('standalone mode', () => {
    beforeAll(() => { delete process.env.COMPLY_API_KEY; });

    it('streamable POST /mcp initialize returns a real JSON-RPC result (body is passed through)', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
        });

      // The pre-fix bug drained the stream and produced a 400; with req.body
      // forwarded to handleRequest the SDK answers the initialize handshake.
      expect(res.status).toBe(200);
      expect(res.headers['mcp-session-id']).toBeTruthy();
      // Response is an SSE frame containing the JSON-RPC result.
      expect(res.text).toContain('"result"');
      expect(res.text).toContain('serverInfo');
    });

    it('POST /mcp without an initialize request is rejected (fail closed, no silent session)', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
      expect(res.status).toBe(400);
    });

    it('SSE POST to an unknown session returns 404 (not a body-parse 400)', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/mcp/messages?sessionId=does-not-exist')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      expect(res.status).toBe(404);
    });
  });

  describe('API mode auth gate', () => {
    beforeAll(() => { process.env.COMPLY_API_KEY = 'server-key'; });
    afterAll(() => { delete process.env.COMPLY_API_KEY; });

    it('rejects unauthenticated callers on /mcp with 401', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated callers on /mcp/sse with 401', async () => {
      const app = makeApp();
      const res = await request(app).get('/mcp/sse');
      expect(res.status).toBe(401);
    });
  });
});
