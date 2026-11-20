import type { NextFunction, Request, Response } from 'express';

/**
 * A small per-address limit for pages anyone can open without a login, such
 * as a shared emergency sheet. Enough for a paramedic, a driver or a
 * receptionist to open and reopen a link; not enough to guess tokens.
 */
export function rateLimit(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      // Forget old addresses now and then, so the map stays small.
      if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > opts.max) {
      res.status(429).json({ error: 'This link has been opened a lot in a short time. Wait a minute, then try again.', code: 'RATE_LIMITED' });
      return;
    }
    next();
  };
}
