import { Request, Response, NextFunction } from 'express';
import { requireAuth, requireApiKey } from './auth';

export function authOrApiKey(req: Request, res: Response, next: NextFunction) {
  // Check for API key first — it's the most explicit auth mechanism
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    return requireApiKey(req, res, next);
  }

  // Fall back to session cookie or Bearer token
  const token = req.cookies?.orgai_session || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null);
  if (token) {
    return requireAuth(req, res, next);
  }

  // No auth provided at all — let requireApiKey handle the 401
  return requireApiKey(req, res, next);
}
