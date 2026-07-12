import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import { isBlockedWebhookHost } from '../services/webhook';
import { AppError } from '../lib/AppError';

export const webhooksRouter = Router();

/**
 * @swagger
 * /v1/orgs/{orgId}/webhooks:
 *   get:
 *     summary: List webhooks
 *     tags: [Webhooks]
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
 *         description: List of webhooks
 */
webhooksRouter.get('/:orgId/webhooks', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const webhooks = await prisma.webhook.findMany({
    where: { orgId: req.org!.id },
    select: {
      id: true,
      url: true,
      events: true,
      active: true,
      createdAt: true,
      updatedAt: true
    }
  });
  res.json({ webhooks });
});

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(['policy.violated', 'policy.created', 'policy.updated', 'member.invited', 'audit.flagged'])).min(1)
});

/**
 * @swagger
 * /v1/orgs/{orgId}/webhooks:
 *   post:
 *     summary: Create a webhook
 *     tags: [Webhooks]
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
 *             required: [url, events]
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [policy.violated, policy.updated, member.invited, audit.flagged]
 *     responses:
 *       201:
 *         description: Webhook created
 */
webhooksRouter.post('/:orgId/webhooks', requireAuth, requireOrgRole('ORG_ADMIN'), validate(createWebhookSchema), async (req, res) => {
  const { url, events } = req.body;

  if (isBlockedWebhookHost(url)) {
    throw new AppError(400, 'ERROR', 'Webhook URL points to a private, loopback, or link-local address, which is not allowed.');
  }

  const secret = `whsec_${crypto.randomBytes(32).toString('hex')}`;

  const webhook = await prisma.webhook.create({
    data: {
      orgId: req.org!.id,
      url,
      events,
      secret
    }
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'webhook.created',
    resource: webhook.id
  });

  res.status(201).json({ webhook });
});

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(['policy.violated', 'policy.created', 'policy.updated', 'member.invited', 'audit.flagged'])).min(1).optional(),
  active: z.boolean().optional()
});

/**
 * @swagger
 * /v1/orgs/{orgId}/webhooks/{webhookId}:
 *   patch:
 *     summary: Update a webhook
 *     tags: [Webhooks]
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
 *         name: webhookId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [policy.violated, policy.updated, member.invited, audit.flagged]
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Webhook updated
 */
webhooksRouter.patch('/:orgId/webhooks/:webhookId', requireAuth, requireOrgRole('ORG_ADMIN'), validate(updateWebhookSchema), async (req, res) => {
  const { webhookId } = req.params;

  if (req.body.url && isBlockedWebhookHost(req.body.url)) {
    throw new AppError(400, 'ERROR', 'Webhook URL points to a private, loopback, or link-local address, which is not allowed.');
  }

  const webhook = await prisma.webhook.update({
    where: { id: webhookId, orgId: req.org!.id },
    data: req.body,
    select: {
      id: true,
      url: true,
      events: true,
      active: true,
      createdAt: true,
      updatedAt: true
    }
  });

  res.json({ webhook });
});

/**
 * @swagger
 * /v1/orgs/{orgId}/webhooks/{webhookId}:
 *   delete:
 *     summary: Delete a webhook
 *     tags: [Webhooks]
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
 *         name: webhookId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Webhook deleted
 */
webhooksRouter.delete('/:orgId/webhooks/:webhookId', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const { webhookId } = req.params;

  await prisma.webhook.delete({
    where: { id: webhookId, orgId: req.org!.id }
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'webhook.deleted',
    resource: webhookId
  });

  res.status(204).send();
});
