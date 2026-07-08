import { Request, Response, NextFunction } from 'express';
import type { Account } from '../types';

/**
 * Gate a route on a per-account right. Rights are individual boolean
 * columns on the account, granted and revoked by administrators; platform
 * admins and super admins always pass.
 */

type RightField = 'can_create_care_profiles' | 'can_invite_members' | 'can_use_ai' | 'can_export_data';

const RIGHT_MESSAGES: Record<RightField, { code: string; message: string }> = {
  can_create_care_profiles: {
    code: 'PROFILE_CREATION_NOT_ALLOWED',
    message: 'Your account cannot create care profiles. Ask an administrator to enable it.',
  },
  can_invite_members: {
    code: 'INVITING_NOT_ALLOWED',
    message: 'Your account cannot invite people. Ask an administrator to enable it.',
  },
  can_use_ai: {
    code: 'AI_NOT_ALLOWED',
    message: 'Your account cannot use the AI assistant. Ask an administrator to enable it.',
  },
  can_export_data: {
    code: 'EXPORT_NOT_ALLOWED',
    message: 'Your account cannot export data. Ask an administrator to enable it.',
  },
};

export function accountHasRight(account: Account, right: RightField): boolean {
  if (account.role === 'admin' || account.role === 'super_admin') return true;
  return !!account[right];
}

export function requireAccountRight(right: RightField) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.account) {
      res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
      return;
    }
    if (!accountHasRight(req.account, right)) {
      const { code, message } = RIGHT_MESSAGES[right];
      res.status(403).json({ error: message, code });
      return;
    }
    next();
  };
}
