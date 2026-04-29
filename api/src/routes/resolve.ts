import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireApiKey } from '../middleware/auth';
import { authOrApiKey } from '../middleware/authOrApiKey';
import { writeAuditLog } from '../services/audit';
import { dispatchWebhook } from '../services/webhook';

export const resolveRouter = Router();

const cache = new Map<string, { data: any, expires: number }>();

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

  const allRoles = await prisma.role.findMany({
    where: { orgId },
    include: { bindings: { include: { policy: true } } }
  });

  while (currentRoleId) {
    const currentRole = allRoles.find(r => r.id === currentRoleId);
    if (!currentRole) break;

    resolvedFrom.push(currentRole.name);

    for (const binding of currentRole.bindings) {
      if (!policyMap.has(binding.policy.id)) {
        policyMap.set(binding.policy.id, {
          ...binding.policy,
          setByRole: currentRole.name,
          setByDisplayName: currentRole.displayName
        });
      }
    }

    currentRoleId = currentRole.inheritsFromId;
  }

  const responseData = {
    role: { id: role.id, name: role.name, displayName: role.displayName },
    resolvedFrom: resolvedFrom.reverse(), // Root first
    policies: Array.from(policyMap.values())
  };

  cache.set(cacheKey, { data: responseData, expires: Date.now() + 5 * 60 * 1000 });
  return responseData;
}

resolveRouter.get('/:orgId/resolve/:roleName', authOrApiKey, async (req, res) => {
  const { roleName, orgId } = req.params;
  
  const responseData = await resolveRolePolicies(orgId, roleName);
  
  if (!responseData) {
    return res.status(404).json({ error: 'Role not found' });
  }

  res.json(responseData);
});

const checkSchema = z.object({
  type: z.enum(['code', 'command']),
  content: z.string(),
  filePath: z.string().optional(),
  roleName: z.string()
});

resolveRouter.post('/:orgId/check', requireApiKey, validate(checkSchema), async (req, res) => {
  const { type, content, filePath, roleName } = req.body;
  const orgId = req.org!.id;

  const responseData = await resolveRolePolicies(orgId, roleName);
  if (!responseData) {
    return res.status(404).json({ error: 'Role not found' });
  }

  const { policies } = responseData;
  const violations: any[] = [];

  for (const policy of policies) {
    if (policy.evaluatorType === 'none' || !policy.evaluatorPattern) continue;

    let isViolation = false;

    if (type === 'code' && policy.evaluatorType === 'regex') {
      if (policy.name === 'no-console-log' && filePath?.includes('logger')) continue;

      const regex = new RegExp(policy.evaluatorPattern, policy.evaluatorFlags || '');
      if (regex.test(content)) {
        isViolation = true;
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
        setByDisplayName: policy.setByDisplayName
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
  }

  res.json({ passed: !hasErrors, violations });
});
