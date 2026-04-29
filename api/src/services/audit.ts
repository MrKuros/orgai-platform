import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export async function writeAuditLog(params: {
  orgId: string;
  actorId?: string;
  action: string;
  resource?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        orgId: params.orgId,
        actorId: params.actorId,
        action: params.action,
        resource: params.resource,
        metadata: (params.metadata || {}) as any,
      }
    });
  } catch (error) {
    logger.error('Failed to write audit log', { error, params });
  }
}
