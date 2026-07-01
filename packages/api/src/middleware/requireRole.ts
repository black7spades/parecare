import { Request, Response, NextFunction } from 'express';
import type { AccountRole } from '../types';

const ROLE_RANK: Record<AccountRole, number> = {
  user: 0,
  admin: 1,
  super_admin: 2,
};

export function roleAtLeast(role: AccountRole, minimum: AccountRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function requireRole(minimum: AccountRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.account) {
      res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
      return;
    }
    if (!roleAtLeast(req.account.role, minimum)) {
      res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
      return;
    }
    next();
  };
}
