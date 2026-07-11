import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { globalRateLimit, authRateLimit, apiKeyRateLimit } from './middleware/rateLimit';
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
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { mountMcpRoutes } from './mcp/routes';
import { swaggerSpec } from './swagger';

const app = express();

// Security
app.use(helmet());
app.use(cors({
  origin: [
    process.env.CORS_ORIGIN || 'http://localhost:3000',
    'https://app.orgai.dev',
    /\.vercel\.app$/
  ],
  credentials: true
}));

// Parsing
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// MCP SSE transport (must be after body parsing middleware)
mountMcpRoutes(app);

// Rate limiting
// Auth and API key endpoints get their own stricter limits (skip global).
// Global limit covers everything else under /v1.
app.use('/v1/auth', authRateLimit);
app.use('/v1/orgs/:orgId/api-keys', apiKeyRateLimit);
app.use('/v1', (req, res, next) => {
  // Skip global rate limit for paths already covered by stricter limiters
  if (req.path.startsWith('/auth') || req.path.match(/\/orgs\/[^/]+\/api-keys/)) {
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
