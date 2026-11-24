import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { db } from '../config/database';
import { env } from '../config/env';
import type { Account } from '../types';
import { isValidTimeZone } from '../lib/timezone';

/**
 * Personal access tokens (created under Account settings) authenticate
 * exactly like a session: bots and outside apps send them as the bearer
 * token. Only the hash is stored, and a revoked key stops immediately.
 */
async function authenticateApiKey(token: string, req: Request, res: Response, next: NextFunction): Promise<void> {
  const hash = createHash('sha256').update(token).digest('hex');
  const key = await db('api_keys').where({ token_hash: hash }).whereNull('revoked_at').first();
  if (!key) {
    res.status(401).json({ error: 'Invalid or revoked API key', code: 'UNAUTHORIZED' });
    return;
  }
  // A signed-in assistant's pass lasts a while and then renews itself.
  if (key.expires_at && new Date(key.expires_at).getTime() < Date.now()) {
    res.status(401).json({ error: 'This connection needs to sign in again.', code: 'UNAUTHORIZED' });
    return;
  }
  // A look-only connection can read anything its account can, and change
  // nothing. The assistant endpoint applies the same rule per tool, since
  // every call there is a POST.
  const access: 'full' | 'read' = key.access === 'read' ? 'read' : 'full';
  const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  if (access === 'read' && !safe && !req.originalUrl.startsWith('/api/v1/mcp')) {
    res.status(403).json({ error: 'This connection can only look at records, not change them.', code: 'READ_ONLY_CONNECTION' });
    return;
  }
  const account = await db<Account>('accounts').where({ id: key.account_id }).first();
  if (!account) {
    res.status(401).json({ error: 'Account not found', code: 'UNAUTHORIZED' });
    return;
  }
  if (account.disabled_at) {
    res.status(403).json({ error: 'This account has been disabled. Contact your administrator.', code: 'ACCOUNT_DISABLED' });
    return;
  }
  void db('api_keys')
    .where({ id: key.id })
    .update({ last_used_at: db.fn.now() })
    .catch(() => undefined);
  req.account = account;
  req.connectionAccess = access;
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header', code: 'UNAUTHORIZED' });
    return;
  }

  const token = authHeader.slice(7);
  if (token.startsWith('pc_')) {
    await authenticateApiKey(token, req, res, next);
    return;
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { accountId: string; purpose?: string; iat?: number };
    // Special-purpose tokens (MFA challenge, OAuth state) are not sessions
    if (payload.purpose) {
      res.status(401).json({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' });
      return;
    }
    const account = await db<Account>('accounts').where({ id: payload.accountId }).first();
    if (!account) {
      res.status(401).json({ error: 'Account not found', code: 'UNAUTHORIZED' });
      return;
    }
    // A disabled account keeps its data, but its sessions stop working
    // immediately, not just at the next sign-in.
    if (account.disabled_at) {
      res.status(403).json({ error: 'This account has been disabled. Contact your administrator.', code: 'ACCOUNT_DISABLED' });
      return;
    }
    // A password reset ends everything issued before it. Otherwise somebody
    // who reset because they were worried about who else was signed in would
    // have changed nothing for that person. Seconds, because that is the
    // resolution a JWT issued-at has.
    if (account.sessions_valid_from && payload.iat && payload.iat * 1000 < new Date(account.sessions_valid_from).getTime() - 1000) {
      res.status(401).json({ error: 'You were signed out when the password changed. Sign in again.', code: 'SESSION_ENDED' });
      return;
    }
    // An account that has never said where it is takes its zone from the
    // device it signs in on, so its reminders, dose times and whole-day
    // dates are worked out on its own clock rather than UTC.
    const zone = req.headers['x-time-zone'];
    if (!account.timezone && typeof zone === 'string' && isValidTimeZone(zone)) {
      account.timezone = zone;
      void db('accounts').where({ id: account.id }).whereNull('timezone').update({ timezone: zone }).catch(() => {});
    }
    req.account = account;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' });
  }
}
