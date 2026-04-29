import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';

export const apiKeysRouter = Router();

apiKeysRouter.get('/:orgId/api-keys', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const keys = await prisma.apiKey.findMany({
    where: { orgId: req.org!.id },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true
    }
  });
  res.json({ apiKeys: keys });
});

const createKeySchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().optional()
});

apiKeysRouter.post('/:orgId/api-keys', requireAuth, requireOrgRole('ORG_ADMIN'), validate(createKeySchema), async (req, res) => {
  const { name, scopes, expiresAt } = req.body;

  const rawKey = `oai_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 12);

  const apiKey = await prisma.apiKey.create({
    data: {
      orgId: req.org!.id,
      createdById: req.user!.id,
      name,
      keyHash,
      keyPrefix,
      scopes,
      expiresAt: expiresAt ? new Date(expiresAt) : null
    }
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'apikey.created',
    resource: apiKey.id,
    metadata: { name }
  });

  res.status(201).json({
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt
    },
    key: rawKey
  });
});

apiKeysRouter.delete('/:orgId/api-keys/:keyId', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const { keyId } = req.params;

  await prisma.apiKey.delete({
    where: { id: keyId, orgId: req.org!.id }
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'apikey.revoked',
    resource: keyId
  });

  res.status(204).send();
});
