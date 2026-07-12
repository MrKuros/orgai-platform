import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole, requireOrgAccess } from '../middleware/auth';
import { authOrApiKey } from '../middleware/authOrApiKey';
import { writeAuditLog } from '../services/audit';
import { dispatchWebhook } from '../services/webhook';
import { AppError } from '../lib/AppError';
import { invalidateResolveCache } from './resolve';
import { assertWithinLimit, limitsFor } from '../lib/plans';

export const policiesRouter = Router();

// Validates a regex evaluator: caps length/flags (ReDoS mitigation) and
// ensures it compiles. Throws 400 on failure. Skips non-regex evaluators.
function assertValidEvaluator(evaluatorType: string | undefined, pattern: unknown, flags: unknown) {
  if (evaluatorType !== 'regex' || pattern == null) return;
  if (typeof pattern !== 'string' || pattern.length > 500) {
    throw new AppError(400, 'INVALID_PATTERN', 'evaluatorPattern must be a string of at most 500 characters');
  }
  if (flags != null && (typeof flags !== 'string' || flags.length > 10)) {
    throw new AppError(400, 'INVALID_PATTERN', 'evaluatorFlags must be a string of at most 10 characters');
  }
  try {
    new RegExp(pattern, (flags as string) || '');
  } catch (e: any) {
    throw new AppError(400, 'INVALID_PATTERN', `Invalid regex pattern: ${e.message}`);
  }
}

const testPolicySchema = z.object({
  evaluatorType: z.enum(['regex', 'command']),
  evaluatorPattern: z.string().min(1).max(500),
  evaluatorFlags: z.string().max(10).optional(),
  content: z.string().max(20000),
});

// Dry-run a pattern against sample content before saving the policy.
policiesRouter.post('/:orgId/policies/test', requireAuth, requireOrgRole('POLICY_ADMIN', 'ORG_ADMIN'), validate(testPolicySchema), async (req, res) => {
  const { evaluatorPattern, evaluatorFlags, content } = req.body;

  let regex: RegExp;
  try {
    regex = new RegExp(evaluatorPattern, evaluatorFlags || '');
  } catch (e: any) {
    return res.json({ valid: false, matched: false, error: e.message });
  }

  const match = regex.exec(content);
  res.json({
    valid: true,
    matched: !!match,
    matchedText: match ? match[0].slice(0, 200) : null,
    line: match ? content.slice(0, match.index).split('\n').length : null,
  });
});

/**
 * @swagger
 * /v1/orgs/{orgId}/policies:
 *   get:
 *     summary: List all policies in organization
 *     tags: [Policies]
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
 *         description: List of policies
 */
policiesRouter.get('/:orgId/policies', authOrApiKey, requireOrgAccess, async (req, res) => {
  const policies = await prisma.policy.findMany({
    where: { orgId: req.org!.id },
    include: { bindings: true }
  });
  res.json({ policies });
});

const createPolicySchema = z.object({
  name: z.string().min(1),
  rule: z.string().min(1),
  skill: z.string().optional(),
  evaluatorType: z.enum(['regex', 'command', 'none']),
  evaluatorPattern: z.string().optional(),
  evaluatorFlags: z.string().optional(),
  fixSuggestion: z.string().optional(),
  severity: z.enum(['ERROR', 'WARNING']),
  roleIds: z.array(z.string()).default([])
});

/**
 * @swagger
 * /v1/orgs/{orgId}/policies:
 *   post:
 *     summary: Create a new policy
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
 *             required: [name, rule, evaluatorType, severity]
 *             properties:
 *               name:
 *                 type: string
 *               rule:
 *                 type: string
 *               skill:
 *                 type: string
 *               evaluatorType:
 *                 type: string
 *                 enum: [regex, command, none]
 *               evaluatorPattern:
 *                 type: string
 *               evaluatorFlags:
 *                 type: string
 *               fixSuggestion:
 *                 type: string
 *               severity:
 *                 type: string
 *                 enum: [ERROR, WARNING]
 *               roleIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       201:
 *         description: Policy created
 */
policiesRouter.post('/:orgId/policies', requireAuth, requireOrgRole('POLICY_ADMIN', 'ORG_ADMIN'), validate(createPolicySchema), async (req, res) => {
  const { roleIds, ...policyData } = req.body;

  assertValidEvaluator(policyData.evaluatorType, policyData.evaluatorPattern, policyData.evaluatorFlags);

  const policyCount = await prisma.policy.count({ where: { orgId: req.org!.id } });
  assertWithinLimit(policyCount, limitsFor(req.org!.plan).policies, 'Policy', req.org!.plan);

  // Verify all roleIds belong to this org before binding.
  if (roleIds.length > 0) {
    const owned = await prisma.role.count({ where: { id: { in: roleIds }, orgId: req.org!.id } });
    if (owned !== roleIds.length) {
      throw new AppError(400, 'ERROR', 'One or more roleIds do not belong to this organization');
    }
  }

  const policy = await prisma.$transaction(async (tx) => {
    const newPolicy = await tx.policy.create({
      data: {
        orgId: req.org!.id,
        ...policyData,
        skill: policyData.skill || '',
        fixSuggestion: policyData.fixSuggestion || ''
      }
    });

    if (roleIds.length > 0) {
      await tx.policyBinding.createMany({
        data: roleIds.map((roleId: string) => ({
          roleId,
          policyId: newPolicy.id
        }))
      });
    }

    return newPolicy;
  });

  invalidateResolveCache(req.org!.id);

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'policy.created',
    resource: policy.id,
    metadata: { name: policy.name }
  });

  dispatchWebhook(req.org!.id, 'policy.created', { policy });

  res.status(201).json({ policy });
});

const updatePolicySchema = z.object({
  name: z.string().min(1).optional(),
  rule: z.string().min(1).optional(),
  skill: z.string().optional(),
  evaluatorType: z.enum(['regex', 'command', 'none']).optional(),
  evaluatorPattern: z.string().optional().nullable(),
  evaluatorFlags: z.string().optional().nullable(),
  fixSuggestion: z.string().optional(),
  severity: z.enum(['ERROR', 'WARNING']).optional(),
});

/**
 * @swagger
 * /v1/orgs/{orgId}/policies/{policyId}:
 *   patch:
 *     summary: Update a policy
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
 *       - in: path
 *         name: policyId
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
 *               name:
 *                 type: string
 *               rule:
 *                 type: string
 *               skill:
 *                 type: string
 *               evaluatorType:
 *                 type: string
 *                 enum: [regex, command, none]
 *               evaluatorPattern:
 *                 type: string
 *                 nullable: true
 *               evaluatorFlags:
 *                 type: string
 *                 nullable: true
 *               fixSuggestion:
 *                 type: string
 *               severity:
 *                 type: string
 *                 enum: [ERROR, WARNING]
 *     responses:
 *       200:
 *         description: Policy updated
 */
policiesRouter.patch('/:orgId/policies/:policyId', requireAuth, requireOrgRole('POLICY_ADMIN', 'ORG_ADMIN'), validate(updatePolicySchema), async (req, res) => {
  const { policyId } = req.params;

  const currentPolicy = await prisma.policy.findUnique({
    where: { id: policyId, orgId: req.org!.id }
  });

  if (!currentPolicy) {
    throw new AppError(404, 'NOT_FOUND', 'Policy not found');
  }

  // Validate against effective (post-merge) evaluator values.
  const effType = req.body.evaluatorType ?? currentPolicy.evaluatorType;
  const effPattern = 'evaluatorPattern' in req.body ? req.body.evaluatorPattern : currentPolicy.evaluatorPattern;
  const effFlags = 'evaluatorFlags' in req.body ? req.body.evaluatorFlags : currentPolicy.evaluatorFlags;
  assertValidEvaluator(effType, effPattern, effFlags);

  const policy = await prisma.$transaction(async (tx) => {
    await tx.policyVersion.create({
      data: {
        policyId: currentPolicy.id,
        version: currentPolicy.currentVersion,
        name: currentPolicy.name,
        rule: currentPolicy.rule,
        skill: currentPolicy.skill,
        evaluatorType: currentPolicy.evaluatorType,
        evaluatorPattern: currentPolicy.evaluatorPattern,
        evaluatorFlags: currentPolicy.evaluatorFlags,
        fixSuggestion: currentPolicy.fixSuggestion,
        severity: currentPolicy.severity,
        changedById: req.user!.id,
      }
    });

    return tx.policy.update({
      where: { id: policyId, orgId: req.org!.id },
      data: {
        ...req.body,
        currentVersion: { increment: 1 }
      }
    });
  });

  invalidateResolveCache(req.org!.id);

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'policy.updated',
    resource: policy.id
  });

  dispatchWebhook(req.org!.id, 'policy.updated', { policy });

  res.json({ policy });
});

/**
 * @swagger
 * /v1/orgs/{orgId}/policies/{policyId}/versions:
 *   get:
 *     summary: Get policy version history
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
 *       - in: path
 *         name: policyId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Policy version history
 */
policiesRouter.get('/:orgId/policies/:policyId/versions', requireAuth, requireOrgRole('POLICY_ADMIN', 'ORG_ADMIN'), async (req, res) => {
  const { policyId } = req.params;

  const policy = await prisma.policy.findUnique({
    where: { id: policyId, orgId: req.org!.id }
  });

  if (!policy) {
    throw new AppError(404, 'NOT_FOUND', 'Policy not found');
  }

  const versions = await prisma.policyVersion.findMany({
    where: { policyId },
    orderBy: { version: 'desc' }
  });

  res.json({ versions });
});

/**
 * @swagger
 * /v1/orgs/{orgId}/policies/{policyId}/rollback/{versionId}:
 *   post:
 *     summary: Rollback a policy to a previous version
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
 *       - in: path
 *         name: policyId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: versionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Policy rolled back
 *       404:
 *         description: Policy or version not found
 */
policiesRouter.post('/:orgId/policies/:policyId/rollback/:versionId', requireAuth, requireOrgRole('POLICY_ADMIN', 'ORG_ADMIN'), async (req, res) => {
  const { policyId, versionId } = req.params;

  const currentPolicy = await prisma.policy.findUnique({
    where: { id: policyId, orgId: req.org!.id }
  });

  if (!currentPolicy) {
    throw new AppError(404, 'NOT_FOUND', 'Policy not found');
  }

  const targetVersion = await prisma.policyVersion.findUnique({
    where: { id: versionId }
  });

  if (!targetVersion || targetVersion.policyId !== policyId) {
    throw new AppError(404, 'NOT_FOUND', 'Version not found');
  }

  const policy = await prisma.$transaction(async (tx) => {
    await tx.policyVersion.create({
      data: {
        policyId: currentPolicy.id,
        version: currentPolicy.currentVersion,
        name: currentPolicy.name,
        rule: currentPolicy.rule,
        skill: currentPolicy.skill,
        evaluatorType: currentPolicy.evaluatorType,
        evaluatorPattern: currentPolicy.evaluatorPattern,
        evaluatorFlags: currentPolicy.evaluatorFlags,
        fixSuggestion: currentPolicy.fixSuggestion,
        severity: currentPolicy.severity,
        changedById: req.user!.id,
      }
    });

    return tx.policy.update({
      where: { id: policyId, orgId: req.org!.id },
      data: {
        name: targetVersion.name,
        rule: targetVersion.rule,
        skill: targetVersion.skill,
        evaluatorType: targetVersion.evaluatorType,
        evaluatorPattern: targetVersion.evaluatorPattern,
        evaluatorFlags: targetVersion.evaluatorFlags,
        fixSuggestion: targetVersion.fixSuggestion,
        severity: targetVersion.severity,
        currentVersion: { increment: 1 },
      }
    });
  });

  invalidateResolveCache(req.org!.id);

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'policy.rolledBack',
    resource: policy.id,
    metadata: { restoredVersionId: versionId, restoredVersion: targetVersion.version }
  });

  dispatchWebhook(req.org!.id, 'policy.updated', { policy });

  res.json({ policy });
});

/**
 * @swagger
 * /v1/orgs/{orgId}/policies/{policyId}:
 *   delete:
 *     summary: Delete a policy
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
 *       - in: path
 *         name: policyId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Policy deleted
 */
policiesRouter.delete('/:orgId/policies/:policyId', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const { policyId } = req.params;

  await prisma.policy.delete({
    where: { id: policyId, orgId: req.org!.id }
  });

  invalidateResolveCache(req.org!.id);

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'policy.deleted',
    resource: policyId
  });

  res.status(204).send();
});
