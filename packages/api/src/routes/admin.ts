import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireRole, roleAtLeast } from '../middleware/requireRole';
import { archiveOldAdministrations } from '../services/marArchive';
import { createAccount, AccountError } from '../services/accounts';
import { createInvitation, revokeInvitation, resendInvitation, inviteUrl, effectiveStatus, InviteError } from '../services/invitations';
import type { Account, AccountRole, Invitation } from '../types';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));

// Run the MAR retention sweep on demand (it also runs daily). Super admin only.
adminRouter.post('/mar/archive', requireRole('super_admin'), async (_req, res) => {
  const archived = await archiveOldAdministrations();
  res.json({ archived });
});

const ACCOUNT_COLUMNS = [
  'id',
  'email',
  'display_name',
  'role',
  'subscription_tier',
  'subscription_status',
  'ai_tokens_used',
  'disabled_at',
  'can_create_care_profiles',
  'created_at',
  'updated_at',
] as const;

/**
 * Admins can only manage regular users. Super admins can manage everyone,
 * but role changes are super-admin-only (enforced per route).
 */
function canManage(actor: Account, target: Account): boolean {
  if (actor.role === 'super_admin') return true;
  return target.role === 'user';
}

async function countSuperAdmins(): Promise<number> {
  const row = await db('accounts').where({ role: 'super_admin' }).count<{ count: string }>('id as count').first();
  return Number(row?.count ?? 0);
}

adminRouter.get('/stats', async (_req, res) => {
  const [byRole, byTier, totalRow] = await Promise.all([
    db('accounts').select('role').count('id as count').groupBy('role'),
    db('accounts').select('subscription_tier').count('id as count').groupBy('subscription_tier'),
    db('accounts').count<{ count: string }>('id as count').first(),
  ]);
  res.json({
    total: Number(totalRow?.count ?? 0),
    by_role: Object.fromEntries(byRole.map((r) => [r.role, Number(r.count)])),
    by_tier: Object.fromEntries(byTier.map((r) => [r.subscription_tier, Number(r.count)])),
  });
});

const listQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

adminRouter.get('/accounts', async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', code: 'VALIDATION_ERROR' });
    return;
  }
  const { search, page, per_page } = parsed.data;

  const base = db<Account>('accounts');
  if (search) {
    base.where((qb) => {
      qb.whereILike('email', `%${search}%`).orWhereILike('display_name', `%${search}%`);
    });
  }

  const [accounts, totalRow] = await Promise.all([
    base
      .clone()
      .select(ACCOUNT_COLUMNS)
      .orderBy('created_at', 'desc')
      .limit(per_page)
      .offset((page - 1) * per_page),
    base.clone().count<{ count: string }>('id as count').first(),
  ]);

  res.json({
    accounts,
    total: Number(totalRow?.count ?? 0),
    page,
    per_page,
  });
});

adminRouter.get('/accounts/:accountId', async (req, res) => {
  const account = await db<Account>('accounts')
    .where({ id: req.params.accountId })
    .select(ACCOUNT_COLUMNS)
    .first();
  if (!account) {
    res.status(404).json({ error: 'Account not found', code: 'NOT_FOUND' });
    return;
  }
  res.json(account);
});

const updateAccountSchema = z.object({
  display_name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  subscription_tier: z.enum(['free', 'family', 'professional']).optional(),
  can_create_care_profiles: z.boolean().optional(),
});

adminRouter.patch('/accounts/:accountId', async (req, res) => {
  const parsed = updateAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const actor = req.account!;
  const target = await db<Account>('accounts').where({ id: req.params.accountId }).first();
  if (!target) {
    res.status(404).json({ error: 'Account not found', code: 'NOT_FOUND' });
    return;
  }
  if (!canManage(actor, target)) {
    res.status(403).json({ error: 'Admins can only manage regular users', code: 'FORBIDDEN' });
    return;
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No fields to update', code: 'VALIDATION_ERROR' });
    return;
  }

  if (updates.email) {
    updates.email = updates.email.toLowerCase();
    if (updates.email !== target.email.toLowerCase()) {
      const existing = await db<Account>('accounts').whereRaw('lower(email) = ?', [updates.email]).first();
      if (existing) {
        res.status(409).json({ error: 'An account with this email already exists', code: 'DUPLICATE_EMAIL' });
        return;
      }
    }
  }

  const [updated] = await db<Account>('accounts')
    .where({ id: target.id })
    .update({ ...updates, updated_at: db.fn.now() })
    .returning(ACCOUNT_COLUMNS as unknown as string[]);
  res.json(updated);
});

// --- User creation and life cycle ---

const createAccountSchema = z.object({
  email: z.string().email(),
  display_name: z.string().min(1).max(255),
  password: z.string().min(8),
  role: z.enum(['super_admin', 'admin', 'user']).default('user'),
  // Admin-created accounts are usually carers joining existing circles, so
  // creating their own care profiles is off unless the admin says otherwise.
  can_create_care_profiles: z.boolean().default(false),
});

// Create a user directly, with a password the admin hands over. Elevated
// roles are super-admin-only.
adminRouter.post('/accounts', async (req, res) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  if (parsed.data.role !== 'user' && req.account!.role !== 'super_admin') {
    res.status(403).json({ error: 'Only a super admin can create admin accounts', code: 'FORBIDDEN' });
    return;
  }
  try {
    const account = await createAccount(parsed.data);
    res.status(201).json({
      account: Object.fromEntries(ACCOUNT_COLUMNS.map((c) => [c, (account as unknown as Record<string, unknown>)[c]])),
    });
  } catch (err) {
    if (err instanceof AccountError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

// Disable or re-enable an account. Disabling keeps every record and
// membership but stops all sign-ins and live sessions.
adminRouter.patch('/accounts/:accountId/disabled', async (req, res) => {
  const parsed = z.object({ disabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const actor = req.account!;
  const target = await db<Account>('accounts').where({ id: req.params.accountId }).first();
  if (!target) {
    res.status(404).json({ error: 'Account not found', code: 'NOT_FOUND' });
    return;
  }
  if (target.id === actor.id) {
    res.status(409).json({ error: 'You cannot disable your own account', code: 'SELF_DISABLE' });
    return;
  }
  if (!canManage(actor, target)) {
    res.status(403).json({ error: 'Admins can only manage regular users', code: 'FORBIDDEN' });
    return;
  }
  if (parsed.data.disabled && target.role === 'super_admin') {
    const activeSupers = await db('accounts')
      .where({ role: 'super_admin' })
      .whereNull('disabled_at')
      .count<{ count: string }>('id as count')
      .first();
    if (Number(activeSupers?.count ?? 0) <= 1) {
      res.status(409).json({ error: 'Cannot disable the last active super admin', code: 'LAST_SUPER_ADMIN' });
      return;
    }
  }
  await db('accounts')
    .where({ id: target.id })
    .update({ disabled_at: parsed.data.disabled ? db.fn.now() : null, updated_at: db.fn.now() });
  res.json({ id: target.id, disabled: parsed.data.disabled });
});

// --- Invitations across any set of care profiles ---
// The Serenity Place case: one carer, invited once, placed in the circle
// of every resident they look after.

const adminInviteSchema = z.object({
  email: z.string().email(),
  display_name: z.string().min(1).max(255),
  role: z.string().min(1).max(100).default('carer'),
  permission: z.enum(['viewer', 'contributor']).default('contributor'),
  care_profile_ids: z.array(z.string().uuid()).min(1).max(200),
});

adminRouter.post('/invitations', async (req, res) => {
  const parsed = adminInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  try {
    const result = await createInvitation({
      email: parsed.data.email,
      display_name: parsed.data.display_name,
      invitedBy: req.account!,
      onConflict: 'skip',
      assignments: [...new Set(parsed.data.care_profile_ids)].map((id) => ({
        care_profile_id: id,
        role: parsed.data.role,
        permission: parsed.data.permission,
      })),
    });
    res.status(201).json({
      invitation: result.invitation,
      invite_url: result.invite_url,
      member_count: result.members.length,
      skipped: result.skipped,
    });
  } catch (err) {
    if (err instanceof InviteError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

adminRouter.get('/invitations', async (_req, res) => {
  const invitations = await db<Invitation>('invitations').orderBy('created_at', 'desc').limit(200);
  const ids = invitations.map((i) => i.id);
  const memberRows = ids.length
    ? await db('care_circle_members as m')
        .join('care_profiles as p', 'm.care_profile_id', 'p.id')
        .whereIn('m.invitation_id', ids)
        .select('m.invitation_id', 'p.full_name')
    : [];
  const namesByInvite = new Map<string, string[]>();
  for (const r of memberRows as Array<{ invitation_id: string; full_name: string }>) {
    const arr = namesByInvite.get(r.invitation_id) ?? [];
    arr.push(r.full_name);
    namesByInvite.set(r.invitation_id, arr);
  }
  res.json({
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      display_name: i.display_name,
      status: effectiveStatus(i),
      expires_at: i.expires_at,
      created_at: i.created_at,
      profile_names: namesByInvite.get(i.id) ?? [],
      invite_url: i.status === 'pending' ? inviteUrl(i.token) : null,
    })),
  });
});

adminRouter.post('/invitations/:invitationId/resend', async (req, res) => {
  try {
    const { invitation, invite_url } = await resendInvitation(req.params.invitationId, req.account!);
    res.json({ invite_url, expires_at: invitation.expires_at });
  } catch (err) {
    if (err instanceof InviteError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

adminRouter.delete('/invitations/:invitationId', async (req, res) => {
  try {
    await revokeInvitation(req.params.invitationId);
    res.json({ message: 'Invitation revoked.' });
  } catch (err) {
    if (err instanceof InviteError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

// --- Direct assignment of an existing user to a set of care profiles ---
// No invite dance: the user already exists, the admin places them.

const assignmentSchema = z.object({
  account_id: z.string().uuid(),
  role: z.string().min(1).max(100).default('carer'),
  permission: z.enum(['viewer', 'contributor']).default('contributor'),
  care_profile_ids: z.array(z.string().uuid()).min(1).max(200),
});

adminRouter.post('/assignments', async (req, res) => {
  const parsed = assignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const target = await db<Account>('accounts').where({ id: parsed.data.account_id }).first();
  if (!target) {
    res.status(404).json({ error: 'Account not found', code: 'NOT_FOUND' });
    return;
  }

  const created: string[] = [];
  const skipped: Array<{ care_profile_id: string; reason: string }> = [];
  for (const profileId of [...new Set(parsed.data.care_profile_ids)]) {
    const profile = await db('care_profiles').where({ id: profileId, archived: false }).first();
    if (!profile) {
      skipped.push({ care_profile_id: profileId, reason: 'Care profile not found.' });
      continue;
    }
    if (profile.account_id === target.id) {
      skipped.push({ care_profile_id: profileId, reason: 'They already own this care profile.' });
      continue;
    }
    const existing = await db('care_circle_members')
      .where({ care_profile_id: profileId, account_id: target.id, invite_accepted: true })
      .first();
    if (existing) {
      skipped.push({ care_profile_id: profileId, reason: 'They are already in this care circle.' });
      continue;
    }
    await db('care_circle_members').insert({
      care_profile_id: profileId,
      account_id: target.id,
      invited_email: target.email,
      display_name: target.display_name,
      role: parsed.data.role,
      permission: parsed.data.permission,
      invite_accepted: true,
    });
    await db('audit_log')
      .insert({
        care_profile_id: profileId,
        actor_account_id: req.account!.id,
        action: 'created',
        entity_type: 'circle',
        summary: `${target.display_name} assigned by admin`,
      })
      .catch(() => {});
    created.push(profileId);
  }
  res.status(201).json({ assigned: created, skipped });
});

// Minimal profile list for the admin pickers.
adminRouter.get('/care-profiles', async (req, res) => {
  const search = typeof req.query['search'] === 'string' ? req.query['search'] : '';
  const q = db('care_profiles as p')
    .join('accounts as a', 'p.account_id', 'a.id')
    .where('p.archived', false)
    .select('p.id', 'p.full_name', 'a.email as owner_email', 'a.display_name as owner_name')
    .orderBy('p.full_name', 'asc')
    .limit(100);
  if (search) q.whereILike('p.full_name', `%${search}%`);
  res.json({ profiles: await q });
});

const updateRoleSchema = z.object({
  role: z.enum(['super_admin', 'admin', 'user']),
});

adminRouter.patch('/accounts/:accountId/role', requireRole('super_admin'), async (req, res) => {
  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const newRole: AccountRole = parsed.data.role;

  const target = await db<Account>('accounts').where({ id: req.params.accountId }).first();
  if (!target) {
    res.status(404).json({ error: 'Account not found', code: 'NOT_FOUND' });
    return;
  }
  if (target.role === newRole) {
    res.json({ id: target.id, role: target.role });
    return;
  }

  if (target.role === 'super_admin' && !roleAtLeast(newRole, 'super_admin')) {
    const superAdmins = await countSuperAdmins();
    if (superAdmins <= 1) {
      res.status(409).json({ error: 'Cannot demote the last super admin', code: 'LAST_SUPER_ADMIN' });
      return;
    }
  }

  await db('accounts').where({ id: target.id }).update({ role: newRole, updated_at: db.fn.now() });
  res.json({ id: target.id, role: newRole });
});

adminRouter.delete('/accounts/:accountId', async (req, res) => {
  const actor = req.account!;
  const target = await db<Account>('accounts').where({ id: req.params.accountId }).first();
  if (!target) {
    res.status(404).json({ error: 'Account not found', code: 'NOT_FOUND' });
    return;
  }
  if (target.id === actor.id) {
    res.status(409).json({ error: 'You cannot delete your own account from the admin panel', code: 'SELF_DELETE' });
    return;
  }
  if (!canManage(actor, target)) {
    res.status(403).json({ error: 'Admins can only manage regular users', code: 'FORBIDDEN' });
    return;
  }
  if (target.role === 'super_admin') {
    const superAdmins = await countSuperAdmins();
    if (superAdmins <= 1) {
      res.status(409).json({ error: 'Cannot delete the last super admin', code: 'LAST_SUPER_ADMIN' });
      return;
    }
  }

  await db('accounts').where({ id: target.id }).delete();
  res.json({ message: 'Account deleted.' });
});
