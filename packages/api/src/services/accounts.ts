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

export async function createAccount(opts: {
  email: string;
  password: string;
  display_name: string;
  role?: AccountRole;
}): Promise<Account> {
  const email = opts.email.trim().toLowerCase();

  if (await findAccountByEmail(email)) {
    throw new AccountError(409, 'DUPLICATE_EMAIL', 'An account with this email already exists');
  }

  const password_hash = await bcrypt.hash(opts.password, 12);
  const role: AccountRole = env.SUPER_ADMIN_EMAIL === email ? 'super_admin' : (opts.role ?? 'user');

  try {
    const [account] = await db<Account>('accounts')
      .insert({ email, password_hash, display_name: opts.display_name, role })
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
