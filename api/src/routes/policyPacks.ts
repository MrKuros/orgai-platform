import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import { AppError } from '../lib/AppError';
import { invalidateResolveCache } from './resolve';
import { assertWithinLimit, limitsFor } from '../lib/plans';

export const policyPacksRouter = Router();
export const policyPacksImportRouter = Router();

interface PackPolicy {
  name: string;
  rule: string;
  skill: string;
  evaluatorType: string;
  evaluatorPattern: string;
  evaluatorFlags: string;
  fixSuggestion: string;
  severity: 'ERROR' | 'WARNING';
}
interface Pack {
  id: string;
  name: string;
  description: string;
  policies: PackPolicy[];
}

// Packs ship with the server (src/policy-packs, copied to dist by postbuild).
// Community packs are plain JSON PRs against that directory.
const PACKS_DIR = path.resolve(__dirname, '../policy-packs');

function loadPacks(): Pack[] {
  return fs.readdirSync(PACKS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(PACKS_DIR, f), 'utf8')));
}

/**
 * @swagger
 * /v1/policy-packs:
 *   get:
 *     summary: List available starter policy packs
 *     tags: [Policies]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available packs with their policies
 */
policyPacksRouter.get('/policy-packs', requireAuth, async (req, res) => {
  res.json({ packs: loadPacks() });
});

const importPackSchema = z.object({
  packId: z.string().min(1),
  roleIds: z.array(z.string()).default([]),
  // Packs default to SHADOW: measure noise in the audit trail first, enforce
  // per-policy from the dashboard when ready.
  status: z.enum(['ENFORCED', 'SHADOW']).default('SHADOW')
});

/**
 * @swagger
 * /v1/orgs/{orgId}/policies/import-pack:
 *   post:
 *     summary: Import a starter policy pack (defaults to SHADOW status)
 *     tags: [Policies]
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
 *             required: [packId]
 *             properties:
 *               packId:
 *                 type: string
 *               roleIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *               status:
 *                 type: string
 *                 enum: [ENFORCED, SHADOW]
 *     responses:
 *       200:
 *         description: Pack imported — lists created and skipped (name collision) policies
 */
policyPacksImportRouter.post('/:orgId/policies/import-pack', requireAuth, requireOrgRole('POLICY_ADMIN', 'ORG_ADMIN'), validate(importPackSchema), async (req, res) => {
  const { packId, roleIds, status } = req.body;

  const pack = loadPacks().find(p => p.id === packId);
  if (!pack) {
    throw new AppError(404, 'NOT_FOUND', `Unknown policy pack: ${packId}`);
  }

  if (roleIds.length > 0) {
    const owned = await prisma.role.count({ where: { id: { in: roleIds }, orgId: req.org!.id } });
    if (owned !== roleIds.length) {
      throw new AppError(400, 'ERROR', 'One or more roleIds do not belong to this organization');
    }
  }

  const existing = await prisma.policy.findMany({
    where: { orgId: req.org!.id, name: { in: pack.policies.map(p => p.name) } },
    select: { name: true }
  });
  const existingNames = new Set(existing.map(p => p.name));
  const toCreate = pack.policies.filter(p => !existingNames.has(p.name));

  const policyCount = await prisma.policy.count({ where: { orgId: req.org!.id } });
  assertWithinLimit(policyCount + toCreate.length - 1, limitsFor(req.org!.plan).policies, 'Policy', req.org!.plan);

  const imported: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const p of toCreate) {
      const policy = await tx.policy.create({
        data: {
          orgId: req.org!.id,
          name: p.name,
          rule: p.rule,
          skill: p.skill,
          evaluatorType: p.evaluatorType,
          evaluatorPattern: p.evaluatorPattern,
          evaluatorFlags: p.evaluatorFlags || null,
          fixSuggestion: p.fixSuggestion,
          severity: p.severity,
          status
        }
      });
      if (roleIds.length > 0) {
        await tx.policyBinding.createMany({
          data: roleIds.map((roleId: string) => ({ roleId, policyId: policy.id }))
        });
      }
      imported.push(p.name);
    }
  });

  invalidateResolveCache(req.org!.id);

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'policy.pack_imported',
    resource: packId,
    metadata: { packId, status, imported, skipped: [...existingNames] }
  });

  res.json({ imported, skipped: [...existingNames], status });
});
