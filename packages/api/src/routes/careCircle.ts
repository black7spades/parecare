import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAccountRight } from '../middleware/accountRights';
import { requireCountBelow } from '../middleware/subscriptionGate';
import { requireProfileOwner } from '../middleware/permissions';
import { canonicalRole } from '../lib/circleRoles';
import { createInvitation, resendInvitation, revokeInvitation, inviteUrl, effectiveStatus, InviteError } from '../services/invitations';
import { env } from '../config/env';
import type { CareCircleMember, Invitation } from '../types';
import { addCirclePerson, circlePersonSchema, isAddedPerson } from '../services/circlePeople';
import { pickablePeople } from '../services/people';

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
    .select('care_circle_members.*', 'accounts.email as account_email', 'accounts.phone as account_phone');

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
      const accountPhone = (m as { account_phone?: string | null }).account_phone;
      return {
        ...m,
        // Someone with a login keeps their phone on their account, once.
        phone: accountPhone?.trim() || m.phone || null,
        // active: logs in. invited: invite sent, not yet accepted. added: in
        // the circle by name only, with no login.
        status: m.invite_accepted ? 'active' : isAddedPerson(m) ? 'added' : 'invited',
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
/** Everyone who can be picked for a job: the account holder first, then the circle. */
careCircleRouter.get('/people', requireAuth, async (req, res) => {
  res.json({ people: await pickablePeople(String(req.params['id']), req.account?.id ?? null) });
});

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
  requireProfileOwner('invite someone to the care circle'),
  requireCountBelow('care_circle_members', async (req) => {
    const result = await db('care_circle_members')
      .where({ care_profile_id: req.params['id'] })
      .where((qb) => qb.whereNotNull('account_id').orWhereNotNull('invitation_id'))
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

/**
 * Add someone to the circle by name, with no invite and no login: a
 * neighbour, a friend, a support worker. Phone and email are optional.
 */
careCircleRouter.post('/people', requireAuth, requireProfileOwner('add someone to the care circle'), async (req, res) => {
  const parsed = circlePersonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Give them a name to add them. Check the email looks right if you gave one.', code: 'VALIDATION_ERROR' });
    return;
  }
  const member = await addCirclePerson(String(req.params['id']), parsed.data);
  res.status(201).json({ member: { ...member, status: 'added' } });
});

/**
 * Invite someone who was added by name to log in. The invitation carries
 * over who they are; their added entry becomes the invite.
 */
careCircleRouter.post(
  '/:memberId/invite',
  requireAuth,
  requireAccountRight('can_invite_members'),
  requireProfileOwner('send someone in the care circle an invitation'),
  async (req, res) => {
    const parsed = z
      .object({ email: z.string().trim().email(), permission: z.enum(['viewer', 'contributor']).default('contributor') })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Add an email address to send the invite to.', code: 'VALIDATION_ERROR' });
      return;
    }
    const member = await db<CareCircleMember>('care_circle_members')
      .where({ id: req.params['memberId'], care_profile_id: req.params['id'] })
      .first();
    if (!member) {
      res.status(404).json({ error: 'That person is no longer in the circle.', code: 'NOT_FOUND' });
      return;
    }
    if (!isAddedPerson(member)) {
      res.status(409).json({ error: 'They already have a login or an invite on the way.', code: 'ALREADY_INVITED' });
      return;
    }
    try {
      const result = await createInvitation({
        email: parsed.data.email,
        display_name: member.display_name,
        invitedBy: req.account!,
        onConflict: 'error',
        assignments: [
          {
            care_profile_id: req.params['id']!,
            role: member.role,
            permission: parsed.data.permission,
            relationship: member.relationship ?? null,
            role_description: member.role_description ?? null,
            poa_type: member.poa_type ?? null,
            can_edit_profile: false,
          },
        ],
      });
      // The invite replaces the added entry, keeping their phone with them.
      const invited = result.members[0] as { id: string } | undefined;
      if (invited && member.phone) {
        await db('care_circle_members').where({ id: invited.id }).update({ phone: member.phone });
      }
      await db('care_circle_members').where({ id: member.id }).delete();
      res.status(201).json({ member: invited, invite_url: result.invite_url });
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

// Your own phone, kept on your account so it is the same in every circle
// you are in and wherever you are picked. Allowed for anyone with access,
// viewers included, and for the account holder.
careCircleRouter.patch('/me', requireAuth, async (req, res) => {
  const parsed = z.object({ phone: z.string().trim().max(50).nullable() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A phone number is at most 50 characters.', code: 'VALIDATION_ERROR' });
    return;
  }
  const phone = parsed.data.phone?.trim() || null;
  await db('accounts').where({ id: req.account!.id }).update({ phone, updated_at: db.fn.now() });
  res.json({ phone });
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
careCircleRouter.post('/:memberId/resend-invite', requireAuth, requireAccountRight('can_invite_members'), requireProfileOwner('send an invitation again'), async (req, res) => {
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

careCircleRouter.patch('/:memberId', requireAuth, requireProfileOwner("change someone's role or access in the care circle"), async (req, res) => {
  const updateSchema = z.object({
    role: z.string().min(1).optional(),
    role_description: z.string().optional().nullable(),
    poa_type: z.string().optional().nullable(),
    poa_activated: z.boolean().optional(),
    permission: z.enum(['viewer', 'contributor']).optional(),
    relationship: z.string().max(100).optional().nullable(),
    can_edit_profile: z.boolean().optional(),
    // Only for someone added by name: their own name and how to reach them.
    // Anyone with a login keeps the name and email of their account.
    display_name: z.string().trim().min(1).max(255).optional(),
    phone: z.string().trim().max(50).optional().nullable(),
    email: z.string().trim().email().max(255).optional().nullable().or(z.literal('').transform(() => null)),
  });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Check the details. The email needs to look like an email address.', code: 'VALIDATION_ERROR' });
    return;
  }

  const existing = await db<CareCircleMember>('care_circle_members')
    .where({ id: req.params['memberId'], care_profile_id: req.params['id'] })
    .first();
  if (!existing) {
    res.status(404).json({ error: 'Member not found', code: 'NOT_FOUND' });
    return;
  }
  const { display_name, phone, email, ...rest } = parsed.data;
  const fields: Record<string, unknown> = { ...rest };
  // "Carer" and "carer" are one role: store the listed form.
  if (rest.role !== undefined) fields['role'] = canonicalRole(rest.role) || existing.role;
  if (isAddedPerson(existing)) {
    if (display_name !== undefined) fields['display_name'] = display_name;
    if (phone !== undefined) fields['phone'] = phone?.trim() || null;
    if (email !== undefined) fields['email'] = email?.trim() || null;
  } else if (phone !== undefined) {
    fields['phone'] = phone?.trim() || null;
  }

  if (Object.keys(fields).length === 0) {
    res.json({ member: existing });
    return;
  }
  const [updated] = await db<CareCircleMember>('care_circle_members')
    .where({ id: existing.id })
    .update(fields)
    .returning('*');
  res.json({ member: updated });
});

careCircleRouter.delete('/:memberId', requireAuth, requireProfileOwner('remove someone from the care circle'), async (req, res) => {
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
