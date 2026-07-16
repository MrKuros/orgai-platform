import { AppError } from "../lib/AppError";
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import { STARTER_ROLES } from '../lib/starterPack';

export const orgsRouter = Router();

// Seed starter roles + policies into an empty org (one click from the dashboard)
orgsRouter.post('/:orgId/seed-defaults', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const orgId = req.org!.id;

  const existingRoles = await prisma.role.count({ where: { orgId } });
  if (existingRoles > 0) {
    throw new AppError(409, 'ALREADY_SEEDED', 'This organization already has roles configured.');
  }

  const created = await prisma.$transaction(async (tx) => {
    const roleIds: Record<string, string> = {};
    let policyCount = 0;

    for (const r of STARTER_ROLES) {
      const role = await tx.role.create({
        data: {
          orgId,
          name: r.name,
          displayName: r.displayName,
          inheritsFromId: r.inheritsFrom ? roleIds[r.inheritsFrom] : null,
        },
      });
      roleIds[r.name] = role.id;

      for (const p of r.policies) {
        const policy = await tx.policy.create({
          data: {
            orgId,
            name: p.name,
            rule: p.rule,
            skill: p.skill,
            evaluatorType: p.evaluatorType,
            evaluatorPattern: p.evaluatorPattern,
            evaluatorFlags: p.evaluatorFlags,
            fixSuggestion: p.fixSuggestion,
            severity: p.severity,
          },
        });
        await tx.policyBinding.create({ data: { roleId: role.id, policyId: policy.id } });
        policyCount++;
      }
    }

    return { roles: STARTER_ROLES.length, policies: policyCount };
  });

  await writeAuditLog({
    orgId,
    actorId: req.user!.id,
    action: 'org.seeded_defaults',
    metadata: created,
  });

  res.status(201).json(created);
});

// Compliance overview for the dashboard home page
orgsRouter.get('/:orgId/stats', requireAuth, requireOrgRole(), async (req, res) => {
  const orgId = req.org!.id;

  const [byDay, topRaw, lastKey, usage] = await Promise.all([
    prisma.$queryRaw<{ day: Date; count: bigint }[]>(Prisma.sql`
      SELECT date_trunc('day', "createdAt") AS day, count(*) AS count
      FROM "AuditLog"
      WHERE "orgId" = ${orgId} AND action = 'policy.violated'
        AND "createdAt" > now() - interval '14 days'
      GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<{ policyId: string; count: bigint }[]>(Prisma.sql`
      SELECT metadata->>'policyId' AS "policyId", count(*) AS count
      FROM "AuditLog"
      WHERE "orgId" = ${orgId} AND action = 'policy.violated'
        AND metadata->>'policyId' IS NOT NULL
        AND "createdAt" > now() - interval '30 days'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 5`),
    prisma.apiKey.findFirst({
      where: { orgId, lastUsedAt: { not: null } },
      orderBy: { lastUsedAt: 'desc' },
      select: { lastUsedAt: true, name: true },
    }),
    prisma.usageCounter.findUnique({
      where: { orgId_period: { orgId, period: new Date().toISOString().slice(0, 7) } },
    }),
  ]);

  const policyNames = topRaw.length
    ? await prisma.policy.findMany({
        where: { id: { in: topRaw.map(t => t.policyId) } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = Object.fromEntries(policyNames.map(p => [p.id, p.name]));

  res.json({
    violationsByDay: byDay.map(d => ({ day: d.day, count: Number(d.count) })),
    topPolicies: topRaw.map(t => ({
      policyId: t.policyId,
      name: nameById[t.policyId] || '(deleted policy)',
      count: Number(t.count),
    })),
    evaluationsThisMonth: usage?.evaluations ?? 0,
    lastCheckAt: lastKey?.lastUsedAt ?? null,
    lastCheckKeyName: lastKey?.name ?? null,
  });
});

/**
 * @swagger
 * /v1/orgs/{orgId}:
 *   get:
 *     summary: Get organization details
 *     tags: [Organizations]
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
 *         description: Organization details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 org:
 *                   $ref: '#/components/schemas/Organization'
 */
orgsRouter.get('/:orgId', requireAuth, requireOrgRole(), async (req, res) => {
  res.json({ org: req.org });
});

const updateOrgSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  autoFix: z.boolean().optional()
});

/**
 * @swagger
 * /v1/orgs/{orgId}:
 *   patch:
 *     summary: Update organization details
 *     tags: [Organizations]
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
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *     responses:
 *       200:
 *         description: Organization updated
 *       409:
 *         description: Organization slug might be taken
 */
orgsRouter.patch('/:orgId', requireAuth, requireOrgRole('ORG_ADMIN'), validate(updateOrgSchema), async (req, res) => {
  const { name, slug, autoFix } = req.body;

  try {
    const org = await prisma.organization.update({
      where: { id: req.org!.id },
      data: { name, slug, autoFix }
    });

    await writeAuditLog({
      orgId: org.id,
      actorId: req.user!.id,
      action: 'org.updated',
      metadata: { name, slug, autoFix }
    });

    res.json({ org });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      throw new AppError(409, 'ERROR', 'Organization slug is already taken');
    }
    throw error;
  }
});

/**
 * @swagger
 * /v1/orgs/{orgId}:
 *   delete:
 *     summary: Delete organization
 *     tags: [Organizations]
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
 *       204:
 *         description: Organization deleted
 */
orgsRouter.delete('/:orgId', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  // ponytail: this audit row is cascade-deleted moments later with the org —
  // the event survives only in server logs. Ship rows to an external sink
  // (SIEM webhook / log aggregation) if org-deletion evidence ever matters.
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
