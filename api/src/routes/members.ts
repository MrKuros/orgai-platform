import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import { dispatchWebhook } from '../services/webhook';

export const membersRouter = Router();

membersRouter.get('/:orgId/members', requireAuth, requireOrgRole(), async (req, res) => {
  const members = await prisma.membership.findMany({
    where: { orgId: req.org!.id },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true } }, assignedRole: true }
  });
  res.json({ members });
});

const inviteSchema = z.object({
  email: z.string().email(),
  membershipRole: z.enum(['ORG_ADMIN', 'POLICY_ADMIN', 'MEMBER']),
  assignedRoleId: z.string().optional()
});

membersRouter.post('/:orgId/members/invite', requireAuth, requireOrgRole('ORG_ADMIN'), validate(inviteSchema), async (req, res) => {
  const { email, membershipRole, assignedRoleId } = req.body;

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email }
    });
  }

  try {
    const membership = await prisma.membership.create({
      data: {
        orgId: req.org!.id,
        userId: user.id,
        role: membershipRole,
        assignedRoleId
      },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } }
    });

    await writeAuditLog({
      orgId: req.org!.id,
      actorId: req.user!.id,
      action: 'member.invited',
      resource: user.id,
      metadata: { role: membershipRole }
    });

    dispatchWebhook(req.org!.id, 'member.invited', { membership });

    res.status(201).json({ membership });
  } catch (error) {
    res.status(409).json({ error: 'User is already a member of this organization' });
  }
});

const updateMemberSchema = z.object({
  membershipRole: z.enum(['ORG_ADMIN', 'POLICY_ADMIN', 'MEMBER']).optional(),
  assignedRoleId: z.string().optional().nullable()
});

membersRouter.patch('/:orgId/members/:userId', requireAuth, requireOrgRole('ORG_ADMIN'), validate(updateMemberSchema), async (req, res) => {
  const { userId } = req.params;

  const membership = await prisma.membership.update({
    where: { orgId_userId: { orgId: req.org!.id, userId } },
    data: req.body
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'member.updated',
    resource: userId
  });

  res.json({ membership });
});

membersRouter.delete('/:orgId/members/:userId', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const { userId } = req.params;

  if (userId === req.user!.id) {
    const adminCount = await prisma.membership.count({
      where: { orgId: req.org!.id, role: 'ORG_ADMIN' }
    });
    if (adminCount <= 1) {
      return res.status(409).json({ error: 'Cannot remove the last ORG_ADMIN' });
    }
  }

  await prisma.membership.delete({
    where: { orgId_userId: { orgId: req.org!.id, userId } }
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'member.removed',
    resource: userId
  });

  res.status(204).send();
});
