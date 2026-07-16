import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/AppError';
import { logger } from '../lib/logger';
import { ZodError } from 'zod';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.errors,
      },
    });
    return;
  }

  // Prisma "record not found" on update/delete — a missing resource is a 404,
  // not a 500 (e.g. PATCH a member that was removed mid-flight).
  if ((err as any)?.code === 'P2025') {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
    return;
  }

  logger.error(err.message, { stack: err.stack });
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    },
  });
}
