import { AppError } from "../lib/AppError";
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';

export const orgsRouter = Router();

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
  slug: z.string().min(1).optional()
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
  const { name, slug } = req.body;

  try {
    const org = await prisma.organization.update({
      where: { id: req.org!.id },
      data: { name, slug }
    });

    await writeAuditLog({
      orgId: org.id,
      actorId: req.user!.id,
      action: 'org.updated',
      metadata: { name, slug }
    });

    res.json({ org });
  } catch (error) {
    throw new AppError(409, 'ERROR', 'Organization slug might be taken');
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
