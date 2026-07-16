import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import { assertWithinLimit, limitsFor } from '../lib/plans';
import { AppError } from '../lib/AppError';

export const apiKeysRouter = Router();

/**
 * @swagger
 * /v1/orgs/{orgId}/api-keys:
 *   get:
 *     summary: List API keys
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of API keys
 */
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
      createdAt: true,
      memberId: true,
      member: { select: { user: { select: { email: true, firstName: true, lastName: true } } } }
    }
  });
  res.json({ apiKeys: keys });
});

const createKeySchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().optional(),
  // Bind the key to a developer: checks run as their assigned roles and the
  // audit trail names them. Omit for an org-wide (CI / service) key.
  memberId: z.string().min(1).optional()
});

/**
 * @swagger
 * /v1/orgs/{orgId}/api-keys:
 *   post:
 *     summary: Create a new API key
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               scopes:
 *                 type: array
 *                 items:
 *                   type: string
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *               memberId:
 *                 type: string
 *                 format: uuid
 *                 description: Bind the key to a member — checks run as their assigned roles and audit entries name them. Omit for an org-wide (CI/service) key, which must then send roleName on /check. 400 for members of another org or deactivated members.
 *     responses:
 *       201:
 *         description: API key created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 apiKey:
 *                   type: object
 *                 key:
 *                   type: string
 *                   description: The raw API key (only shown once)
 */
apiKeysRouter.post('/:orgId/api-keys', requireAuth, requireOrgRole('ORG_ADMIN'), validate(createKeySchema), async (req, res) => {
  const { name, scopes, expiresAt, memberId } = req.body;

  if (memberId) {
    const member = await prisma.membership.findFirst({
      where: { id: memberId, orgId: req.org!.id }
    });
    if (!member) {
      throw new AppError(400, 'ERROR', 'memberId does not belong to this organization');
    }
    if (!member.active) {
      throw new AppError(400, 'ERROR', 'Cannot issue a key for a deactivated member');
    }
  }

  const keyCount = await prisma.apiKey.count({ where: { orgId: req.org!.id } });
  assertWithinLimit(keyCount, limitsFor(req.org!.plan).apiKeys, 'API key', req.org!.plan);

  const rawKey = `oai_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 12);

  const apiKey = await prisma.apiKey.create({
    data: {
      orgId: req.org!.id,
      createdById: req.user!.id,
      memberId: memberId || null,
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
    metadata: { name, ...(memberId ? { memberId } : {}) }
  });

  res.status(201).json({
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      memberId: apiKey.memberId,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt
    },
    key: rawKey
  });
});

/**
 * @swagger
 * /v1/orgs/{orgId}/api-keys/{keyId}:
 *   delete:
 *     summary: Revoke an API key
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: keyId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: API key revoked
 */
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
