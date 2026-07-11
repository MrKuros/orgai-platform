import { AppError } from "../lib/AppError";
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { WorkOS } from '@workos-inc/node';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { requireAuth, requireApiKey } from '../middleware/auth';
import { writeAuditLog } from '../services/audit';
import { createAuthToken, consumeAuthToken } from '../services/authTokens';
import { sendPasswordResetEmail } from '../services/email';

export const authRouter = Router();

// WorkOS SSO is optional — lazy-init so the API boots without SSO configured.
const WORKOS_CLIENT_ID = process.env.WORKOS_CLIENT_ID || '';
let _workos: WorkOS | null = null;
function getWorkos(): WorkOS {
  if (!process.env.WORKOS_API_KEY || !WORKOS_CLIENT_ID) {
    throw new AppError(501, 'SSO_DISABLED', 'SSO is not configured on this deployment');
  }
  if (!_workos) _workos = new WorkOS(process.env.WORKOS_API_KEY);
  return _workos;
}

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  orgName: z.string().min(1),
  orgSlug: z.string().min(1)
});

/**
 * @swagger
 * /v1/auth/signup:
 *   post:
 *     summary: Register a new user and organization
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, firstName, lastName, orgName, orgSlug]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               orgName:
 *                 type: string
 *               orgSlug:
 *                 type: string
 *     responses:
 *       201:
 *         description: User and organization created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 org:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     name:
 *                       type: string
 *                     slug:
 *                       type: string
 *       409:
 *         description: Email or orgSlug already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppError'
 */
authRouter.post('/signup', validate(signupSchema), async (req, res) => {
  const { email, password, firstName, lastName, orgName, orgSlug } = req.body;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) throw new AppError(409, 'ERROR', 'Email already registered');

  const existingOrg = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (existingOrg) throw new AppError(409, 'ERROR', 'Organization slug taken');

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
  
  res.cookie('orgai_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });
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

/**
 * @swagger
 * /v1/auth/login:
 *   post:
 *     summary: Authenticate user with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 org:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     name:
 *                       type: string
 *                     slug:
 *                       type: string
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppError'
 */
authRouter.post('/login', validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ 
    where: { email },
    include: { memberships: { include: { org: true } } }
  });
  if (!user || !user.passwordHash) throw new AppError(401, 'ERROR', 'Invalid credentials');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new AppError(401, 'ERROR', 'Invalid credentials');

  const token = signToken({ userId: user.id, email: user.email });
  res.cookie('orgai_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });
  
  const org = user.memberships[0]?.org;
  res.json({
    token,
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, memberships: user.memberships },
    org: org ? { id: org.id, name: org.name, slug: org.slug } : undefined
  });
});

/**
 * @swagger
 * /v1/auth/sso/{orgSlug}:
 *   get:
 *     summary: Initiate SSO login for an organization
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: orgSlug
 *         required: true
 *         schema:
 *           type: string
 *         description: Organization slug
 *     responses:
 *       302:
 *         description: Redirect to SSO provider
 *       400:
 *         description: SSO not configured for organization
 *       404:
 *         description: Organization not found
 */
authRouter.get('/sso/:orgSlug', async (req, res) => {
  const { orgSlug } = req.params;

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    include: { ssoConfig: true }
  });

  if (!org) throw new AppError(404, 'ERROR', 'Organization not found');
  if (!org.ssoConfig || !org.ssoConfig.connectionId) {
    throw new AppError(400, 'ERROR', 'SSO not configured for this organization');
  }

  const authorizationUrl = getWorkos().sso.getAuthorizationUrl({
    clientId: WORKOS_CLIENT_ID,
    redirectUri: process.env.WORKOS_REDIRECT_URI!,
    connection: org.ssoConfig.connectionId,
    state: orgSlug
  });

    res.redirect(authorizationUrl);
});

/**
 * @swagger
 * /v1/auth/sso/callback:
 *   get:
 *     summary: Handle SSO callback from WorkOS
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Authorization code from SSO provider
 *       - in: query
 *         name: state
 *         required: true
 *         schema:
 *           type: string
 *         description: Organization slug (state parameter)
 *     responses:
 *       200:
 *         description: SSO login successful
 *       400:
 *         description: Missing code or state parameters
 *       500:
 *         description: SSO login failed
 */
authRouter.get('/sso/callback', async (req, res) => {
  const code = req.query.code as string;
  const orgSlug = req.query.state as string;

  if (!code || !orgSlug) throw new AppError(400, 'ERROR', 'Missing code or state parameters');

  try {
    const { profile } = await getWorkos().sso.getProfileAndToken({
      code,
      clientId: WORKOS_CLIENT_ID
    });

    const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) throw new AppError(404, 'ERROR', 'Organization not found');

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
    res.cookie('orgai_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });
    
    // Fetch full user with memberships to get the org
    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { memberships: { include: { org: true } } }
    });
    
    res.json({ 
      token, 
      user: fullUser,
      org: { id: org.id, name: org.name, slug: org.slug }
    });
  } catch (error) {
    throw new AppError(500, 'ERROR', 'SSO login failed');
  }
});

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

/**
 * @swagger
 * /v1/auth/forgot-password:
 *   post:
 *     summary: Request a password reset email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Always returns 200 to avoid leaking which emails exist
 */
authRouter.post('/forgot-password', validate(forgotPasswordSchema), async (req, res) => {
  const { email } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const token = await createAuthToken(user.id, 'PASSWORD_RESET');
    await sendPasswordResetEmail(email, token);
  }

  res.json({ message: 'If that email is registered, a reset link has been sent.' });
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8)
});

/**
 * @swagger
 * /v1/auth/reset-password:
 *   post:
 *     summary: Set a new password using a reset or invite token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password set; returns a session like login
 *       400:
 *         description: Invalid or expired token
 */
authRouter.post('/reset-password', validate(resetPasswordSchema), async (req, res) => {
  const { token, password } = req.body;

  const record = await consumeAuthToken(token);
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.update({
    where: { id: record.userId },
    data: { passwordHash },
    include: { memberships: { include: { org: true } } }
  });

  if (record.orgId) {
    await writeAuditLog({
      orgId: record.orgId,
      actorId: user.id,
      action: record.type === 'INVITE' ? 'member.invite_accepted' : 'auth.password_reset'
    });
  }

  const sessionToken = signToken({ userId: user.id, email: user.email });
  res.cookie('orgai_session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });

  const org = user.memberships[0]?.org;
  res.json({
    token: sessionToken,
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, memberships: user.memberships },
    org: org ? { id: org.id, name: org.name, slug: org.slug } : undefined
  });
});

/**
 * @swagger
 * /v1/auth/logout:
 *   post:
 *     summary: Log out current user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
authRouter.post('/logout', (req, res) => {
  res.clearCookie('orgai_session');
  res.json({ message: 'Logged out' });
});

/**
 * @swagger
 * /v1/auth/me:
 *   get:
 *     summary: Get current authenticated user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 */
authRouter.get('/me', requireAuth, async (req, res) => {
  const userWithMemberships = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: {
      memberships: {
        include: { org: true, assignedRole: true }
      }
    }
  });

  if (!userWithMemberships) throw new AppError(404, 'ERROR', 'User not found');

  const { passwordHash, ...safeUser } = userWithMemberships;
  res.json({ user: safeUser });
});

/**
 * @swagger
 * /v1/auth/me/api:
 *   get:
 *     summary: Get API key identity (for MCP/machine clients)
 *     tags: [Auth]
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: API key identity data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orgId:
 *                   type: string
 *                   format: uuid
 *                 orgName:
 *                   type: string
 *                 orgSlug:
 *                   type: string
 *                 keyName:
 *                   type: string
 *                 scopes:
 *                   type: array
 *                   items:
 *                     type: string
 */
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
