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
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true, passwordHash: true, workosUserId: true } },
      assignedRoles: true
    }
  });
  // pending = invited but has never set a password / linked SSO
  res.json({
    members: members.map(m => {
      const { passwordHash, workosUserId, ...user } = m.user;
      return { ...m, user, pending: !passwordHash && !workosUserId };
    })
  });
});

// Regenerate an invite link for a pending member (self-host installs have no
// email, so the admin copies the link from the dashboard instead).
membersRouter.post('/:orgId/members/:membershipId/invite-link', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const membership = await prisma.membership.findFirst({
    where: { id: req.params.membershipId, orgId: req.org!.id },
    include: { user: true }
  });
  if (!membership) throw new AppError(404, 'ERROR', 'Member not found');
  if (membership.user.passwordHash || membership.user.workosUserId) {
    throw new AppError(400, 'ERROR', 'This member has already activated their account.');
  }

  const token = await createAuthToken(membership.user.id, 'INVITE', req.org!.id);
  const base = process.env.DASHBOARD_URL || 'http://localhost:3000';

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'member.invite_link_generated',
    resource: membership.user.id
  });

  res.json({ link: `${base}/accept-invite?token=${token}` });
});

const inviteSchema = z.object({
  email: z.string().email(),
  membershipRole: z.enum(['ORG_ADMIN', 'POLICY_ADMIN', 'MEMBER']),
  assignedRoleId: z.string().optional(),        // legacy single-role callers
  assignedRoleIds: z.array(z.string()).optional()
});

// Legacy assignedRoleId + new assignedRoleIds → one deduped list, org-verified.
async function normalizeRoleIds(orgId: string, assignedRoleId?: string | null, assignedRoleIds?: string[]): Promise<string[]> {
  const ids = [...new Set([...(assignedRoleIds ?? []), ...(assignedRoleId ? [assignedRoleId] : [])])];
  if (ids.length === 0) return ids;
  const count = await prisma.role.count({ where: { id: { in: ids }, orgId } });
  if (count !== ids.length) throw new AppError(400, 'ERROR', 'One or more assigned roles do not belong to this organization');
  return ids;
}

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
  const { email, membershipRole, assignedRoleId, assignedRoleIds } = req.body;

  const memberCount = await prisma.membership.count({ where: { orgId: req.org!.id } });
  assertWithinLimit(memberCount, limitsFor(req.org!.plan).members, 'Team member', req.org!.plan);

  const roleIds = await normalizeRoleIds(req.org!.id, assignedRoleId, assignedRoleIds);

  const existing = await prisma.user.findUnique({ where: { email } });

  try {
    // Create user + membership atomically so a failed membership doesn't
    // orphan a freshly-created user.
    const { user, membership } = await prisma.$transaction(async (tx) => {
      const user = existing ?? await tx.user.create({ data: { email } });
      const membership = await tx.membership.create({
        data: {
          orgId: req.org!.id,
          userId: user.id,
          role: membershipRole,
          assignedRoles: { connect: roleIds.map(id => ({ id })) }
        },
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          assignedRoles: true
        }
      });
      return { user, membership };
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
  assignedRoleId: z.string().optional().nullable(), // legacy single-role callers
  assignedRoleIds: z.array(z.string()).optional()
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
  const { membershipRole, assignedRoleId, assignedRoleIds } = req.body as {
    membershipRole?: 'ORG_ADMIN' | 'POLICY_ADMIN' | 'MEMBER';
    assignedRoleId?: string | null;
    assignedRoleIds?: string[];
  };

  // Block demoting the last ORG_ADMIN out of the admin role.
  if (membershipRole !== undefined && membershipRole !== 'ORG_ADMIN') {
    const current = await prisma.membership.findUnique({
      where: { orgId_userId: { orgId: req.org!.id, userId } }
    });
    if (current?.role === 'ORG_ADMIN') {
      const adminCount = await prisma.membership.count({
        where: { orgId: req.org!.id, role: 'ORG_ADMIN' }
      });
      if (adminCount <= 1) {
        throw new AppError(409, 'ERROR', 'Cannot demote the last ORG_ADMIN');
      }
    }
  }

  const data: any = {};
  if (membershipRole !== undefined) data.role = membershipRole;
  // Role assignment: assignedRoleIds replaces the set; legacy assignedRoleId
  // maps to a one-element set (or clears it when explicitly null).
  if (assignedRoleIds !== undefined) {
    const ids = await normalizeRoleIds(req.org!.id, null, assignedRoleIds);
    data.assignedRoles = { set: ids.map(id => ({ id })) };
  } else if (assignedRoleId !== undefined) {
    const ids = await normalizeRoleIds(req.org!.id, assignedRoleId, []);
    data.assignedRoles = { set: ids.map(id => ({ id })) };
  }

  const membership = await prisma.membership.update({
    where: { orgId_userId: { orgId: req.org!.id, userId } },
    data,
    include: { assignedRoles: true }
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
