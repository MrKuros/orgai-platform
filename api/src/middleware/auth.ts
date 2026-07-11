import { AppError } from "../lib/AppError";
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
      throw new AppError(401, 'ERROR', 'Unauthorized: Missing token');
    }

    const payload = verifyToken(token);
    
    // Trust the JWT payload to avoid a DB query on every request
    req.user = { id: payload.userId, email: payload.email } as any;
    next();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized: Invalid token');
  }
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    const key = req.headers['x-api-key'] as string;
    if (!key) {
      throw new AppError(401, 'ERROR', 'Unauthorized: Missing API key');
    }

    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    
    const apiKeyRecord = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { org: true }
    });

    if (!apiKeyRecord) {
      throw new AppError(401, 'ERROR', 'Unauthorized: Invalid API key');
    }

    if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
      throw new AppError(401, 'ERROR', 'Unauthorized: API key expired');
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
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'UNAUTHORIZED', 'Unauthorized: API key error');
  }
}

export function requireOrgRole(...roles: MembershipRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.apiKeyRecord) {
        return next();
      }

      if (!req.user) {
        throw new AppError(401, 'ERROR', 'Unauthorized: User context missing');
      }

      const orgId = req.params.orgId;
      if (!orgId) {
        throw new AppError(400, 'ERROR', 'Bad Request: Missing orgId');
      }

      const membership = await prisma.membership.findUnique({
        where: { orgId_userId: { orgId, userId: req.user.id } },
        include: { org: true }
      });

      if (!membership) {
        throw new AppError(403, 'ERROR', 'Forbidden: Not a member of this organization');
      }

      if (roles.length > 0 && !roles.includes(membership.role)) {
        throw new AppError(403, 'ERROR', 'Forbidden: Insufficient role');
      }

      req.membership = membership;
      req.org = membership.org;
      next();
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, 'INTERNAL_ERROR', 'Internal server error checking role');
    }
  };
}
