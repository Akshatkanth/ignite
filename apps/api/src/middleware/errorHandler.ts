import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, `${resource} not found`, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
  }
}

// ─── Global Error Handler ─────────────────────────────────────────────────────

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // Known application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // Prisma unique constraint violation
  if (err.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as { code?: string; meta?: { target?: string[]; modelName?: string } };
    if (prismaErr.code === 'P2002') {
      const field = prismaErr.meta?.target?.[0] ?? 'field';
      res.status(409).json({
        success: false,
        error: `A record with this ${field} already exists`,
        code: 'CONFLICT',
      });
      return;
    }

    // Table/model not found: database schema likely not pushed yet.
    if (prismaErr.code === 'P2021') {
      const modelName = prismaErr.meta?.modelName ?? 'required tables';
      res.status(500).json({
        success: false,
        error: `Database schema is not initialized (${modelName}). Please apply Prisma schema and retry.`,
        code: 'DB_SCHEMA_NOT_INITIALIZED',
      });
      return;
    }

    if (prismaErr.code === 'P1001') {
      res.status(503).json({
        success: false,
        error: 'Database is unreachable. Please try again shortly.',
        code: 'DB_UNREACHABLE',
      });
      return;
    }
  }

  // Prisma initialization errors usually indicate connectivity/config issues.
  if (err.constructor.name === 'PrismaClientInitializationError') {
    res.status(503).json({
      success: false,
      error: 'Database initialization failed. Check database configuration and connectivity.',
      code: 'DB_INIT_FAILED',
    });
    return;
  }

  // Unknown errors — log full stack in development
  logger.error({ err, url: req.url, method: req.method }, 'Unhandled error');

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}

// ─── 404 Handler ─────────────────────────────────────────────────────────────

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
    code: 'ROUTE_NOT_FOUND',
  });
}
