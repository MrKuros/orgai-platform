import { logger } from '../lib/logger';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'OrgAI <noreply@orgai.dev>';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://app.orgai.dev';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * Sends via Resend. When RESEND_API_KEY is unset (local dev), logs the email
 * instead of sending so flows remain testable without an account.
 */
export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<void> {
  if (!RESEND_API_KEY) {
    logger.info(`[email disabled] to=${to} subject="${subject}"`);
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html })
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error(`Resend API error ${res.status}: ${body}`);
    }
  } catch (err) {
    // Email failures must never fail the triggering request
    logger.error(`Failed to send email to ${to}: ${err}`);
  }
}

function layout(content: string): string {
  return `
  <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #1a1a2e;">
    <div style="font-size: 20px; font-weight: 700; margin-bottom: 24px;">OrgAI</div>
    ${content}
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
    <p style="font-size: 12px; color: #6b7280;">OrgAI — AI compliance for engineering teams · <a href="https://orgai.dev" style="color: #6b7280;">orgai.dev</a></p>
  </div>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display: inline-block; background: #4f46e5; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600;">${label}</a>`;
}

export async function sendInviteEmail(to: string, orgName: string, inviterName: string, token: string): Promise<void> {
  const link = `${DASHBOARD_URL}/accept-invite?token=${token}`;
  await sendEmail({
    to,
    subject: `You've been invited to ${orgName} on OrgAI`,
    html: layout(`
      <p>${inviterName} invited you to join <strong>${orgName}</strong> on OrgAI.</p>
      <p>OrgAI enforces your organization's coding policies across every AI coding agent your team uses.</p>
      <p style="margin: 24px 0;">${button(link, 'Accept invite')}</p>
      <p style="font-size: 13px; color: #6b7280;">This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
    `)
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${DASHBOARD_URL}/reset-password?token=${token}`;
  await sendEmail({
    to,
    subject: 'Reset your OrgAI password',
    html: layout(`
      <p>We received a request to reset your OrgAI password.</p>
      <p style="margin: 24px 0;">${button(link, 'Reset password')}</p>
      <p style="font-size: 13px; color: #6b7280;">This link expires in 1 hour. If you didn't request this, you can ignore this email — your password is unchanged.</p>
    `)
  });
}
