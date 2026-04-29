import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export async function dispatchWebhook(
  orgId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: {
        orgId,
        active: true,
        events: { has: event }
      }
    });

    if (webhooks.length === 0) return;

    const body = JSON.stringify(payload);

    Promise.allSettled(
      webhooks.map(async (webhook) => {
        try {
          const signature = crypto
            .createHmac('sha256', webhook.secret)
            .update(body)
            .digest('hex');

          const response = await fetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-OrgAI-Event': event,
              'X-OrgAI-Signature': signature,
            },
            body,
          });

          if (!response.ok) {
            logger.warn(`Webhook dispatch failed for ${webhook.url}`, {
              status: response.status,
              event
            });
          }
        } catch (error) {
          logger.error(`Webhook delivery error for ${webhook.url}`, { error, event });
        }
      })
    );
  } catch (error) {
    logger.error('Failed to fetch webhooks for dispatch', { error, orgId, event });
  }
}
