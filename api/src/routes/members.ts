import { AppError } from "../lib/AppError";
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import { dispatchWebhook } from '../services/webhook';
import { createAuthToken } from '../services/authTokens';
import { sendInviteEmail } from '../services/email';
import { assertWithinLimit, limitsFor } from '../lib/plans';

export const membersRouter = Router();

/**
 * @swagger
 * /v1/orgs/{orgId}/members:
 *   get:
 *     summary: List organization members
 *     tags: [Members]
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
 *         description: List of members
 */
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

/**
 * @swagger
 * /v1/orgs/{orgId}/members/invite:
 *   post:
 *     summary: Invite a user to organization
 *     tags: [Members]
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
 *             required: [email, membershipRole]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               membershipRole:
 *                 type: string
 *                 enum: [ORG_ADMIN, POLICY_ADMIN, MEMBER]
 *               assignedRoleId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Member invited
 *       409:
 *         description: User is already a member
 */
membersRouter.post('/:orgId/members/invite', requireAuth, requireOrgRole('ORG_ADMIN'), validate(inviteSchema), async (req, res) => {
  const { email, membershipRole, assignedRoleId } = req.body;

  const memberCount = await prisma.membership.count({ where: { orgId: req.org!.id } });
  assertWithinLimit(memberCount, limitsFor(req.org!.plan).members, 'Team member', req.org!.plan);

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

    // Invite email: new users get a set-password link; existing users can log in already
    if (!user.passwordHash && !user.workosUserId) {
      const inviteToken = await createAuthToken(user.id, 'INVITE', req.org!.id);
      const inviter = await prisma.user.findUnique({ where: { id: req.user!.id } });
      const inviterName = inviter?.firstName ? `${inviter.firstName} ${inviter.lastName ?? ''}`.trim() : 'A teammate';
      await sendInviteEmail(email, req.org!.name, inviterName, inviteToken);
    }

    res.status(201).json({ membership });
  } catch (error) {
    throw new AppError(409, 'ERROR', 'User is already a member of this organization');
  }
});

const updateMemberSchema = z.object({
  membershipRole: z.enum(['ORG_ADMIN', 'POLICY_ADMIN', 'MEMBER']).optional(),
  assignedRoleId: z.string().optional().nullable()
});

/**
 * @swagger
 * /v1/orgs/{orgId}/members/{userId}:
 *   patch:
 *     summary: Update member role
 *     tags: [Members]
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
 *         name: userId
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
 *               membershipRole:
 *                 type: string
 *                 enum: [ORG_ADMIN, POLICY_ADMIN, MEMBER]
 *               assignedRoleId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Member updated
 */
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

/**
 * @swagger
 * /v1/orgs/{orgId}/members/{userId}:
 *   delete:
 *     summary: Remove member from organization
 *     tags: [Members]
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
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Member removed
 *       409:
 *         description: Cannot remove the last ORG_ADMIN
 */
membersRouter.delete('/:orgId/members/:userId', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const { userId } = req.params;

  if (userId === req.user!.id) {
    const adminCount = await prisma.membership.count({
      where: { orgId: req.org!.id, role: 'ORG_ADMIN' }
    });
    if (adminCount <= 1) {
      throw new AppError(409, 'ERROR', 'Cannot remove the last ORG_ADMIN');
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
