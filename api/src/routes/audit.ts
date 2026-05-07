import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { authOrApiKey } from '../middleware/authOrApiKey';

export const auditRouter = Router();

auditRouter.get('/:orgId/audit', authOrApiKey, requireOrgRole('ORG_ADMIN', 'POLICY_ADMIN'), async (req, res) => {
  if (req.apiKeyRecord) {
    if (!req.apiKeyRecord.scopes.includes('audit:read')) {
      return res.status(403).json({ error: 'Forbidden: Missing audit:read scope' });
    }
    if (req.org!.id !== req.params.orgId) {
      return res.status(403).json({ error: 'Forbidden: API key does not belong to this org' });
    }
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const action = req.query.action as string;
  const actorId = req.query.actorId as string;
  const from = req.query.from as string;
  const to = req.query.to as string;

  const where: any = { orgId: req.org!.id };

  if (action) where.action = action;
  if (actorId) where.actorId = actorId;
  
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const [total, data] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { actor: { select: { id: true, email: true, firstName: true, lastName: true } } }
    })
  ]);

  res.json({
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
});
