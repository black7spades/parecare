import { Router, type Response } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { issueSessionToken, accountSummary } from './auth';
import { acceptInvitation, effectiveStatus, InviteError } from '../services/invitations';
import { createAccount, findAccountByEmail, AccountError } from '../services/accounts';
import type { Invitation } from '../types';

/**
 * Public endpoints for the receiving end of an invitation. The token in
 * the URL is the credential; acceptance additionally requires the session
 * email to match the invited email, and if the invited person has no
 * account yet, the register endpoint creates one (with the invited email
 * locked in) and accepts in the same step.
 */
export const invitationsRouter = Router();

function sendInviteError(res: Response, err: unknown): boolean {
  if (err instanceof InviteError || err instanceof AccountError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return true;
  }
  return false;
}

// What the invite page shows before anyone signs in. The token is the
// credential for reading this, exactly like a password-reset link.
invitationsRouter.get('/:token', async (req, res) => {
  const invitation = await db<Invitation>('invitations').where({ token: req.params['token'] }).first();
  if (!invitation) {
    res.status(404).json({ error: 'This invitation does not exist or has been revoked.', code: 'NOT_FOUND' });
    return;
  }

  const memberRows = await db('care_circle_members as m')
    .join('care_profiles as p', 'm.care_profile_id', 'p.id')
    .where('m.invitation_id', invitation.id)
    .select('p.full_name', 'm.role', 'm.permission');

  const account = await findAccountByEmail(invitation.email);

  res.json({
    invite: {
      display_name: invitation.display_name,
      email: invitation.email,
      status: effectiveStatus(invitation),
      expires_at: invitation.expires_at,
      has_account: !!account,
      profiles: memberRows.map((r) => ({ name: r.full_name, role: r.role, permission: r.permission })),
    },
  });
});

// Accept while signed in. The session's email must match the invited email.
invitationsRouter.post('/:token/accept', requireAuth, async (req, res) => {
  const relationship = typeof req.body?.relationship === 'string' ? req.body.relationship : null;
  try {
    const { care_profile_ids } = await acceptInvitation(req.params['token'], req.account!, relationship);
    res.json({ message: 'Invitation accepted.', care_profile_ids });
  } catch (err) {
    if (!sendInviteError(res, err)) throw err;
  }
});

// Create the account AND accept, in one step. This is the whole account
// creation process for an invited person: the email comes from the
// invitation and cannot be substituted.
invitationsRouter.post('/:token/register', async (req, res) => {
  const schema = z.object({
    first_name: z.string().max(100).optional().nullable(),
    middle_name: z.string().max(100).optional().nullable(),
    last_name: z.string().max(100).optional().nullable(),
    display_name: z.string().min(1).max(255).optional(),
    password: z.string().min(8),
    relationship: z.string().max(100).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A password of at least 8 characters is required.', code: 'VALIDATION_ERROR' });
    return;
  }

  try {
    // Validate the invitation before creating anything.
    const invitation = await db<Invitation>('invitations').where({ token: req.params['token'] }).first();
    if (!invitation) throw new InviteError(404, 'NOT_FOUND', 'This invitation does not exist or has been revoked.');

    if (await findAccountByEmail(invitation.email)) {
      res.status(409).json({
        error: 'An account with this email already exists. Sign in to accept the invitation.',
        code: 'DUPLICATE_EMAIL',
      });
      return;
    }

    const account = await createAccount({
      email: invitation.email,
      password: parsed.data.password,
      first_name: parsed.data.first_name ?? null,
      middle_name: parsed.data.middle_name ?? null,
      last_name: parsed.data.last_name ?? null,
      // Fallback when no parts are given: the name the inviter used.
      display_name: parsed.data.display_name?.trim() || invitation.display_name,
      // Invited helpers join other people's circles; they cannot create
      // care profiles of their own unless an admin grants it later.
      can_create_care_profiles: false,
    });
    const { care_profile_ids } = await acceptInvitation(req.params['token'], account, parsed.data.relationship ?? null);

    res.status(201).json({
      token: issueSessionToken(account.id),
      account: accountSummary(account),
      care_profile_ids,
    });
  } catch (err) {
    if (!sendInviteError(res, err)) throw err;
  }
});
