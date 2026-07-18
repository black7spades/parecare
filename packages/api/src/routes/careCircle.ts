import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAccountRight } from '../middleware/accountRights';
import { requireCountBelow } from '../middleware/subscriptionGate';
import { requireProfileOwner } from '../middleware/permissions';
import { createInvitation, resendInvitation, revokeInvitation, inviteUrl, effectiveStatus, InviteError } from '../services/invitations';
import { env } from '../config/env';
import type { CareCircleMember, Invitation } from '../types';

export const careCircleRouter = Router({ mergeParams: true });

const memberSchema = z.object({
  invited_email: z.string().email(),
  display_name: z.string().min(1).max(255),
  role: z.string().min(1).max(100),
  role_description: z.string().optional().nullable(),
  poa_type: z.string().optional().nullable(),
  permission: z.enum(['viewer', 'contributor']).default('contributor'),
  relationship: z.string().max(100).optional().nullable(),
  can_edit_profile: z.boolean().optional(),
});

careCircleRouter.get('/', requireAuth, async (req, res) => {
  // The linked account's email rides along so a power-of-attorney holder's
  // contact details can be shown where the appointment is displayed.
  const members = await db<CareCircleMember & { account_email: string | null }>('care_circle_members')
    .leftJoin('accounts', 'care_circle_members.account_id', 'accounts.id')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('care_circle_members.created_at', 'asc')
    .select('care_circle_members.*', 'accounts.email as account_email');

  // Owners and admins also see each pending invite's link and expiry so an
  // invitation never depends on email delivery working.
  const canManage = req.careAccess?.level === 'owner' || req.careAccess?.level === 'admin';
  let invitationById = new Map<string, Invitation>();
  if (canManage) {
    const ids = members.map((m) => m.invitation_id).filter((v): v is string => !!v);
    if (ids.length > 0) {
      const invitations = await db<Invitation>('invitations').whereIn('id', ids);
      invitationById = new Map(invitations.map((i) => [i.id, i]));
    }
  }

  res.json({
    members: members.map((m) => {
      const inv = m.invitation_id ? invitationById.get(m.invitation_id) : undefined;
      return {
        ...m,
        ...(inv
          ? {
              invite_status: effectiveStatus(inv),
              invite_expires_at: inv.expires_at,
              invite_url: inv.status === 'pending' ? inviteUrl(inv.token) : null,
            }
          : {}),
      };
    }),
  });
});

/**
 * People already registered on PareCare that this carer can invite straight
 * into the circle, rather than typing an email for someone new. Excludes the
 * carer themselves and anyone already in this profile's circle. A self-hosted
 * instance and platform admins can pick any account; everyone else is limited
 * to people they already share care with, so the list is never a directory of
 * strangers.
 */
careCircleRouter.get('/invitable-users', requireAuth, async (req, res) => {
  const account = req.account!;
  const profileId = req.params['id'];

  const existing = await db('care_circle_members')
    .where({ care_profile_id: profileId })
    .whereNotNull('account_id')
    .select('account_id');
  const exclude = new Set<string>(existing.map((r) => r.account_id as string));
  exclude.add(account.id);

  const privileged = env.SELF_HOSTED || account.role === 'super_admin' || account.role === 'admin';
  let query = db('accounts').whereNotIn('id', [...exclude]);
  if (!privileged) {
    query = query.where((qb) => {
      qb.whereIn(
        'accounts.id',
        db('care_circle_members')
          .join('care_profiles', 'care_profiles.id', 'care_circle_members.care_profile_id')
          .where('care_profiles.account_id', account.id)
          .whereNotNull('care_circle_members.account_id')
          .select('care_circle_members.account_id'),
      ).orWhereIn(
        'accounts.id',
        db('care_profiles')
          .join('care_circle_members', 'care_profiles.id', 'care_circle_members.care_profile_id')
          .where('care_circle_members.account_id', account.id)
          .where('care_circle_members.invite_accepted', true)
          .select('care_profiles.account_id'),
      );
    });
  }
  const users = await query
    .select('accounts.id', 'accounts.display_name', 'accounts.email')
    .orderBy('accounts.display_name', 'asc')
    .limit(500);
  res.json({ users });
});

careCircleRouter.post(
  '/',
  requireAuth,
  requireAccountRight('can_invite_members'),
  requireProfileOwner,
  requireCountBelow('care_circle_members', async (req) => {
    const result = await db('care_circle_members')
      .where({ care_profile_id: req.params['id'] })
      .count('id as count')
      .first();
    return Number(result?.count ?? 0);
  }),
  async (req, res) => {
    const parsed = memberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      return;
    }

    try {
      const result = await createInvitation({
        email: parsed.data.invited_email,
        display_name: parsed.data.display_name,
        invitedBy: req.account!,
        onConflict: 'error',
        assignments: [
          {
            care_profile_id: req.params['id']!,
            role: parsed.data.role,
            permission: parsed.data.permission,
            relationship: parsed.data.relationship ?? null,
            role_description: parsed.data.role_description ?? null,
            poa_type: parsed.data.poa_type ?? null,
            can_edit_profile: parsed.data.can_edit_profile ?? false,
          },
        ],
      });
      res.status(201).json({ member: result.members[0], invite_url: result.invite_url });
    } catch (err) {
      if (err instanceof InviteError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  }
);

// Members describe their own relationship to the person ("Mum", "Oma"…);
// this is self-service and allowed even for viewers.
careCircleRouter.patch('/me/relationship', requireAuth, async (req, res) => {
  const parsed = z.object({ relationship: z.string().max(100).nullable() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const updated = await db('care_circle_members')
    .where({ care_profile_id: req.params['id'], account_id: req.account!.id, invite_accepted: true })
    .update({ relationship: parsed.data.relationship });
  if (!updated) {
    res.status(404).json({ error: 'You are not a member of this care circle', code: 'NOT_FOUND' });
    return;
  }
  res.json({ relationship: parsed.data.relationship });
});

careCircleRouter.get('/:memberId', requireAuth, async (req, res) => {
  const member = await db<CareCircleMember>('care_circle_members')
    .where({ id: req.params['memberId'], care_profile_id: req.params['id'] })
    .first();
  if (!member) {
    res.status(404).json({ error: 'Member not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ member });
});

// New link, fresh expiry, email re-sent. For pending invites only.
careCircleRouter.post('/:memberId/resend-invite', requireAuth, requireAccountRight('can_invite_members'), requireProfileOwner, async (req, res) => {
  const member = await db<CareCircleMember>('care_circle_members')
    .where({ id: req.params['memberId'], care_profile_id: req.params['id'] })
    .first();
  if (!member || !member.invitation_id) {
    res.status(404).json({ error: 'No invitation found for this member', code: 'NOT_FOUND' });
    return;
  }
  try {
    const { invitation, invite_url } = await resendInvitation(member.invitation_id, req.account!);
    res.json({ invite_url, expires_at: invitation.expires_at });
  } catch (err) {
    if (err instanceof InviteError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

careCircleRouter.patch('/:memberId', requireAuth, requireProfileOwner, async (req, res) => {
  const updateSchema = z.object({
    role: z.string().min(1).optional(),
    role_description: z.string().optional().nullable(),
    poa_type: z.string().optional().nullable(),
    poa_activated: z.boolean().optional(),
    permission: z.enum(['viewer', 'contributor']).optional(),
    relationship: z.string().max(100).optional().nullable(),
    can_edit_profile: z.boolean().optional(),
  });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const [updated] = await db<CareCircleMember>('care_circle_members')
    .where({ id: req.params['memberId'], care_profile_id: req.params['id'] })
    .update(parsed.data)
    .returning('*');

  if (!updated) {
    res.status(404).json({ error: 'Member not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ member: updated });
});

careCircleRouter.delete('/:memberId', requireAuth, requireProfileOwner, async (req, res) => {
  const member = await db<CareCircleMember>('care_circle_members')
    .where({ id: req.params['memberId'], care_profile_id: req.params['id'] })
    .first();
  if (!member) {
    res.status(404).json({ error: 'Member not found', code: 'NOT_FOUND' });
    return;
  }
  await db('care_circle_members').where({ id: member.id }).delete();

  // If that was the last pending membership on a pending invitation, the
  // invitation has nothing left to grant; revoke it so the link dies.
  if (member.invitation_id && !member.invite_accepted) {
    const remaining = await db('care_circle_members').where({ invitation_id: member.invitation_id }).first();
    if (!remaining) {
      await revokeInvitation(member.invitation_id).catch(() => {});
    }
  }

  res.json({ message: 'Member removed.' });
});
