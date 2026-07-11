import crypto from 'crypto';
import { AuthTokenType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';

const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  PASSWORD_RESET: 60 * 60 * 1000, // 1 hour
  INVITE: 7 * 24 * 60 * 60 * 1000 // 7 days
};

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Creates a single-use token for the user and returns the raw value.
 * Only the SHA-256 hash is persisted.
 */
export async function createAuthToken(userId: string, type: AuthTokenType, orgId?: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex');

  await prisma.authToken.create({
    data: {
      userId,
      type,
      orgId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS[type])
    }
  });

  return raw;
}

/**
 * Validates and consumes a token (marks it used). Throws 400 on
 * invalid/expired/used tokens. Accepts either INVITE or PASSWORD_RESET —
 * both flows end with the user setting a password.
 */
export async function consumeAuthToken(raw: string) {
  const record = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true }
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError(400, 'INVALID_TOKEN', 'This link is invalid or has expired. Request a new one.');
  }

  await prisma.authToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() }
  });

  return record;
}
