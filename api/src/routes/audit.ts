import { AppError } from "../lib/AppError";
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { authOrApiKey } from '../middleware/authOrApiKey';

export const auditRouter = Router();

/**
 * @swagger
 * /v1/orgs/{orgId}/audit:
 *   get:
 *     summary: Get audit log entries (cursor-based pagination)
 *     tags: [Audit]
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
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Cursor for pagination (ID of the last entry from previous page)
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *       - in: query
 *         name: actorId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Audit log entries
 */
auditRouter.get('/:orgId/audit', authOrApiKey, requireOrgRole('ORG_ADMIN', 'POLICY_ADMIN'), async (req, res) => {
  if (req.apiKeyRecord) {
    if (!req.apiKeyRecord.scopes.includes('audit:read')) {
      throw new AppError(403, 'FORBIDDEN', 'Forbidden: Missing audit:read scope');
    }
    if (req.org!.id !== req.params.orgId) {
      throw new AppError(403, 'FORBIDDEN', 'Forbidden: API key does not belong to this org');
    }
  }

  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
  const action = req.query.action as string;
  const actorId = req.query.actorId as string;
  const from = req.query.from as string;
  const to = req.query.to as string;
  const cursor = req.query.cursor as string;

  const where: any = { orgId: req.org!.id };

  if (action) where.action = action;
  if (actorId) where.actorId = actorId;

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const findArgs: any = {
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    include: { actor: { select: { id: true, email: true, firstName: true, lastName: true } } }
  };

  if (cursor) {
    findArgs.cursor = { id: cursor };
    findArgs.skip = 1;
  }

  const data = await prisma.auditLog.findMany(findArgs);

  const hasMore = data.length > limit;
  const results = hasMore ? data.slice(0, limit) : data;

  let nextCursor: string | null = null;
  if (hasMore && results.length > 0) {
    nextCursor = results[results.length - 1].id;
  }

  res.json({
    data: results,
    nextCursor,
    hasMore
  });
});
