import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../config/database';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import type { Account } from '../types';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  display_name: z.string().min(1).max(255),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const { email, password, display_name } = parsed.data;
  const existing = await db<Account>('accounts').where({ email }).first();
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists', code: 'DUPLICATE_EMAIL' });
    return;
  }

  const password_hash = await bcrypt.hash(password, 12);
  // The configured super admin email is promoted on registration so a fresh
  // install doesn't need a manual step or restart to get its super admin.
  const role = env.SUPER_ADMIN_EMAIL === email.toLowerCase() ? 'super_admin' : 'user';
  const [account] = await db<Account>('accounts')
    .insert({ email, password_hash, display_name, role })
    .returning(['id', 'email', 'display_name', 'role', 'subscription_tier', 'subscription_status', 'created_at']);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = jwt.sign({ accountId: account.id }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as any);
  res.status(201).json({ token, account });
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const { email, password } = parsed.data;
  const account = await db<Account>('accounts').where({ email }).first();
  if (!account) {
    res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    return;
  }

  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    return;
  }

  // Covers installs where migrations ran after the API started (so the
  // startup bootstrap couldn't promote the configured super admin).
  if (env.SUPER_ADMIN_EMAIL === account.email.toLowerCase() && account.role !== 'super_admin') {
    await db('accounts').where({ id: account.id }).update({ role: 'super_admin', updated_at: db.fn.now() });
    account.role = 'super_admin';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = jwt.sign({ accountId: account.id }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as any);
  res.json({
    token,
    account: {
      id: account.id,
      email: account.email,
      display_name: account.display_name,
      role: account.role,
      subscription_tier: account.subscription_tier,
      subscription_status: account.subscription_status,
    },
  });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const account = req.account!;
  res.json({
    id: account.id,
    email: account.email,
    display_name: account.display_name,
    role: account.role,
    subscription_tier: account.subscription_tier,
    subscription_status: account.subscription_status,
    current_period_end: account.current_period_end,
    ai_tokens_used: account.ai_tokens_used,
    ai_tokens_reset_at: account.ai_tokens_reset_at,
  });
});

const updateMeSchema = z.object({
  display_name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  current_password: z.string().optional(),
  new_password: z.string().min(8).optional(),
});

authRouter.patch('/me', requireAuth, async (req, res) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const account = req.account!;
  const updates: Partial<Account> & { password_hash?: string } = {};

  if (parsed.data.display_name) updates.display_name = parsed.data.display_name;
  if (parsed.data.email && parsed.data.email !== account.email) {
    const existing = await db<Account>('accounts').where({ email: parsed.data.email }).first();
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists', code: 'DUPLICATE_EMAIL' });
      return;
    }
    updates.email = parsed.data.email;
  }

  if (parsed.data.new_password) {
    if (!parsed.data.current_password) {
      res.status(400).json({ error: 'Current password required to set a new one', code: 'VALIDATION_ERROR' });
      return;
    }
    const valid = await bcrypt.compare(parsed.data.current_password, account.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Current password is incorrect', code: 'INVALID_CREDENTIALS' });
      return;
    }
    updates.password_hash = await bcrypt.hash(parsed.data.new_password, 12);
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No fields to update', code: 'VALIDATION_ERROR' });
    return;
  }

  await db('accounts').where({ id: account.id }).update({ ...updates, updated_at: db.fn.now() });
  res.json({ message: 'Account updated.' });
});
