import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { authOrApiKey } from '../middleware/authOrApiKey';
import { writeAuditLog } from '../services/audit';

export const rolesRouter = Router();

rolesRouter.get('/:orgId/roles', authOrApiKey, async (req, res) => {
  const roles = await prisma.role.findMany({
    where: { orgId: req.params.orgId },
    include: { bindings: { include: { policy: true } } }
  });
  res.json({ roles });
});

const createRoleSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  inheritsFromId: z.string().optional()
});

rolesRouter.post('/:orgId/roles', requireAuth, requireOrgRole('POLICY_ADMIN', 'ORG_ADMIN'), validate(createRoleSchema), async (req, res) => {
  const { name, displayName, inheritsFromId } = req.body;

  try {
    const role = await prisma.role.create({
      data: { orgId: req.org!.id, name, displayName, inheritsFromId }
    });

    await writeAuditLog({
      orgId: req.org!.id,
      actorId: req.user!.id,
      action: 'role.created',
      resource: role.id,
      metadata: { name }
    });

    res.status(201).json({ role });
  } catch (error) {
    res.status(409).json({ error: 'Role name might be taken in this org' });
  }
});

const updateRoleSchema = z.object({
  displayName: z.string().min(1).optional(),
  inheritsFromId: z.string().optional().nullable()
});

rolesRouter.patch('/:orgId/roles/:roleId', requireAuth, requireOrgRole('POLICY_ADMIN', 'ORG_ADMIN'), validate(updateRoleSchema), async (req, res) => {
  const { roleId } = req.params;
  const { displayName, inheritsFromId } = req.body;

  const role = await prisma.role.update({
    where: { id: roleId, orgId: req.org!.id },
    data: { displayName, inheritsFromId }
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'role.updated',
    resource: role.id
  });

  res.json({ role });
});

rolesRouter.delete('/:orgId/roles/:roleId', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const { roleId } = req.params;

  const inUse = await prisma.membership.findFirst({
    where: { orgId: req.org!.id, assignedRoleId: roleId }
  });

  if (inUse) {
    return res.status(409).json({ error: 'Cannot delete role: it is assigned to one or more members' });
  }

  await prisma.role.delete({
    where: { id: roleId, orgId: req.org!.id }
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'role.deleted',
    resource: roleId
  });

  res.status(204).send();
});
