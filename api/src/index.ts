import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { globalRateLimit, authRateLimit, apiKeyRateLimit, mcpRateLimit } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth';
import { orgsRouter } from './routes/orgs';
import { rolesRouter } from './routes/roles';
import { policiesRouter } from './routes/policies';
import { membersRouter } from './routes/members';
import { apiKeysRouter } from './routes/apiKeys';
import { resolveRouter } from './routes/resolve';
import { auditRouter } from './routes/audit';
import { webhooksRouter } from './routes/webhooks';
import { ssoRouter } from './routes/sso';
import { setupRouter } from './routes/setup';
import { violationsFeedRouter } from './routes/violations';
import { policyPacksRouter, policyPacksImportRouter } from './routes/policyPacks';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { mountMcpRoutes } from './mcp/routes';
import { swaggerSpec } from './swagger';

const app = express();

// Behind Render/proxy: trust N hops so rate limits see the real client IP.
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 1);

// Security
app.use(helmet());
// Credentialed CORS must pin to exact origins — no wildcards. Dashboard origin
// comes from env; localhost is allowed for dev only.
const corsOrigins = [process.env.CORS_ORIGIN || process.env.DASHBOARD_URL || 'https://app.orgai.dev'];
if (process.env.NODE_ENV !== 'production') {
  corsOrigins.push('http://localhost:3000');
}
app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

// Parsing
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// MCP SSE transport (must be after body parsing middleware).
// Rate-limit before mounting: these endpoints run tools on the server's own
// COMPLY_API_KEY in API mode, so an unlimited caller could drain the org API.
app.use(['/mcp', '/mcp/sse', '/mcp/messages'], mcpRateLimit);
mountMcpRoutes(app);

// Rate limiting
// Credential endpoints (the brute-force surface) get the strict auth limit.
// Token-authenticated calls like /auth/me run on every page load for every
// user — under the strict limit a single office IP would exhaust it and lock
// everyone out of login, so those fall through to the global limit instead.
const isCredentialAuthPath = (p: string) =>
  ['/signup', '/login', '/forgot-password', '/reset-password'].includes(p) || p.startsWith('/sso');
app.use('/v1/auth', (req, res, next) =>
  isCredentialAuthPath(req.path) ? authRateLimit(req, res, next) : next());
app.use('/v1/orgs/:orgId/api-keys', apiKeyRateLimit);
app.use('/v1', (req, res, next) => {
  // Skip global rate limit for paths already covered by stricter limiters
  if ((req.path.startsWith('/auth/') && isCredentialAuthPath(req.path.slice('/auth'.length))) || req.path.match(/\/orgs\/[^/]+\/api-keys/)) {
    return next();
  }
  return globalRateLimit(req, res, next);
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/', (req, res) => res.json({ status: 'ok' }));

// Human-readable status for admins/IT ("is every part of the box working?")
app.get('/status', async (req, res) => {
  let database = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'unreachable';
  }
  res.json({
    status: database === 'ok' ? 'ok' : 'degraded',
    version: process.env.npm_package_version || '0.1.0',
    database,
    email: process.env.RESEND_API_KEY ? 'configured' : 'log-only',
    mcp: process.env.COMPLY_API_KEY ? 'api mode (org policies + audit)' : 'standalone (bundled policies)',
    timestamp: new Date().toISOString(),
  });
});

// Swagger docs
app.get('/v1/docs/openapi.json', (req, res) => res.json(swaggerSpec));
app.use('/v1/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customCss: '.swagger-ui .topbar { display: none }' }));

// Routes
app.use('/v1/auth', authRouter);
app.use('/v1/orgs', orgsRouter);
app.use('/v1/orgs', rolesRouter);
app.use('/v1/orgs', policiesRouter);
app.use('/v1', policyPacksRouter);
app.use('/v1/orgs', policyPacksImportRouter);
app.use('/v1/orgs', membersRouter);
app.use('/v1/orgs', apiKeysRouter);
app.use('/v1/orgs', resolveRouter);
app.use('/v1/orgs', auditRouter);
app.use('/v1/orgs', webhooksRouter);
app.use('/v1/orgs', ssoRouter);
app.use('/v1/orgs', violationsFeedRouter);
app.use('/', setupRouter);

// Global error handler
app.use(errorHandler);

const PORT = process.env.PORT || 80;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`OrgAI API running on port ${PORT}`);
  });
}

export default app;
