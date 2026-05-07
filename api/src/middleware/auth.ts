import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { MembershipRole } from '@prisma/client';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    let token = req.cookies.orgai_session;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    const payload = verifyToken(token);
    
    // Trust the JWT payload to avoid a DB query on every request
    req.user = { id: payload.userId, email: payload.email } as any;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    const key = req.headers['x-api-key'] as string;
    if (!key) {
      return res.status(401).json({ error: 'Unauthorized: Missing API key' });
    }

    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    
    const apiKeyRecord = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { org: true }
    });

    if (!apiKeyRecord) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    }

    if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Unauthorized: API key expired' });
    }

    // Fire and forget updating lastUsedAt
    prisma.apiKey.update({
      where: { id: apiKeyRecord.id },
      data: { lastUsedAt: new Date() }
    }).catch(() => {}); // ignore errors

    req.org = apiKeyRecord.org;
    req.apiKeyRecord = apiKeyRecord;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: API key error' });
  }
}

export function requireOrgRole(...roles: MembershipRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.apiKeyRecord) {
        return next();
      }

      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized: User context missing' });
      }

      const orgId = req.params.orgId;
      if (!orgId) {
        return res.status(400).json({ error: 'Bad Request: Missing orgId' });
      }

      const membership = await prisma.membership.findUnique({
        where: { orgId_userId: { orgId, userId: req.user.id } },
        include: { org: true }
      });

      if (!membership) {
        return res.status(403).json({ error: 'Forbidden: Not a member of this organization' });
      }

      if (roles.length > 0 && !roles.includes(membership.role)) {
        return res.status(403).json({ error: 'Forbidden: Insufficient role' });
      }

      req.membership = membership;
      req.org = membership.org;
      next();
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error checking role' });
    }
  };
}
