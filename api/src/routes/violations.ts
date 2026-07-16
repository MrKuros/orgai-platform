import { Router, Request, Response } from 'express';
import { requireApiKey } from '../middleware/auth';
import { verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';

export const violationsFeedRouter = Router();

const orgConnections = new Map<string, Set<Response>>();

export function broadcastViolation(orgId: string, violation: any) {
  const connections = orgConnections.get(orgId);
  if (connections) {
    const message = `data: ${JSON.stringify(violation)}\n\n`;
    connections.forEach(res => {
      res.write(message);
    });
  }
}

violationsFeedRouter.get('/:orgId/violations/stream', async (req: Request, res: Response) => {
  const token = req.query.token as string || req.cookies?.orgai_session;
  if (!token) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing authentication');
  }
  let payload: any;
  try {
    payload = verifyToken(token);
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid token');
  }
  const membership = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId: req.params.orgId, userId: payload.userId } }
  });
  if (!membership || !membership.active) throw new AppError(403, 'FORBIDDEN', 'Not a member');

  const orgId = req.params.orgId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!orgConnections.has(orgId)) {
    orgConnections.set(orgId, new Set());
  }
  orgConnections.get(orgId)!.add(res);

  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    const connections = orgConnections.get(orgId);
    if (connections) {
      connections.delete(res);
      if (connections.size === 0) {
        orgConnections.delete(orgId);
      }
    }
  });
});
