import rateLimit from 'express-rate-limit';

const message = { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' } };

// Each dashboard page view makes ~5-7 API calls, so 100/min per IP is tight
// even for one fast user and is instantly exhausted by e2e runs / hot reload.
// Generous outside production; RATE_LIMIT_GLOBAL_MAX overrides everywhere.
const globalMax =
  Number(process.env.RATE_LIMIT_GLOBAL_MAX) ||
  (process.env.NODE_ENV === 'production' ? 100 : 2000);

// Global rate limit per IP
export const globalRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: globalMax,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message,
});

// Auth endpoints: stricter 20 req/min
export const authRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Limit each IP to 20 requests per `window`
  standardHeaders: true,
  legacyHeaders: false,
  message,
});

// MCP transport endpoints: 120 req/min (agents make bursts of tool calls)
export const mcpRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});

// API key endpoints: 60 req/min
export const apiKeyRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 requests per `window`
  standardHeaders: true,
  legacyHeaders: false,
  message,
});
