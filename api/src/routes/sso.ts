import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import { WorkOS } from '@workos-inc/node';
import { AppError } from '../lib/AppError';

export const ssoRouter = Router();

// WorkOS SSO is optional — lazy-init so the API boots without SSO configured.
let _workos: WorkOS | null = null;
function getWorkos(): WorkOS {
  if (!process.env.WORKOS_API_KEY) {
    throw new AppError(501, 'SSO_DISABLED', 'SSO is not configured on this deployment');
  }
  if (!_workos) _workos = new WorkOS(process.env.WORKOS_API_KEY);
  return _workos;
}

/**
 * @swagger
 * /v1/orgs/{orgId}/sso:
 *   get:
 *     summary: Get SSO configuration
 *     tags: [SSO]
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
 *         description: SSO configuration
 */
ssoRouter.get('/:orgId/sso', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const ssoConfig = await prisma.ssoConfig.findUnique({
    where: { orgId: req.org!.id },
    select: {
      id: true,
      provider: true,
      createdAt: true,
      updatedAt: true
    }
  });
  res.json({ ssoConfig });
});

const upsertSsoSchema = z.object({
  provider: z.string().min(1),
  workosOrgId: z.string().min(1),
  connectionId: z.string().min(1)
});

/**
 * @swagger
 * /v1/orgs/{orgId}/sso:
 *   put:
 *     summary: Create or update SSO configuration
 *     tags: [SSO]
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
 *             required: [provider, workosOrgId, connectionId]
 *             properties:
 *               provider:
 *                 type: string
 *               workosOrgId:
 *                 type: string
 *               connectionId:
 *                 type: string
 *     responses:
 *       200:
 *         description: SSO configuration updated
 */
ssoRouter.put('/:orgId/sso', requireAuth, requireOrgRole('ORG_ADMIN'), validate(upsertSsoSchema), async (req, res) => {
  const { provider, workosOrgId, connectionId } = req.body;

  const ssoConfig = await prisma.ssoConfig.upsert({
    where: { orgId: req.org!.id },
    update: { provider, workosOrgId, connectionId },
    create: {
      orgId: req.org!.id,
      provider,
      workosOrgId,
      connectionId
    }
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'sso.configured',
    metadata: { provider }
  });

  res.json({
    ssoConfig: {
      id: ssoConfig.id,
      provider: ssoConfig.provider,
      createdAt: ssoConfig.createdAt,
      updatedAt: ssoConfig.updatedAt
    }
  });
});

/**
 * @swagger
 * /v1/orgs/{orgId}/sso:
 *   delete:
 *     summary: Remove SSO configuration
 *     tags: [SSO]
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
 *         description: SSO configuration removed
 */
ssoRouter.delete('/:orgId/sso', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  await prisma.ssoConfig.delete({
    where: { orgId: req.org!.id }
  });

  await writeAuditLog({
    orgId: req.org!.id,
    actorId: req.user!.id,
    action: 'sso.removed'
  });

  res.status(204).send();
});

/**
 * @swagger
 * /v1/orgs/{orgId}/sso/test:
 *   post:
 *     summary: Test SSO connection
 *     tags: [SSO]
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
 *         description: Test result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *       404:
 *         description: SSO not configured
 */
ssoRouter.post('/:orgId/sso/test', requireAuth, requireOrgRole('ORG_ADMIN'), async (req, res) => {
  const ssoConfig = await prisma.ssoConfig.findUnique({
    where: { orgId: req.org!.id }
  });

  if (!ssoConfig) {
    throw new AppError(404, 'NOT_FOUND', 'SSO not configured for this organization');
  }

  try {
    // Use the WorkOS API to verify the connection exists and is active.
    // This works for both SAML and OIDC providers because WorkOS manages
    // the connection lifecycle regardless of protocol.
    if (!ssoConfig.connectionId) {
      return res.json({ success: false, error: 'No connection ID configured' });
    }

    const connection = await getWorkos().sso.getConnection(ssoConfig.connectionId);

    if (!connection) {
      return res.json({ success: false, error: 'Connection not found in WorkOS' });
    }

    if (connection.state !== 'active') {
      return res.json({
        success: false,
        error: `Connection is not active. Current state: ${connection.state}`
      });
    }

    res.json({ success: true });
  } catch (error) {
    res.json({
      success: false,
      error: error instanceof Error ? error.message : 'Connection test failed'
    });
  }
});
