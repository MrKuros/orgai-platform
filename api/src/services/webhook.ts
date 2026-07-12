import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

// Blocks webhook delivery to private/loopback/link-local hosts (SSRF guard).
// ponytail: hostname/literal-IP check only; does not resolve DNS. A hostname
// that resolves to a private IP still slips through — add DNS resolution +
// re-check if that threat matters for this deployment.
function isBlockedWebhookHost(rawUrl: string): boolean {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return true; // unparseable URL — block it
  }
  host = host.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true;
  // IPv4 literal ranges: 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 0.0.0.0
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

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
          if (isBlockedWebhookHost(webhook.url)) {
            logger.warn(`Webhook blocked (SSRF guard) for ${webhook.url}`, { event });
            return;
          }

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
