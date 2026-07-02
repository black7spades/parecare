import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireCountBelow } from '../middleware/subscriptionGate';
import { sendInviteEmail } from '../services/email';
import { env } from '../config/env';
import type { CareCircleMember } from '../types';

export const careCircleRouter = Router({ mergeParams: true });

const memberSchema = z.object({
  invited_email: z.string().email(),
  display_name: z.string().min(1).max(255),
  role: z.string().min(1).max(100),
  role_description: z.string().optional().nullable(),
  poa_type: z.string().optional().nullable(),
});

careCircleRouter.get('/', requireAuth, async (req, res) => {
  const members = await db<CareCircleMember>('care_circle_members')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('created_at', 'asc');
  res.json({ members });
});

careCircleRouter.post(
  '/',
  requireAuth,
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

    const invite_token = uuidv4();
    const [member] = await db<CareCircleMember>('care_circle_members')
      .insert({
        care_profile_id: req.params['id'],
        invite_token,
        ...parsed.data,
      })
      .returning('*');

    const profile = await db('care_profiles').where({ id: req.params['id'] }).first();
    const inviteUrl = `${env.APP_URL}/invite/${invite_token}`;
    await sendInviteEmail(
      parsed.data.invited_email,
      req.account!.display_name,
      profile?.full_name ?? 'a care profile',
      inviteUrl
    ).catch((err) => console.warn('Invite email failed:', err));

    res.status(201).json({ member });
  }
);

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

careCircleRouter.patch('/:memberId', requireAuth, async (req, res) => {
  const updateSchema = z.object({
    role: z.string().min(1).optional(),
    role_description: z.string().optional().nullable(),
    poa_type: z.string().optional().nullable(),
    poa_activated: z.boolean().optional(),
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

careCircleRouter.delete('/:memberId', requireAuth, async (req, res) => {
  const affected = await db('care_circle_members')
    .where({ id: req.params['memberId'], care_profile_id: req.params['id'] })
    .delete();
  if (!affected) {
    res.status(404).json({ error: 'Member not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Member removed.' });
});

export const inviteRouter = Router();

// Public — look up an invite so the invite page can show what's being accepted
inviteRouter.get('/invite/:token', async (req, res) => {
  const member = await db<CareCircleMember>('care_circle_members')
    .where({ invite_token: req.params['token'] })
    .first();
  if (!member) {
    res.status(404).json({ error: 'Invite not found or already accepted', code: 'NOT_FOUND' });
    return;
  }
  const profile = await db('care_profiles').where({ id: member.care_profile_id }).first();
  res.json({
    invite: {
      display_name: member.display_name,
      role: member.role,
      profile_name: profile?.full_name ?? 'a care profile',
    },
  });
});

// Accepting requires being logged in — the invite is linked to the
// accepting account, never to an id supplied by the caller.
inviteRouter.post('/accept-invite/:token', requireAuth, async (req, res) => {
  const member = await db<CareCircleMember>('care_circle_members')
    .where({ invite_token: req.params['token'] })
    .first();

  if (!member) {
    res.status(404).json({ error: 'Invite not found or already accepted', code: 'NOT_FOUND' });
    return;
  }

  await db('care_circle_members').where({ id: member.id }).update({
    invite_accepted: true,
    account_id: req.account!.id,
    invite_token: null,
  });

  res.json({ message: 'Invite accepted.', care_profile_id: member.care_profile_id });
});
