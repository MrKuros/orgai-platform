import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';

export const orgsRouter = Router();

orgsRouter.get('/:orgId', requireAuth, requireOrgRole(), async (req, res) => {
  res.json({ org: req.org });
});

const updateOrgSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional()
});

orgsRouter.patch('/:orgId', requireAuth, requireOrgRole('ORG_ADMIN'), validate(updateOrgSchema), async (req, res) => {
  const { name, slug } = req.body;

  try {
    const org = await prisma.organization.update({
      where: { id: req.org!.id },
      data: { name, slug }
    });

    await writeAuditLog({
      orgId: org.id,
      actorId: req.user!.id,
      action: 'org.updated',
      metadata: { name, slug }
    });

    res.json({ org });
  } catch (error) {
    res.status(409).json({ error: 'Organization slug might be taken' });
  }
});

orgsRouter.delete('/:orgId', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'org.deleted'
  });

  await prisma.organization.delete({
    where: { id: req.org!.id }
  });

  res.status(204).send();
});
