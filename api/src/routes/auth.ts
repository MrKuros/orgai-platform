import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { WorkOS } from '@workos-inc/node';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { requireAuth, requireApiKey } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';

export const authRouter = Router();

const workos = new WorkOS(process.env.WORKOS_API_KEY!);
const WORKOS_CLIENT_ID = process.env.WORKOS_CLIENT_ID!;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later.' }
});

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  orgName: z.string().min(1),
  orgSlug: z.string().min(1)
});

authRouter.post('/signup', authLimiter, validate(signupSchema), async (req, res) => {
  const { email, password, firstName, lastName, orgName, orgSlug } = req.body;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) return res.status(409).json({ error: 'Email already registered' });

  const existingOrg = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (existingOrg) return res.status(409).json({ error: 'Organization slug taken' });

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, passwordHash, firstName, lastName }
    });

    const org = await tx.organization.create({
      data: { name: orgName, slug: orgSlug }
    });

    await tx.membership.create({
      data: { orgId: org.id, userId: user.id, role: 'ORG_ADMIN' }
    });

    return { user, org };
  });

  await writeAuditLog({
    orgId: result.org.id,
    actorId: result.user.id,
    action: 'org.created',
    metadata: { orgName, orgSlug }
  });

  const fullUser = await prisma.user.findUnique({
    where: { id: result.user.id },
    include: { memberships: { include: { org: true } } }
  });

  const token = signToken({ userId: result.user.id, email: result.user.email });
  
  res.cookie('orgai_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
  res.status(201).json({
    token,
    user: fullUser,
    org: { id: result.org.id, name: result.org.name, slug: result.org.slug }
  });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

authRouter.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken({ userId: user.id, email: user.email });
  res.cookie('orgai_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
  res.json({ token, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } });
});

authRouter.get('/sso/:orgSlug', async (req, res) => {
  const { orgSlug } = req.params;

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    include: { ssoConfig: true }
  });

  if (!org) return res.status(404).json({ error: 'Organization not found' });
  if (!org.ssoConfig || !org.ssoConfig.connectionId) {
    return res.status(400).json({ error: 'SSO not configured for this organization' });
  }

  const authorizationUrl = workos.sso.getAuthorizationUrl({
    clientId: WORKOS_CLIENT_ID,
    redirectUri: process.env.WORKOS_REDIRECT_URI!,
    connection: org.ssoConfig.connectionId,
    state: orgSlug
  });

  res.redirect(authorizationUrl);
});

authRouter.get('/sso/callback', async (req, res) => {
  const code = req.query.code as string;
  const orgSlug = req.query.state as string;

  if (!code || !orgSlug) return res.status(400).json({ error: 'Missing code or state parameters' });

  try {
    const { profile } = await workos.sso.getProfileAndToken({
      code,
      clientId: WORKOS_CLIENT_ID
    });

    const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    let user = await prisma.user.findUnique({ where: { email: profile.email } });
    
    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          workosUserId: profile.id,
          firstName: profile.firstName || user.firstName,
          lastName: profile.lastName || user.lastName,
        }
      });
    } else {
      user = await prisma.user.create({
        data: {
          email: profile.email,
          workosUserId: profile.id,
          firstName: profile.firstName,
          lastName: profile.lastName,
        }
      });
    }

    const membership = await prisma.membership.findUnique({
      where: { orgId_userId: { orgId: org.id, userId: user.id } }
    });

    if (!membership) {
      await prisma.membership.create({
        data: { orgId: org.id, userId: user.id, role: 'MEMBER' }
      });
    }

    await writeAuditLog({
      orgId: org.id,
      actorId: user.id,
      action: 'auth.sso_login'
    });

    const token = signToken({ userId: user.id, email: user.email });
    res.cookie('orgai_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    res.json({ token, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName } });
  } catch (error) {
    res.status(500).json({ error: 'SSO login failed' });
  }
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie('orgai_session');
  res.json({ message: 'Logged out' });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const userWithMemberships = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: {
      memberships: {
        include: { org: true, assignedRole: true }
      }
    }
  });

  if (!userWithMemberships) return res.status(404).json({ error: 'User not found' });

  const { passwordHash, ...safeUser } = userWithMemberships;
  res.json({ user: safeUser });
});

// GET /v1/me/api  — API key identity lookup (for MCP / machine clients)
authRouter.get('/me/api', requireApiKey, (req, res) => {
  const org = req.org!;
  const key = req.apiKeyRecord!;
  res.json({
    orgId:    org.id,
    orgName:  org.name,
    orgSlug:  org.slug,
    keyName:  key.name,
    scopes:   key.scopes,
  });
});
