import { AppError } from "../lib/AppError";
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole, requireOrgAccess } from '../middleware/auth';
import { authOrApiKey } from '../middleware/authOrApiKey';
import { writeAuditLog } from '../services/audit';
import { invalidateResolveCache } from './resolve';

export const rolesRouter = Router();

/**
 * @swagger
 * /v1/orgs/{orgId}/roles:
 *   get:
 *     summary: List all roles in organization
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of roles
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 roles:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Role'
 */
rolesRouter.get('/:orgId/roles', authOrApiKey, requireOrgAccess, async (req, res) => {
  const roles = await prisma.role.findMany({
    where: { orgId: req.org!.id },
    include: {
      bindings: { include: { policy: true } },
      memberships: true
    }
  });
  res.json({ roles });
});

const createRoleSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  inheritsFromId: z.string().optional()
});

/**
 * @swagger
 * /v1/orgs/{orgId}/roles:
 *   post:
 *     summary: Create a new role
 *     tags: [Roles]
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
 *             required: [name, displayName]
 *             properties:
 *               name:
 *                 type: string
 *               displayName:
 *                 type: string
 *               inheritsFromId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Role created
 *       409:
 *         description: Role name might be taken
 */
rolesRouter.post('/:orgId/roles', requireAuth, requireOrgRole('POLICY_ADMIN', 'ORG_ADMIN'), validate(createRoleSchema), async (req, res) => {
  const { name, displayName, inheritsFromId } = req.body;

  if (inheritsFromId) {
    const allRoles = await prisma.role.findMany({ where: { orgId: req.org!.id } });
    const visited = new Set<string>();
    let currentId: string | null = inheritsFromId;
    while (currentId) {
      if (visited.has(currentId)) {
        throw new AppError(400, 'CYCLE_DETECTED', 'Role inheritance would create a cycle');
      }
      visited.add(currentId);
      const parent = allRoles.find(r => r.id === currentId);
      currentId = parent?.inheritsFromId || null;
    }
  }

  try {
    const role = await prisma.role.create({
      data: { orgId: req.org!.id, name, displayName, inheritsFromId }
    });

    invalidateResolveCache(req.org!.id);

    await writeAuditLog({
      orgId: req.org!.id,
      actorId: req.user!.id,
      action: 'role.created',
      resource: role.id,
      metadata: { name }
    });

    res.status(201).json({ role });
  } catch (error) {
    throw new AppError(409, 'CONFLICT', 'Role name might be taken in this org');
  }
});

const updateRoleSchema = z.object({
  displayName: z.string().min(1).optional(),
  inheritsFromId: z.string().optional().nullable()
});

/**
 * @swagger
 * /v1/orgs/{orgId}/roles/{roleId}:
 *   patch:
 *     summary: Update a role
 *     tags: [Roles]
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
 *         name: roleId
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
 *             properties:
 *               displayName:
 *                 type: string
 *               inheritsFromId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Role updated
 */
rolesRouter.patch('/:orgId/roles/:roleId', requireAuth, requireOrgRole('POLICY_ADMIN', 'ORG_ADMIN'), validate(updateRoleSchema), async (req, res) => {
  const { roleId } = req.params;
  const { displayName, inheritsFromId } = req.body;

  if (inheritsFromId !== undefined && inheritsFromId !== null) {
    if (inheritsFromId === roleId) {
      throw new AppError(400, 'CYCLE_DETECTED', 'A role cannot inherit from itself');
    }
    const allRoles = await prisma.role.findMany({ where: { orgId: req.org!.id } });
    const visited = new Set<string>([roleId]);
    let currentId: string | null = inheritsFromId;
    while (currentId) {
      if (visited.has(currentId)) {
        throw new AppError(400, 'CYCLE_DETECTED', 'Role inheritance would create a cycle');
      }
      visited.add(currentId);
      const parent = allRoles.find(r => r.id === currentId);
      currentId = parent?.inheritsFromId || null;
    }
  }

  const role = await prisma.role.update({
    where: { id: roleId, orgId: req.org!.id },
    data: { displayName, inheritsFromId }
  });

  invalidateResolveCache(req.org!.id);

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'role.updated',
    resource: role.id
  });

  res.json({ role });
});

/**
 * @swagger
 * /v1/orgs/{orgId}/roles/{roleId}:
 *   delete:
 *     summary: Delete a role
 *     tags: [Roles]
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
 *         name: roleId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Role deleted
 *       409:
 *         description: Cannot delete role - assigned to members
 */
rolesRouter.delete('/:orgId/roles/:roleId', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const { roleId } = req.params;

  const inUse = await prisma.membership.findFirst({
    where: { orgId: req.org!.id, assignedRoles: { some: { id: roleId } } }
  });

  if (inUse) {
    throw new AppError(409, 'ERROR', 'Cannot delete role: it is assigned to one or more members');
  }

  await prisma.role.delete({
    where: { id: roleId, orgId: req.org!.id }
  });

  invalidateResolveCache(req.org!.id);

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'role.deleted',
    resource: roleId
  });

  res.status(204).send();
});
