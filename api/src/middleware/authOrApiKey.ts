import { Request, Response, NextFunction } from 'express';
import { requireAuth, requireApiKey } from './auth';

export function authOrApiKey(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.orgai_session || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null);
  
  if (token) {
    return requireAuth(req, res, next);
  }
  
  return requireApiKey(req, res, next);
}
