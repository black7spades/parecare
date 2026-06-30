import { Request, Response, NextFunction } from 'express';

interface AppError extends Error {
  status?: number;
  code?: string;
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = err.status ?? 500;
  const code = err.code ?? 'INTERNAL_ERROR';

  if (status >= 500) {
    console.error('Unhandled error:', err);
  }

  res.status(status).json({
    error: err.message ?? 'An unexpected error occurred',
    code,
  });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' });
}
