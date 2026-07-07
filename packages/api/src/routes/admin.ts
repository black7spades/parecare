import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireRole, roleAtLeast } from '../middleware/requireRole';
import { archiveOldAdministrations } from '../services/marArchive';
import type { Account, AccountRole } from '../types';

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

  if (updates.email && updates.email !== target.email) {
    const existing = await db<Account>('accounts').where({ email: updates.email }).first();
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists', code: 'DUPLICATE_EMAIL' });
      return;
    }
  }

  const [updated] = await db<Account>('accounts')
    .where({ id: target.id })
    .update({ ...updates, updated_at: db.fn.now() })
    .returning(ACCOUNT_COLUMNS as unknown as string[]);
  res.json(updated);
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
