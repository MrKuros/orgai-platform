import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';

export const ssoRouter = Router();

ssoRouter.get('/:orgId/sso', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const ssoConfig = await prisma.ssoConfig.findUnique({
    where: { orgId: req.org!.id },
    select: {
      id: true,
      provider: true,
      createdAt: true,
      updatedAt: true
    }
  });
  res.json({ ssoConfig });
});

const upsertSsoSchema = z.object({
  provider: z.string().min(1),
  workosOrgId: z.string().min(1),
  connectionId: z.string().min(1)
});

ssoRouter.put('/:orgId/sso', requireAuth, requireOrgRole('ORG_ADMIN'), validate(upsertSsoSchema), async (req, res) => {
  const { provider, workosOrgId, connectionId } = req.body;

  const ssoConfig = await prisma.ssoConfig.upsert({
    where: { orgId: req.org!.id },
    update: { provider, workosOrgId, connectionId },
    create: {
      orgId: req.org!.id,
      provider,
      workosOrgId,
      connectionId
    }
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'sso.configured',
    metadata: { provider }
  });

  res.json({
    ssoConfig: {
      id: ssoConfig.id,
      provider: ssoConfig.provider,
      createdAt: ssoConfig.createdAt,
      updatedAt: ssoConfig.updatedAt
    }
  });
});

ssoRouter.delete('/:orgId/sso', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  await prisma.ssoConfig.delete({
    where: { orgId: req.org!.id }
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'sso.removed'
  });

  res.status(204).send();
});
