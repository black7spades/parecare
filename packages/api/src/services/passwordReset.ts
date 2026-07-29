import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { db } from '../config/database';
import { env } from '../config/env';
import { findAccountByEmail } from './accounts';
import { sendPasswordResetEmail, sendOAuthReminderEmail } from './email';
import type { Account } from '../types';

/**
 * Forgetting a password, and getting back in.
 *
 * Two rules shape all of this. The first is that the answer to "does this
 * address have an account" must never differ, whoever is asking, because
 * that question is how a stranger finds out who uses a care system. So every
 * request gets the same reply and the same timing, and what actually happens
 * afterwards depends on facts the asker never sees.
 *
 * The second is that a reset has to end sessions. Somebody resetting a
 * password is often doing it because they are worried, and a reset that
 * leaves whoever else may be signed in still signed in has not helped them.
 */

const LINK_MINUTES = 60;
// Long enough to be unguessable, short enough to survive an email client
// that decides to wrap the line.
const TOKEN_BYTES = 32;
// One live link at a time per person, so asking twice in a panic does not
// fill an inbox or leave several working links lying around.
const RESEND_AFTER_MS = 2 * 60_000;

const hashOf = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export function resetUrl(token: string): string {
  return `${env.APP_URL}/reset-password/${token}`;
}

/**
 * Start a reset. Returns nothing useful on purpose: the caller must not be
 * able to tell an address that has an account from one that does not.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const clean = email.trim().toLowerCase();
  const account = await findAccountByEmail(clean);
  if (!account) return;

  // A disabled account is not getting back in by resetting a password, and
  // sending the link would only imply otherwise.
  if (account.disabled_at) return;

  // Somebody who signs in with Google has no password to reset. Telling them
  // that is far kinder than a link that sets one they will never use.
  if (!account.password_hash) {
    await sendOAuthReminderEmail(account.email, account.display_name, account.oauth_provider ?? 'google').catch((err) =>
      console.warn('Sign-in reminder email failed:', (err as Error).message)
    );
    return;
  }

  const recent = await db('password_resets')
    .where({ account_id: account.id })
    .whereNull('used_at')
    .where('created_at', '>', new Date(Date.now() - RESEND_AFTER_MS))
    .first();
  if (recent) return;

  // Any earlier link stops working, so there is only ever one way in.
  await db('password_resets').where({ account_id: account.id }).whereNull('used_at').update({ used_at: db.fn.now() });

  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  await db('password_resets').insert({
    account_id: account.id,
    token_hash: hashOf(token),
    expires_at: new Date(Date.now() + LINK_MINUTES * 60_000),
  });

  await sendPasswordResetEmail(account.email, account.display_name, resetUrl(token), LINK_MINUTES);
}

export interface ResetCheck {
  valid: boolean;
  /** Shown so somebody with two addresses knows which one they are fixing. */
  email?: string;
}

export async function checkResetToken(token: string): Promise<ResetCheck> {
  const row = await db('password_resets').where({ token_hash: hashOf(token) }).first();
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) return { valid: false };
  const account = await db<Account>('accounts').where({ id: row.account_id }).first();
  if (!account || account.disabled_at) return { valid: false };
  return { valid: true, email: account.email };
}

export class ResetError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400
  ) {
    super(message);
  }
}

/**
 * Finish a reset: set the new password, spend the link, and end every
 * session that existed before this moment.
 */
export async function completePasswordReset(token: string, password: string): Promise<Account> {
  const row = await db('password_resets').where({ token_hash: hashOf(token) }).first();
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
    throw new ResetError(
      'This link has already been used, or it has run out. Ask for a new one and it will arrive in a moment.',
      'INVALID_TOKEN',
      410
    );
  }
  const account = await db<Account>('accounts').where({ id: row.account_id }).first();
  if (!account || account.disabled_at) {
    throw new ResetError('This account cannot be used. Ask an administrator.', 'ACCOUNT_UNAVAILABLE', 403);
  }

  const now = new Date();
  await db.transaction(async (trx) => {
    await trx('accounts').where({ id: account.id }).update({
      password_hash: await bcrypt.hash(password, 12),
      // Everything issued before now stops working, including whoever else
      // may have been signed in.
      sessions_valid_from: now,
      updated_at: trx.fn.now(),
    });
    await trx('password_resets').where({ id: row.id }).update({ used_at: trx.fn.now() });
    // Anything else outstanding for this person goes too.
    await trx('password_resets').where({ account_id: account.id }).whereNull('used_at').update({ used_at: trx.fn.now() });
  });

  return { ...account, sessions_valid_from: now } as Account;
}
