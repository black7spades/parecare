import { db } from '../config/database';
import { env } from '../config/env';
import type { Account } from '../types';

/**
 * Promote the account matching SUPER_ADMIN_EMAIL to super_admin.
 * Runs at startup so existing installs pick up the role after upgrading;
 * registration handles the case where the account doesn't exist yet.
 */
export async function ensureSuperAdmin(): Promise<void> {
  if (!env.SUPER_ADMIN_EMAIL) return;

  try {
    const account = await db<Account>('accounts').where({ email: env.SUPER_ADMIN_EMAIL }).first();
    if (!account) {
      console.log(`Super admin bootstrap: no account for ${env.SUPER_ADMIN_EMAIL} yet — it will be promoted on registration.`);
      return;
    }
    if (account.role !== 'super_admin') {
      await db('accounts').where({ id: account.id }).update({ role: 'super_admin', updated_at: db.fn.now() });
      console.log(`Super admin bootstrap: promoted ${env.SUPER_ADMIN_EMAIL} to super_admin.`);
    }
  } catch (err) {
    // Don't crash the API if migrations haven't run yet (the documented
    // setup order is `docker compose up` first, then `npm run migrate`).
    console.warn('Super admin bootstrap skipped (is the database migrated?):', (err as Error).message);
  }
}
