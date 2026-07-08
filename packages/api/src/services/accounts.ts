import bcrypt from 'bcrypt';
import { db } from '../config/database';
import { env } from '../config/env';
import type { Account, AccountRole } from '../types';

/**
 * The one and only way an account comes into existence. Self-serve
 * registration, accepting an invitation, and admin user creation all go
 * through here, so the rules hold everywhere: emails are lowercased and
 * unique across all accounts (backed by a case-insensitive unique index),
 * passwords are bcrypt-hashed, and the configured super admin email is
 * promoted automatically.
 */

export class AccountError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function findAccountByEmail(email: string): Promise<Account | undefined> {
  return db<Account>('accounts').whereRaw('lower(email) = ?', [email.trim().toLowerCase()]).first();
}

export interface AccountNameParts {
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
}

export function splitDisplayName(display: string): AccountNameParts {
  const words = display.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: words[0] ?? null,
    middle_name: words.length > 2 ? words.slice(1, -1).join(' ') : null,
    last_name: words.length > 1 ? words[words.length - 1] : null,
  };
}

export function composeDisplayName(parts: AccountNameParts): string {
  return [parts.first_name, parts.middle_name, parts.last_name]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

export async function createAccount(opts: {
  email: string;
  password: string;
  /** Structured name parts; first name is what matters. */
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  /** Back-compat: a single display name, split into parts when no first name is given. */
  display_name?: string;
  role?: AccountRole;
  /**
   * Whether this account may create care profiles of its own. Self-serve
   * registration says yes; invite acceptance says no (helpers join other
   * people's circles); admins decide per account they create.
   */
  can_create_care_profiles?: boolean;
  can_invite_members?: boolean;
  can_use_ai?: boolean;
  can_export_data?: boolean;
}): Promise<Account> {
  const email = opts.email.trim().toLowerCase();

  if (await findAccountByEmail(email)) {
    throw new AccountError(409, 'DUPLICATE_EMAIL', 'An account with this email already exists');
  }

  const blank = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim();
    return t === '' ? null : t;
  };
  let parts: AccountNameParts = {
    first_name: blank(opts.first_name),
    middle_name: blank(opts.middle_name),
    last_name: blank(opts.last_name),
  };
  if (!parts.first_name) {
    const legacy = blank(opts.display_name);
    if (!legacy) throw new AccountError(400, 'VALIDATION_ERROR', 'A first name is required');
    parts = splitDisplayName(legacy);
  }

  const password_hash = await bcrypt.hash(opts.password, 12);
  const role: AccountRole = env.SUPER_ADMIN_EMAIL === email ? 'super_admin' : (opts.role ?? 'user');

  try {
    const [account] = await db<Account>('accounts')
      .insert({
        email,
        password_hash,
        ...parts,
        display_name: composeDisplayName(parts),
        role,
        can_create_care_profiles: opts.can_create_care_profiles ?? true,
        can_invite_members: opts.can_invite_members ?? true,
        can_use_ai: opts.can_use_ai ?? true,
        can_export_data: opts.can_export_data ?? true,
      })
      .returning('*');
    return account;
  } catch (err) {
    // The unique index is the real guarantee; a concurrent registration
    // loses the race here instead of creating a duplicate.
    if ((err as { code?: string }).code === '23505') {
      throw new AccountError(409, 'DUPLICATE_EMAIL', 'An account with this email already exists');
    }
    throw err;
  }
}

/** Disabled accounts stay in the database with all their history, but cannot sign in. */
export function assertNotDisabled(account: Account): void {
  if (account.disabled_at) {
    throw new AccountError(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Contact your administrator.');
  }
}
