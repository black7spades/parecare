import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { issueSessionToken, accountSummary } from './auth';
import { createAccount, findAccountByEmail, AccountError, splitDisplayName } from '../services/accounts';
import {
  acceptWardenInvite,
  inviteState,
  WardenError,
  type WardenInvite,
} from '../services/wardens';
import { sendWardenAcceptedEmail } from '../services/email';

/**
 * The receiving end of a data warden invitation.
 *
 * Public, because the person being asked may have no account at all. The
 * token in the link is the credential, exactly like a password reset, and
 * the invitation is only ever turned into real access once they have proved
 * they hold the address it was sent to: either by signing in as it, or by
 * creating the account it names.
 *
 * Every arrival state is handled, because the one thing that must not happen
 * is somebody who agreed to help being left on a page that cannot help them.
 */
export const wardenInvitesRouter = Router();

async function loadInvite(token: string): Promise<WardenInvite | undefined> {
  return db<WardenInvite>('warden_invites').where({ token }).first();
}

/** Tell the person who asked, once it is real. Never blocks the acceptance. */
async function notifyAsker(invite: WardenInvite, wardenName: string): Promise<void> {
  if (!invite.invited_by_account_id) return;
  const asker = await db('accounts').where({ id: invite.invited_by_account_id }).first();
  if (!asker?.email) return;
  await sendWardenAcceptedEmail(asker.email, asker.display_name, wardenName, invite.email).catch((err) =>
    console.warn('Data warden accepted email failed:', (err as Error).message)
  );
}

/**
 * What the page shows before anyone signs in: who asked, whether this
 * address already has an account, and whether the link is still good.
 */
wardenInvitesRouter.get('/:token', async (req, res) => {
  const invite = await loadInvite(String(req.params['token']));
  if (!invite) {
    res.status(404).json({ error: 'This invitation does not exist, or it has been cancelled.', code: 'NOT_FOUND' });
    return;
  }
  const asker = invite.invited_by_account_id
    ? await db('accounts').where({ id: invite.invited_by_account_id }).select('display_name').first()
    : null;
  const account = await findAccountByEmail(invite.email);
  res.json({
    invite: {
      email: invite.email,
      state: inviteState(invite),
      asked_by: asker?.display_name ?? 'Someone',
      has_account: !!account,
      expires_at: invite.expires_at,
    },
  });
});

/** Already signed in as the invited address: nothing left to do but say yes. */
wardenInvitesRouter.post('/:token/accept', requireAuth, async (req, res) => {
  const invite = await loadInvite(String(req.params['token']));
  if (!invite) {
    res.status(404).json({ error: 'This invitation does not exist, or it has been cancelled.', code: 'NOT_FOUND' });
    return;
  }
  try {
    await acceptWardenInvite(invite, req.account!);
  } catch (err) {
    if (err instanceof WardenError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
  await notifyAsker(invite, req.account!.display_name);
  res.json({ message: 'Thank you. You can now get these records back if they are ever needed.' });
});

/**
 * No account yet: make one at the invited address and accept in the same
 * step, so somebody who agreed to help never has to fill in two forms.
 */
const registerSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().max(100).optional(),
  password: z.string().min(8).max(200),
});

wardenInvitesRouter.post('/:token/register', async (req, res) => {
  const invite = await loadInvite(String(req.params['token']));
  if (!invite) {
    res.status(404).json({ error: 'This invitation does not exist, or it has been cancelled.', code: 'NOT_FOUND' });
    return;
  }
  if (inviteState(invite) !== 'pending') {
    res.status(410).json({ error: 'This invitation is no longer valid. Ask for a new one.', code: 'NOT_PENDING' });
    return;
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Fill in your name and a password of at least eight characters.', code: 'VALIDATION_ERROR' });
    return;
  }
  const existing = await findAccountByEmail(invite.email);
  if (existing) {
    res.status(409).json({ error: 'That address already has an account. Sign in instead.', code: 'ALREADY_EXISTS' });
    return;
  }

  try {
    const account = await createAccount({
      email: invite.email,
      password: parsed.data.password,
      ...splitDisplayName([parsed.data.first_name, parsed.data.last_name].filter(Boolean).join(' ')),
      // A warden is not here to run care profiles. They get exactly the one
      // thing they agreed to, and nothing else is switched on by accident.
      can_create_care_profiles: false,
    });
    await acceptWardenInvite(invite, account);
    await notifyAsker(invite, account.display_name);
    res.status(201).json({
      token: issueSessionToken(account.id),
      account: accountSummary(account),
      message: 'Thank you. You can now get these records back if they are ever needed.',
    });
  } catch (err) {
    if (err instanceof AccountError || err instanceof WardenError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});
