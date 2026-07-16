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

// ponytail: per-process cache — with >1 API instance, other instances serve a
// stale policy set up to 5 min after an edit. Move to Redis/pg LISTEN if the
// platform ever runs multi-instance.
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

// Resolve one or more roles. `roleName` may be comma-separated
// ("payments-dev,security-champion") for members under multiple superiors —
// the result is the UNION of each role's inheritance chain. Name conflicts
// across branches resolve strictest-wins (ERROR beats WARNING): fail-closed.
export async function resolveRolePolicies(orgId: string, roleName: string) {
  // Sorted so "a,b" and "b,a" hit one cache entry and tie-breaks are deterministic.
  const names = roleName.split(',').map(n => n.trim()).filter(Boolean).sort();
  if (names.length === 0) return null;
  if (names.length === 1) return resolveSingleRole(orgId, names[0]);

  const cacheKey = `${orgId}:${names.join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const results = [];
  for (const name of names) {
    const r = await resolveSingleRole(orgId, name);
    if (!r) return null; // any unknown role → fail-closed, same as a single unknown role
    results.push(r);
  }

  const policyMap = new Map<string, any>();
  const resolvedFrom: string[] = [];
  const warnings: { policyName: string; overriddenByRole: string; originalRole: string }[] = [];

  for (const r of results) {
    for (const from of r.resolvedFrom) {
      if (!resolvedFrom.includes(from)) resolvedFrom.push(from);
    }
    warnings.push(...r.warnings);
    for (const policy of r.policies) {
      const existing = policyMap.get(policy.name);
      if (!existing) {
        policyMap.set(policy.name, policy);
        continue;
      }
      if (existing.id === policy.id) continue; // same policy via two branches — no conflict
      // Cross-branch name conflict: strictest wins. ENFORCED beats SHADOW
      // (a shadow policy must never displace real enforcement), then ERROR
      // beats WARNING.
      const rank = (p: any) => (p.status !== 'SHADOW' ? 2 : 0) + (p.severity === 'ERROR' ? 1 : 0);
      const winner = rank(policy) > rank(existing) ? policy : existing;
      const loser = winner === existing ? policy : existing;
      policyMap.set(policy.name, winner);
      warnings.push({
        policyName: policy.name,
        overriddenByRole: winner.setByRole,
        originalRole: loser.setByRole
      });
    }
  }

  // Shared ancestors produce identical override warnings via each chain — dedupe.
  const seenWarnings = new Set<string>();
  const dedupedWarnings = warnings.filter(w => {
    const key = `${w.policyName}|${w.overriddenByRole}|${w.originalRole}`;
    if (seenWarnings.has(key)) return false;
    seenWarnings.add(key);
    return true;
  });

  const responseData = {
    role: {
      id: results.map(r => r.role.id).join(','),
      name: names.join(','),
      displayName: results.map(r => r.role.displayName).join(' + ')
    },
    resolvedFrom,
    policies: Array.from(policyMap.values()),
    warnings: dedupedWarnings
  };

  cache.set(cacheKey, { data: responseData, expires: Date.now() + 5 * 60 * 1000 });
  return responseData;
}

async function resolveSingleRole(orgId: string, roleName: string) {
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
        // Ancestor-wins on name overrides — EXCEPT a SHADOW ancestor never
        // displaces an ENFORCED policy (that would silently turn real
        // enforcement off via a rollout flag). Fail-closed.
        if (binding.policy.status === 'SHADOW' && existingPolicy.status !== 'SHADOW') {
          continue;
        }
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
 *     summary: Resolve policies for a role (comma-separate for multiple roles — returns the union, strictest-wins on conflicts)
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
  const orgId = req.org!.id;

  // Member-bound keys resolve THEIR roles regardless of the path param — the
  // policies an agent loads must be the same set /check enforces. '_' is the
  // explicit "my roles" sentinel MCP clients send when no role is configured.
  const boundMember = req.apiKeyRecord?.member;
  const roleName = boundMember
    ? boundMember.assignedRoles.map(r => r.name).sort().join(',')
    : req.params.roleName;
  if (boundMember && !roleName) {
    throw new AppError(400, 'ERROR', 'This developer has no assigned roles — assign one in the dashboard first');
  }
  if (!boundMember && roleName === '_') {
    throw new AppError(400, 'ERROR', 'roleName is required when using an org-wide API key — or use a developer-bound key');
  }

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
  // Optional for member-bound keys — the member's assigned roles are used.
  roleName: z.string().optional()
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
 *             required: [type, content]
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
 *                 description: Required for org-wide API keys (400 without it). Ignored for developer-bound keys — the member's assigned roles always apply.
 *     responses:
 *       400:
 *         description: roleName missing on an org-wide key, or bound developer has no assigned roles
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
// Accepts API keys (agents, hook, CI) AND logged-in org members (the
// dashboard's live evaluator) — a bare 401 here used to nuke valid dashboard
// sessions via the client's 401-means-expired handler.
resolveRouter.post('/:orgId/check', authOrApiKey, requireOrgAccess, validate(checkSchema), async (req, res) => {
  const { type, content, filePath } = req.body;
  const orgId = req.org!.id;

  // A member-bound key ALWAYS checks as that member's assigned roles — a
  // client-supplied roleName must not be able to select a weaker policy set.
  const boundMember = req.apiKeyRecord?.member;
  const roleName: string | undefined = boundMember
    ? boundMember.assignedRoles.map(r => r.name).sort().join(',')
    : req.body.roleName;
  if (!roleName) {
    throw new AppError(400, 'ERROR', boundMember
      ? 'This developer has no assigned roles — assign one in the dashboard first'
      : 'roleName is required when using an org-wide API key');
  }
  // Attribution: developer-bound key -> that developer; JWT (dashboard
  // evaluator) -> the logged-in user; org-wide key -> unattributed.
  const actorId = boundMember?.userId ?? req.user?.id;

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
      // Exempt actual logger modules only — not any path containing "logger".
      if (policy.name === 'no-console-log' && filePath && /(^|\/)logg?er\.[jt]sx?$/i.test(filePath)) continue;

      const regex = new RegExp(policy.evaluatorPattern, policy.evaluatorFlags || '');
      const match = regex.exec(content);
      if (match) {
        isViolation = true;
        line = content.slice(0, match.index).split('\n').length;
      }
    } else if (type === 'command' && policy.evaluatorType === 'command') {
      const regex = new RegExp(policy.evaluatorPattern, policy.evaluatorFlags || '');
      if (regex.test(content)) {
        isViolation = true;
      }
    }

    if (isViolation) {
      const isShadow = policy.status === 'SHADOW';
      violations.push({
        policyId: policy.id,
        policyName: policy.name,
        rule: policy.rule,
        severity: policy.severity,
        fixSuggestion: policy.fixSuggestion,
        setByDisplayName: policy.setByDisplayName,
        line,
        ...(isShadow ? { shadow: true } : {})
      });

      if (isShadow) {
        // Shadow hits get their own audit action so an admin can measure a
        // policy's noise ("how often would this have blocked?") before enforcing.
        await writeAuditLog({
          orgId,
          actorId,
          action: 'policy.shadow_violated',
          metadata: {
            policyId: policy.id,
            policyName: policy.name,
            severity: policy.severity,
            roleName,
            filePath: filePath?.substring(0, 200)
          }
        });
      } else if (policy.severity === 'ERROR') {
        await writeAuditLog({
          orgId,
          actorId,
          action: 'policy.violated',
          metadata: { policyId: policy.id, contentSnippet: content.substring(0, 100) }
        });
      }
    }
  }

  // Shadow violations are reported but never block: passed considers only
  // enforced ERROR violations.
  const enforced = violations.filter(v => !v.shadow);
  const hasErrors = enforced.some(v => v.severity === 'ERROR');

  // Every check is audited — passed or not — so "show me all checks for
  // developer X" has an answer. ERROR violations additionally log policy.violated.
  await writeAuditLog({
    orgId,
    actorId,
    action: 'policy.checked',
    metadata: {
      roleName,
      type,
      filePath: filePath?.substring(0, 200),
      passed: !hasErrors,
      blockerCount: enforced.filter(v => v.severity === 'ERROR').length,
      warningCount: enforced.filter(v => v.severity === 'WARNING').length,
      shadowCount: violations.length - enforced.length
    }
  });

  if (hasErrors) {
    // SIEM/webhook consumers get real violations only — shadow hits stay in
    // the audit trail, they are not alerts.
    dispatchWebhook(orgId, 'policy.violated', { violations: enforced });
    broadcastViolation(orgId, { violations: enforced, timestamp: new Date().toISOString() });
  }

  res.json({ passed: !hasErrors, violations });
});

// Records a developer bypassing the pre-commit hook (COMPLY_SKIP=1) so the
// escape hatch is visible in the org audit trail. Fire-and-forget from the hook.
const hookSkipSchema = z.object({
  repo: z.string().max(200).optional(),
  actor: z.string().max(100).optional()
});
resolveRouter.post('/:orgId/hook-skip', requireApiKey, validate(hookSkipSchema), async (req, res) => {
  const boundMember = req.apiKeyRecord?.member;
  await writeAuditLog({
    orgId: req.org!.id,
    actorId: boundMember?.userId,
    action: 'hook.bypassed',
    metadata: { repo: req.body.repo, actor: boundMember?.user.email ?? req.body.actor }
  });
  res.status(204).send();
});
