import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';

export const webhooksRouter = Router();

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
  events: z.array(z.enum(['policy.violated', 'policy.updated', 'member.invited', 'audit.flagged'])).min(1)
});

webhooksRouter.post('/:orgId/webhooks', requireAuth, requireOrgRole('ORG_ADMIN'), validate(createWebhookSchema), async (req, res) => {
  const { url, events } = req.body;

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
  events: z.array(z.enum(['policy.violated', 'policy.updated', 'member.invited', 'audit.flagged'])).min(1).optional(),
  active: z.boolean().optional()
});

webhooksRouter.patch('/:orgId/webhooks/:webhookId', requireAuth, requireOrgRole('ORG_ADMIN'), validate(updateWebhookSchema), async (req, res) => {
  const { webhookId } = req.params;

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
