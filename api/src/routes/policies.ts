import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { authOrApiKey } from '../middleware/authOrApiKey';
import { writeAuditLog } from '../services/audit';
import { dispatchWebhook } from '../services/webhook';

export const policiesRouter = Router();

policiesRouter.get('/:orgId/policies', authOrApiKey, async (req, res) => {
  const policies = await prisma.policy.findMany({
    where: { orgId: req.params.orgId },
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

policiesRouter.post('/:orgId/policies', requireAuth, requireOrgRole('POLICY_ADMIN', 'ORG_ADMIN'), validate(createPolicySchema), async (req, res) => {
  const { roleIds, ...policyData } = req.body;

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

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'policy.created',
    resource: policy.id,
    metadata: { name: policy.name }
  });

  dispatchWebhook(req.org!.id, 'policy.updated', { policy });

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

policiesRouter.patch('/:orgId/policies/:policyId', requireAuth, requireOrgRole('POLICY_ADMIN', 'ORG_ADMIN'), validate(updatePolicySchema), async (req, res) => {
  const { policyId } = req.params;

  const policy = await prisma.policy.update({
    where: { id: policyId, orgId: req.org!.id },
    data: req.body
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'policy.updated',
    resource: policy.id
  });

  dispatchWebhook(req.org!.id, 'policy.updated', { policy });

  res.json({ policy });
});

policiesRouter.delete('/:orgId/policies/:policyId', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const { policyId } = req.params;

  await prisma.policy.delete({
    where: { id: policyId, orgId: req.org!.id }
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'policy.deleted',
    resource: policyId
  });

  res.status(204).send();
});
