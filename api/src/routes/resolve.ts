import { AppError } from "../lib/AppError";
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireApiKey, requireOrgAccess } from '../middleware/auth';
import { authOrApiKey } from '../middleware/authOrApiKey';
import { writeAuditLog } from '../services/audit';
import { dispatchWebhook } from '../services/webhook';
import { broadcastViolation } from './violations';
import { meterEvaluation } from '../lib/plans';

export const resolveRouter = Router();

const cache = new Map<string, { data: any, expires: number }>();

export function invalidateResolveCache(orgId?: string) {
  if (orgId) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${orgId}:`)) {
        cache.delete(key);
      }
    }
  } else {
    cache.clear();
  }
}

export async function resolveRolePolicies(orgId: string, roleName: string) {
  const cacheKey = `${orgId}:${roleName}`;

  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const role = await prisma.role.findUnique({
    where: { orgId_name: { orgId, name: roleName } }
  });

  if (!role) {
    return null;
  }

  const resolvedFrom: string[] = [];
  let currentRoleId: string | null = role.id;
  const policyMap = new Map<string, any>();
  const warnings: { policyName: string; overriddenByRole: string; originalRole: string }[] = [];

  const allRoles = await prisma.role.findMany({
    where: { orgId },
    include: { bindings: { include: { policy: true } } }
  });

  const visitedRoleIds = new Set<string>();
  while (currentRoleId) {
    if (visitedRoleIds.has(currentRoleId)) break; // Prevent infinite loop from cyclic data
    visitedRoleIds.add(currentRoleId);
    const currentRole = allRoles.find(r => r.id === currentRoleId);
    if (!currentRole) break;

    resolvedFrom.push(currentRole.name);

    for (const binding of currentRole.bindings) {
      const policyName = binding.policy.name;
      const existingPolicy = policyMap.get(policyName);

      if (existingPolicy) {
        warnings.push({
          policyName,
          overriddenByRole: currentRole.name,
          originalRole: existingPolicy.setByRole
        });
      }

      policyMap.set(policyName, {
        ...binding.policy,
        setByRole: currentRole.name,
        setByDisplayName: currentRole.displayName
      });
    }

    currentRoleId = currentRole.inheritsFromId;
  }

  const responseData = {
    role: { id: role.id, name: role.name, displayName: role.displayName },
    resolvedFrom: resolvedFrom.reverse(),
    policies: Array.from(policyMap.values()),
    warnings
  };

  cache.set(cacheKey, { data: responseData, expires: Date.now() + 5 * 60 * 1000 });
  return responseData;
}

/**
 * @swagger
 * /v1/orgs/{orgId}/resolve/{roleName}:
 *   get:
 *     summary: Resolve policies for a role
 *     tags: [Resolve]
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
 *       - in: path
 *         name: roleName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resolved policies
 *       404:
 *         description: Role not found
 */
resolveRouter.get('/:orgId/resolve/:roleName', authOrApiKey, requireOrgAccess, async (req, res) => {
  const { roleName } = req.params;
  const orgId = req.org!.id;

  const responseData = await resolveRolePolicies(orgId, roleName);

  if (!responseData) {
    throw new AppError(404, 'ERROR', 'Role not found');
  }

  res.json(responseData);
});

const checkSchema = z.object({
  type: z.enum(['code', 'command']),
  content: z.string(),
  filePath: z.string().optional(),
  roleName: z.string()
});

/**
 * @swagger
 * /v1/orgs/{orgId}/check:
 *   post:
 *     summary: Check content against policies
 *     tags: [Resolve]
 *     security:
 *       - apiKeyAuth: []
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
 *             required: [type, content, roleName]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [code, command]
 *               content:
 *                 type: string
 *               filePath:
 *                 type: string
 *               roleName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Policy check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 passed:
 *                   type: boolean
 *                 violations:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Violation'
 *       404:
 *         description: Role not found
 */
resolveRouter.post('/:orgId/check', requireApiKey, validate(checkSchema), async (req, res) => {
  const { type, content, filePath, roleName } = req.body;
  const orgId = req.org!.id;

  await meterEvaluation(orgId, req.org!.plan);

  const responseData = await resolveRolePolicies(orgId, roleName);
  if (!responseData) {
    throw new AppError(404, 'ERROR', 'Role not found');
  }

  const { policies } = responseData;
  const violations: any[] = [];

  for (const policy of policies) {
    if (policy.evaluatorType === 'none' || !policy.evaluatorPattern) continue;

    let isViolation = false;
    let line: number | undefined;

    if (type === 'code' && policy.evaluatorType === 'regex') {
      if (policy.name === 'no-console-log' && filePath?.includes('logger')) continue;

      const regex = new RegExp(policy.evaluatorPattern, policy.evaluatorFlags || '');
      const match = regex.exec(content);
      if (match) {
        isViolation = true;
        line = content.slice(0, match.index).split('\n').length;
      }
    } else if (type === 'command' && policy.evaluatorType === 'command') {
      const regex = new RegExp(policy.evaluatorPattern);
      if (regex.test(content)) {
        isViolation = true;
      }
    }

    if (isViolation) {
      violations.push({
        policyId: policy.id,
        policyName: policy.name,
        rule: policy.rule,
        severity: policy.severity,
        fixSuggestion: policy.fixSuggestion,
        setByDisplayName: policy.setByDisplayName,
        line
      });

      if (policy.severity === 'ERROR') {
        await writeAuditLog({
          orgId,
          action: 'policy.violated',
          metadata: { policyId: policy.id, contentSnippet: content.substring(0, 100) }
        });
      }
    }
  }

  const hasErrors = violations.some(v => v.severity === 'ERROR');

  if (hasErrors) {
    dispatchWebhook(orgId, 'policy.violated', { violations });
    broadcastViolation(orgId, { violations, timestamp: new Date().toISOString() });
  }

  res.json({ passed: !hasErrors, violations });
});
