import { db } from '../config/database';
import { env } from '../config/env';
import { findAccountByEmail } from './accounts';
import type { Account } from '../types';

/**
 * Data wardens: the second person who could get the records back.
 *
 * The rules about who can be one are hard, not advisory, because every one
 * of them protects something specific. A warden can read every record in the
 * installation, so this is not a courtesy title to hand around; and the
 * whole purpose is that somebody other than the usual person can act, so
 * anything that quietly resolves back to the usual person defeats it.
 */

/**
 * A copy holds every record about every person in this installation. Being
 * able to recover it is a serious thing to hand out, and resilience does not
 * improve after a small number of people: it just widens who can read
 * everyone's medical history. Five is generous for the job.
 */
export const MAX_WARDENS = 5;

const INVITE_DAYS = 14;

export class WardenError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export interface WardenCandidate {
  email: string;
  account?: Account;
}

/**
 * Whether this email may be asked, and why not when it may not. Every
 * refusal returns a sentence that says what to do instead, because being
 * told no without a reason is how someone ends up with no warden at all.
 */
export async function assertCanBeWarden(email: string, askedBy: Account): Promise<WardenCandidate> {
  const clean = email.trim().toLowerCase();
  if (!clean || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    throw new WardenError('That does not look like an email address.', 'INVALID_EMAIL');
  }

  if (clean === askedBy.email.toLowerCase()) {
    throw new WardenError(
      'A data warden has to be somebody else. The whole point is that a second person can get the records back if you cannot.',
      'SELF'
    );
  }

  const current = await db('accounts').where({ can_manage_backups: true }).whereNull('disabled_at').count('id as c').first();
  if (Number(current?.c ?? 0) >= MAX_WARDENS) {
    throw new WardenError(
      `There are already ${MAX_WARDENS} data wardens, which is as many as this allows. A copy holds everyone's records, so remove one before adding another.`,
      'TOO_MANY'
    );
  }

  const pending = await db('warden_invites').where({ email: clean, status: 'pending' }).first();
  if (pending && new Date(pending.expires_at) > new Date()) {
    throw new WardenError(
      'They have already been asked and have not answered yet. Send it again if the first one went astray.',
      'ALREADY_INVITED'
    );
  }

  const account = await findAccountByEmail(clean);
  if (!account) return { email: clean };

  if (account.disabled_at) {
    throw new WardenError(
      'That account has been disabled, so they could not sign in to help. Enable it first.',
      'DISABLED'
    );
  }
  if (account.role === 'super_admin') {
    throw new WardenError(
      'They already run this installation and can already get the records back, so naming them adds nothing.',
      'ALREADY_HAS_IT'
    );
  }
  if (account.role === 'admin') {
    throw new WardenError(
      'Administrators can already get the records back. Choose somebody who is not an administrator, so there is genuinely a second pair of hands.',
      'ALREADY_HAS_IT'
    );
  }
  if (account.can_manage_backups) {
    throw new WardenError('They are already a data warden.', 'ALREADY_WARDEN');
  }

  return { email: clean, account };
}

export interface WardenInvite {
  id: string;
  token: string;
  email: string;
  status: 'pending' | 'accepted' | 'cancelled';
  expires_at: Date;
  invited_by_account_id: string | null;
  accepted_account_id: string | null;
  accepted_at: Date | null;
}

export async function createWardenInvite(email: string, askedBy: Account): Promise<WardenInvite> {
  // Any earlier attempt for this address stops being live, so an old link in
  // an inbox can never quietly grant access later.
  await db('warden_invites').where({ email, status: 'pending' }).update({ status: 'cancelled' });
  const [invite] = await db('warden_invites')
    .insert({
      email,
      invited_by_account_id: askedBy.id,
      expires_at: new Date(Date.now() + INVITE_DAYS * 86400_000),
    })
    .returning('*');
  return invite as WardenInvite;
}

export function wardenInviteUrl(token: string): string {
  return `${env.APP_URL}/warden/${token}`;
}

/** The state of an invite, without trusting a stale status column. */
export function inviteState(invite: WardenInvite): 'pending' | 'accepted' | 'cancelled' | 'expired' {
  if (invite.status !== 'pending') return invite.status;
  return new Date(invite.expires_at) < new Date() ? 'expired' : 'pending';
}

/**
 * Turn an accepted invitation into the real thing. Called once the person
 * has proved they are the invited address, either by signing in as it or by
 * creating the account it names.
 */
export async function acceptWardenInvite(invite: WardenInvite, account: Account): Promise<void> {
  if (inviteState(invite) !== 'pending') {
    throw new WardenError('This invitation is no longer valid. Ask for a new one.', 'NOT_PENDING', 410);
  }
  if (account.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new WardenError(
      `This invitation was sent to ${invite.email}. Sign in as that address to accept it.`,
      'WRONG_ACCOUNT',
      403
    );
  }
  await db('accounts').where({ id: account.id }).update({
    can_manage_backups: true,
    // Accepting is being told: they have read what it means and agreed.
    warden_briefed_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('warden_invites')
    .where({ id: invite.id })
    .update({ status: 'accepted', accepted_account_id: account.id, accepted_at: db.fn.now() });
}
