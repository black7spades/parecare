import { db } from '../config/database';
import { env } from '../config/env';
import { sendInviteEmail } from './email';
import type { Account, CareCircleMember, Invitation } from '../types';

/**
 * The invitation system. One invitation is addressed to one email and can
 * cover any number of care profiles (a carer looking after a whole wing of
 * residents accepts once and is placed in every circle). The token in the
 * link is the credential; acceptance is only ever possible for an account
 * whose email matches the invited address, and if no such account exists
 * the accept page creates one as part of accepting.
 */

export const INVITE_TTL_DAYS = 14;

export class InviteError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ProfileAssignment {
  care_profile_id: string;
  role: string;
  permission: 'viewer' | 'contributor';
  relationship?: string | null;
  role_description?: string | null;
  poa_type?: string | null;
  can_edit_profile?: boolean;
}

export function inviteUrl(token: string): string {
  return `${env.APP_URL}/invite/${token}`;
}

export function isExpired(inv: Invitation): boolean {
  return new Date(inv.expires_at).getTime() < Date.now();
}

/** pending | accepted | revoked | expired — what the outside world sees. */
export function effectiveStatus(inv: Invitation): string {
  if (inv.status === 'pending' && isExpired(inv)) return 'expired';
  return inv.status;
}

async function accountByEmail(email: string): Promise<Account | undefined> {
  return db<Account>('accounts').whereRaw('lower(email) = ?', [email]).first();
}

export interface CreateInvitationResult {
  invitation: Invitation;
  invite_url: string;
  members: CareCircleMember[];
  /** Profiles skipped because the person already has access. */
  skipped: Array<{ care_profile_id: string; reason: string }>;
}

export async function createInvitation(opts: {
  email: string;
  display_name: string;
  invitedBy: Account;
  assignments: ProfileAssignment[];
  /** 'error' fails on any conflict (single invites); 'skip' drops conflicting profiles (bulk). */
  onConflict: 'error' | 'skip';
}): Promise<CreateInvitationResult> {
  const email = opts.email.trim().toLowerCase();
  if (opts.assignments.length === 0) {
    throw new InviteError(400, 'VALIDATION_ERROR', 'An invitation must cover at least one care profile.');
  }

  const profileIds = opts.assignments.map((a) => a.care_profile_id);
  const profiles = await db('care_profiles').whereIn('id', profileIds).andWhere('archived', false);
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const existingAccount = await accountByEmail(email);

  // Work out which assignments would collide with access the person
  // already has: they own the profile, are already an accepted member, or
  // have another live pending invite to it.
  const skipped: Array<{ care_profile_id: string; reason: string }> = [];
  const valid: ProfileAssignment[] = [];
  for (const a of opts.assignments) {
    const profile = profileById.get(a.care_profile_id);
    if (!profile) {
      skipped.push({ care_profile_id: a.care_profile_id, reason: 'Care profile not found.' });
      continue;
    }
    if (existingAccount && profile.account_id === existingAccount.id) {
      skipped.push({ care_profile_id: a.care_profile_id, reason: `${email} already owns this care profile.` });
      continue;
    }
    if (existingAccount) {
      const member = await db('care_circle_members')
        .where({ care_profile_id: a.care_profile_id, account_id: existingAccount.id, invite_accepted: true })
        .first();
      if (member) {
        skipped.push({ care_profile_id: a.care_profile_id, reason: `${email} is already in this care circle.` });
        continue;
      }
    }
    const livePending = await db('care_circle_members as m')
      .join('invitations as i', 'm.invitation_id', 'i.id')
      .where({ 'm.care_profile_id': a.care_profile_id, 'm.invite_accepted': false, 'i.status': 'pending', 'i.email': email })
      .where('i.expires_at', '>', db.fn.now())
      .first();
    if (livePending) {
      skipped.push({ care_profile_id: a.care_profile_id, reason: `${email} already has a pending invite to this care circle.` });
      continue;
    }
    valid.push(a);
  }

  if (skipped.length > 0 && opts.onConflict === 'error') {
    throw new InviteError(409, 'ALREADY_HAS_ACCESS', skipped[0].reason);
  }
  if (valid.length === 0) {
    throw new InviteError(409, 'ALREADY_HAS_ACCESS', 'The person already has access to every selected care profile.');
  }

  const result = await db.transaction(async (trx) => {
    const [invitation] = await trx<Invitation>('invitations')
      .insert({
        email,
        display_name: opts.display_name,
        invited_by_account_id: opts.invitedBy.id,
        status: 'pending',
        expires_at: trx.raw(`NOW() + INTERVAL '${INVITE_TTL_DAYS} days'`),
      })
      .returning('*');

    const members = await trx<CareCircleMember>('care_circle_members')
      .insert(
        valid.map((a) => ({
          care_profile_id: a.care_profile_id,
          invitation_id: invitation.id,
          invited_email: email,
          display_name: opts.display_name,
          role: a.role,
          permission: a.permission,
          relationship: a.relationship ?? null,
          role_description: a.role_description ?? null,
          poa_type: a.poa_type ?? null,
          can_edit_profile: a.can_edit_profile ?? false,
          invite_accepted: false,
        }))
      )
      .returning('*');

    return { invitation, members };
  });

  const profileNames = valid.map((a) => String(profileById.get(a.care_profile_id)?.full_name ?? 'a care profile'));
  await sendInviteEmail(email, opts.invitedBy.display_name, profileNames, inviteUrl(result.invitation.token)).catch(
    (err) => console.warn('Invite email failed:', (err as Error).message)
  );

  return { ...result, invite_url: inviteUrl(result.invitation.token), skipped };
}

/** Load an invitation by token and reject anything that is not acceptable. */
export async function loadAcceptableInvitation(token: string): Promise<Invitation> {
  const invitation = await db<Invitation>('invitations').where({ token }).first();
  if (!invitation || invitation.status === 'revoked') {
    throw new InviteError(404, 'NOT_FOUND', 'This invitation does not exist or has been revoked.');
  }
  if (invitation.status === 'accepted') {
    throw new InviteError(409, 'ALREADY_ACCEPTED', 'This invitation has already been accepted.');
  }
  if (isExpired(invitation)) {
    throw new InviteError(410, 'INVITE_EXPIRED', 'This invitation has expired. Ask for a new one.');
  }
  return invitation;
}

export async function acceptInvitation(
  token: string,
  account: Account,
  relationship?: string | null
): Promise<{ care_profile_ids: string[] }> {
  const invitation = await loadAcceptableInvitation(token);

  if (invitation.email !== account.email.toLowerCase()) {
    throw new InviteError(
      403,
      'EMAIL_MISMATCH',
      `This invitation was sent to ${invitation.email}. Sign in with that email address to accept it.`
    );
  }

  return db.transaction(async (trx) => {
    const members = await trx<CareCircleMember>('care_circle_members')
      .where({ invitation_id: invitation.id, invite_accepted: false })
      .forUpdate();

    const careProfileIds: string[] = [];
    for (const m of members) {
      // The person may have gained access to one of the profiles some other
      // way in the meantime; drop that pending row instead of duplicating.
      const already = await trx('care_circle_members')
        .where({ care_profile_id: m.care_profile_id, account_id: account.id, invite_accepted: true })
        .first();
      const ownsIt = await trx('care_profiles').where({ id: m.care_profile_id, account_id: account.id }).first();
      if (already || ownsIt) {
        await trx('care_circle_members').where({ id: m.id }).del();
        careProfileIds.push(m.care_profile_id);
        continue;
      }
      await trx('care_circle_members')
        .where({ id: m.id })
        .update({
          account_id: account.id,
          invite_accepted: true,
          ...(relationship ? { relationship: relationship.slice(0, 100) } : {}),
        });
      careProfileIds.push(m.care_profile_id);
    }

    await trx('invitations').where({ id: invitation.id }).update({
      status: 'accepted',
      accepted_account_id: account.id,
      accepted_at: trx.fn.now(),
    });

    return { care_profile_ids: careProfileIds };
  });
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  await db.transaction(async (trx) => {
    const invitation = await trx<Invitation>('invitations').where({ id: invitationId }).first();
    if (!invitation) throw new InviteError(404, 'NOT_FOUND', 'Invitation not found.');
    if (invitation.status !== 'pending') throw new InviteError(409, 'NOT_PENDING', 'Only pending invitations can be revoked.');
    await trx('care_circle_members').where({ invitation_id: invitationId, invite_accepted: false }).del();
    await trx('invitations').where({ id: invitationId }).update({ status: 'revoked' });
  });
}

/** New token and a fresh expiry window, then the email goes out again. */
export async function resendInvitation(invitationId: string, actor: Account): Promise<{ invitation: Invitation; invite_url: string }> {
  const invitation = await db<Invitation>('invitations').where({ id: invitationId }).first();
  if (!invitation) throw new InviteError(404, 'NOT_FOUND', 'Invitation not found.');
  if (invitation.status !== 'pending') throw new InviteError(409, 'NOT_PENDING', 'This invitation has already been accepted or revoked.');

  const [updated] = await db<Invitation>('invitations')
    .where({ id: invitationId })
    .update({
      token: db.raw('gen_random_uuid()'),
      expires_at: db.raw(`NOW() + INTERVAL '${INVITE_TTL_DAYS} days'`),
    })
    .returning('*');

  const profileNames = await db('care_circle_members as m')
    .join('care_profiles as p', 'm.care_profile_id', 'p.id')
    .where({ 'm.invitation_id': invitationId })
    .pluck('p.full_name');
  await sendInviteEmail(updated.email, actor.display_name, profileNames, inviteUrl(updated.token)).catch((err) =>
    console.warn('Invite email failed:', (err as Error).message)
  );
  return { invitation: updated, invite_url: inviteUrl(updated.token) };
}
