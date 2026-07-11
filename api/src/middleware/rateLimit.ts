import rateLimit from 'express-rate-limit';

const message = { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later.' } };

// Global rate limit: 100 req/min per IP
export const globalRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per `window` (here, per 1 minute)
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

// API key endpoints: 60 req/min
export const apiKeyRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 requests per `window`
  standardHeaders: true,
  legacyHeaders: false,
  message,
});
