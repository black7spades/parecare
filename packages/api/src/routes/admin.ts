import { Router } from 'express';
import { z } from 'zod';
import type { Knex } from 'knex';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireRole, roleAtLeast } from '../middleware/requireRole';
import { archiveOldAdministrations } from '../services/marArchive';
import { createAccount, composeDisplayName, AccountError } from '../services/accounts';
import { createInvitation, revokeInvitation, resendInvitation, inviteUrl, effectiveStatus, InviteError } from '../services/invitations';
import type { Account, AccountRole, Invitation, RightsTemplate } from '../types';

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
  'first_name',
  'middle_name',
  'last_name',
  'role',
  'subscription_tier',
  'subscription_status',
  'ai_tokens_used',
  'disabled_at',
  'can_create_care_profiles',
  'can_invite_members',
  'can_use_ai',
  'can_export_data',
  'created_at',
  'updated_at',
] as const;

// Permission groups the admin screens count and filter by. Super admins and
// admins are platform roles; carers and viewers describe what a regular
// user actually does: a carer owns a care profile or contributes to at
// least one circle, a viewer only has view-only memberships.
const OWNS_OR_CONTRIBUTES = `(
  EXISTS (SELECT 1 FROM care_profiles p WHERE p.account_id = accounts.id AND p.archived = false)
  OR EXISTS (SELECT 1 FROM care_circle_members m WHERE m.account_id = accounts.id AND m.invite_accepted = true AND m.permission = 'contributor')
)`;
const HAS_VIEWER_MEMBERSHIP = `EXISTS (
  SELECT 1 FROM care_circle_members m WHERE m.account_id = accounts.id AND m.invite_accepted = true AND m.permission = 'viewer'
)`;

type Group = 'super_admin' | 'admin' | 'carer' | 'viewer';

function applyGroup(q: Knex.QueryBuilder, group: Group): Knex.QueryBuilder {
  if (group === 'super_admin') return q.where('accounts.role', 'super_admin');
  if (group === 'admin') return q.where('accounts.role', 'admin');
  if (group === 'carer') return q.where('accounts.role', 'user').whereRaw(OWNS_OR_CONTRIBUTES);
  return q.where('accounts.role', 'user').whereRaw(`NOT ${OWNS_OR_CONTRIBUTES}`).whereRaw(HAS_VIEWER_MEMBERSHIP);
}

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

const count = async (q: Knex.QueryBuilder): Promise<number> => {
  const row = (await q.count('id as count').first()) as { count?: string } | undefined;
  return Number(row?.count ?? 0);
};

adminRouter.get('/stats', async (_req, res) => {
  const [total, superAdmins, admins, carers, viewers, byTier] = await Promise.all([
    count(db('accounts')),
    count(applyGroup(db('accounts'), 'super_admin')),
    count(applyGroup(db('accounts'), 'admin')),
    count(applyGroup(db('accounts'), 'carer')),
    count(applyGroup(db('accounts'), 'viewer')),
    db('accounts').select('subscription_tier').count('id as count').groupBy('subscription_tier'),
  ]);
  res.json({
    total,
    groups: { super_admin: superAdmins, admin: admins, carer: carers, viewer: viewers },
    by_tier: Object.fromEntries(byTier.map((r) => [r.subscription_tier, Number(r.count)])),
  });
});

const listQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['name', 'email', 'role', 'tier', 'joined']).default('joined'),
  order: z.enum(['asc', 'desc']).optional(),
  group: z.enum(['super_admin', 'admin', 'carer', 'viewer']).optional(),
  role: z.enum(['super_admin', 'admin', 'user']).optional(),
  tier: z.enum(['free', 'family', 'professional']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

adminRouter.get('/accounts', async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', code: 'VALIDATION_ERROR' });
    return;
  }
  const { search, page, per_page, sort, group, role, tier, status } = parsed.data;
  const order = parsed.data.order ?? (sort === 'joined' ? 'desc' : 'asc');

  const base = db<Account>('accounts');
  if (search) {
    base.where((qb) => {
      qb.whereILike('email', `%${search}%`).orWhereILike('display_name', `%${search}%`);
    });
  }
  if (group) applyGroup(base, group);
  if (role) base.where('accounts.role', role);
  if (tier) base.where('subscription_tier', tier);
  if (status === 'active') base.whereNull('disabled_at');
  if (status === 'disabled') base.whereNotNull('disabled_at');

  // People sort by surname; accounts without one fall back to display name.
  const ORDER_BY: Record<typeof sort, string> = {
    name: `lower(coalesce(last_name, display_name)) ${order}, lower(display_name) ${order}`,
    email: `lower(email) ${order}`,
    role: `role ${order}, lower(display_name) asc`,
    tier: `subscription_tier ${order}, lower(display_name) asc`,
    joined: `created_at ${order}`,
  };

  const [accounts, total] = await Promise.all([
    base
      .clone()
      .select(ACCOUNT_COLUMNS)
      .orderByRaw(ORDER_BY[sort])
      .limit(per_page)
      .offset((page - 1) * per_page),
    count(base.clone()),
  ]);

  res.json({ accounts, total, page, per_page });
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
  first_name: z.string().min(1).max(100).optional(),
  middle_name: z.string().max(100).optional().nullable(),
  last_name: z.string().max(100).optional().nullable(),
  email: z.string().email().optional(),
  subscription_tier: z.enum(['free', 'family', 'professional']).optional(),
  can_create_care_profiles: z.boolean().optional(),
  can_invite_members: z.boolean().optional(),
  can_use_ai: z.boolean().optional(),
  can_export_data: z.boolean().optional(),
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

  const updates: Record<string, unknown> = { ...parsed.data };
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No fields to update', code: 'VALIDATION_ERROR' });
    return;
  }

  // Changing any name part recomposes the display name.
  const partKeys = ['first_name', 'middle_name', 'last_name'] as const;
  if (partKeys.some((k) => k in parsed.data)) {
    const merged = {
      first_name: 'first_name' in parsed.data ? (parsed.data.first_name?.trim() || null) : target.first_name,
      middle_name: 'middle_name' in parsed.data ? (parsed.data.middle_name?.trim() || null) : target.middle_name,
      last_name: 'last_name' in parsed.data ? (parsed.data.last_name?.trim() || null) : target.last_name,
    };
    if (!merged.first_name) {
      res.status(400).json({ error: 'A first name is required', code: 'VALIDATION_ERROR' });
      return;
    }
    Object.assign(updates, merged, { display_name: composeDisplayName(merged) });
  }

  if (parsed.data.email) {
    const newEmail = parsed.data.email.toLowerCase();
    updates.email = newEmail;
    if (newEmail !== target.email.toLowerCase()) {
      const existing = await db<Account>('accounts').whereRaw('lower(email) = ?', [newEmail]).first();
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
  first_name: z.string().min(1).max(100),
  middle_name: z.string().max(100).optional().nullable(),
  last_name: z.string().max(100).optional().nullable(),
  password: z.string().min(8),
  role: z.enum(['super_admin', 'admin', 'user']).default('user'),
  // Admin-created accounts are usually carers joining existing circles, so
  // creating their own care profiles is off unless the admin says otherwise.
  can_create_care_profiles: z.boolean().default(false),
  can_invite_members: z.boolean().default(true),
  can_use_ai: z.boolean().default(true),
  can_export_data: z.boolean().default(true),
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

// --- Rights templates: named bundles of the per-account rights ---
// Define once ("Night carer"), apply to any number of accounts at once.
// Applying stamps the values onto each account; individual accounts can
// still be adjusted afterwards.

const RIGHT_FIELDS = ['can_create_care_profiles', 'can_invite_members', 'can_use_ai', 'can_export_data'] as const;

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional().nullable(),
  can_create_care_profiles: z.boolean(),
  can_invite_members: z.boolean(),
  can_use_ai: z.boolean(),
  can_export_data: z.boolean(),
});

adminRouter.get('/rights-templates', async (_req, res) => {
  const templates = await db<RightsTemplate>('rights_templates').orderByRaw('lower(name) asc');
  res.json({ templates });
});

adminRouter.post('/rights-templates', async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  try {
    const [template] = await db<RightsTemplate>('rights_templates')
      .insert({ ...parsed.data, created_by_account_id: req.account!.id })
      .returning('*');
    res.status(201).json({ template });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'A template with this name already exists', code: 'DUPLICATE_NAME' });
      return;
    }
    throw err;
  }
});

adminRouter.patch('/rights-templates/:templateId', async (req, res) => {
  const parsed = templateSchema.partial().safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  try {
    const [template] = await db<RightsTemplate>('rights_templates')
      .where({ id: req.params.templateId })
      .update({ ...parsed.data, updated_at: db.fn.now() })
      .returning('*');
    if (!template) {
      res.status(404).json({ error: 'Template not found', code: 'NOT_FOUND' });
      return;
    }
    res.json({ template });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'A template with this name already exists', code: 'DUPLICATE_NAME' });
      return;
    }
    throw err;
  }
});

adminRouter.delete('/rights-templates/:templateId', async (req, res) => {
  const affected = await db('rights_templates').where({ id: req.params.templateId }).delete();
  if (!affected) {
    res.status(404).json({ error: 'Template not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Template deleted.' });
});

// Stamp a template's rights onto a set of accounts. The usual management
// rule applies: admins can only change regular users; super admins anyone.
adminRouter.post('/rights-templates/:templateId/apply', async (req, res) => {
  const parsed = z.object({ account_ids: z.array(z.string().uuid()).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const template = await db<RightsTemplate>('rights_templates').where({ id: req.params.templateId }).first();
  if (!template) {
    res.status(404).json({ error: 'Template not found', code: 'NOT_FOUND' });
    return;
  }

  const rights = Object.fromEntries(RIGHT_FIELDS.map((f) => [f, template[f]]));
  const applied: string[] = [];
  const skipped: Array<{ account_id: string; reason: string }> = [];
  for (const accountId of [...new Set(parsed.data.account_ids)]) {
    const target = await db<Account>('accounts').where({ id: accountId }).first();
    if (!target) {
      skipped.push({ account_id: accountId, reason: 'Account not found.' });
      continue;
    }
    if (!canManage(req.account!, target)) {
      skipped.push({ account_id: accountId, reason: `${target.display_name}: admins can only manage regular users.` });
      continue;
    }
    await db('accounts').where({ id: target.id }).update({ ...rights, updated_at: db.fn.now() });
    applied.push(target.id);
  }
  res.json({ applied, skipped, template: { id: template.id, name: template.name } });
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
