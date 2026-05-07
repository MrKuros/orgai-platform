import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
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
import { logger } from './lib/logger';

const app = express();

// Security
app.use(helmet());
app.use(cors({
  origin: [
    process.env.CORS_ORIGIN || 'http://localhost:3000',
    'https://app.orgai.dev'
  ],
  credentials: true
}));

// Parsing
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Rate limiting
app.use('/v1', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  message: { error: 'Too many requests, please try again later.' }
}));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/', (req, res) => res.json({ status: 'ok' }));

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

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(err.message, { stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 80;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`OrgAI API running on port ${PORT}`);
  });
}

export default app;
