import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/database';
import { env } from '../config/env';
import type { Account } from '../types';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header', code: 'UNAUTHORIZED' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { accountId: string; purpose?: string };
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
    req.account = account;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' });
  }
}
