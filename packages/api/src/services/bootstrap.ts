import path from 'path';
import { db } from '../config/database';
import { env } from '../config/env';
import type { Account } from '../types';

/**
 * Apply pending database migrations at startup. Resolving the directory
 * relative to __dirname makes this work both in development (src/…/*.ts
 * via ts-node) and in the production image (dist/…/*.js) — the compiled
 * image has no knexfile, so the knex CLI cannot be used there.
 */
export async function runMigrations(): Promise<void> {
  const directory = path.join(__dirname, '..', 'db', 'migrations');
  // Match this file's own extension so the compiled build only loads .js
  // (dist also contains .d.ts declaration files, which knex must not load).
  const loadExtensions = [path.extname(__filename)];
  const [batch, applied] = (await db.migrate.latest({ directory, loadExtensions })) as [number, string[]];
  if (applied.length > 0) {
    console.log(`Applied ${applied.length} database migration(s) (batch ${batch}):`);
    applied.forEach((m) => console.log(`  - ${m}`));
  } else {
    console.log('Database schema is up to date.');
  }
}

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
