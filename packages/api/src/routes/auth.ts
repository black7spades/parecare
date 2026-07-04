import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../config/database';
import { env } from '../config/env';
import { getOAuthConfig, getStorageConfig } from '../config/settings';
import { requireAuth } from '../middleware/auth';
import { generateSecret, otpauthUrl, verifyTotp } from '../services/totp';
import { uploadFile, deleteFile, getDownloadUrl } from '../services/storage';
import type { Account } from '../types';

export const authRouter = Router();

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB — avatars
});

export function issueSessionToken(accountId: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign({ accountId }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as any);
}

export function issueMfaToken(accountId: string): string {
  return jwt.sign({ accountId, purpose: 'mfa' }, env.JWT_SECRET, { expiresIn: '5m' });
}

export function accountSummary(account: Account) {
  return {
    id: account.id,
    email: account.email,
    display_name: account.display_name,
    role: account.role,
    avatar_url: account.avatar_url ?? null,
    subscription_tier: account.subscription_tier,
    subscription_status: account.subscription_status,
  };
}

// Which sign-in methods this server supports, so the UI can show buttons
authRouter.get('/providers', (_req, res) => {
  const oauth = getOAuthConfig();
  res.json({
    google: !!(oauth.googleClientId && oauth.googleClientSecret),
    facebook: !!(oauth.facebookAppId && oauth.facebookAppSecret),
  });
});

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

  const { password, display_name } = parsed.data;
  const email = parsed.data.email.toLowerCase(); // emails are case-insensitive
  const existing = await db<Account>('accounts').whereRaw('lower(email) = ?', [email]).first();
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists', code: 'DUPLICATE_EMAIL' });
    return;
  }

  const password_hash = await bcrypt.hash(password, 12);
  // The configured super admin email is promoted on registration so a fresh
  // install doesn't need a manual step or restart to get its super admin.
  const role = env.SUPER_ADMIN_EMAIL === email ? 'super_admin' : 'user';
  const [account] = await db<Account>('accounts')
    .insert({ email, password_hash, display_name, role })
    .returning(['id', 'email', 'display_name', 'role', 'subscription_tier', 'subscription_status', 'created_at']);

  res.status(201).json({ token: issueSessionToken(account.id), account });
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const { password } = parsed.data;
  const email = parsed.data.email.toLowerCase();
  const account = await db<Account>('accounts').whereRaw('lower(email) = ?', [email]).first();
  if (!account) {
    res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    return;
  }

  if (!account.password_hash) {
    res.status(401).json({
      error: `This account signs in with ${account.oauth_provider === 'facebook' ? 'Facebook' : 'Google'}. Use the button above.`,
      code: 'OAUTH_ONLY_ACCOUNT',
    });
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

  if (account.mfa_enabled) {
    // Password was right, but the session only starts after the code check
    res.json({ mfa_required: true, mfa_token: issueMfaToken(account.id) });
    return;
  }

  res.json({ token: issueSessionToken(account.id), account: accountSummary(account) });
});

// Second step of login for accounts with MFA enabled
authRouter.post('/mfa/challenge', async (req, res) => {
  const parsed = z.object({ mfa_token: z.string(), code: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  let accountId: string;
  try {
    const payload = jwt.verify(parsed.data.mfa_token, env.JWT_SECRET) as { accountId: string; purpose?: string };
    if (payload.purpose !== 'mfa') throw new Error('wrong purpose');
    accountId = payload.accountId;
  } catch {
    res.status(401).json({ error: 'Sign in again to get a new code prompt', code: 'MFA_TOKEN_EXPIRED' });
    return;
  }

  const account = await db<Account>('accounts').where({ id: accountId }).first();
  if (!account?.mfa_enabled || !account.mfa_secret || !verifyTotp(account.mfa_secret, parsed.data.code)) {
    res.status(401).json({ error: "That code didn't match. Check your authenticator app.", code: 'MFA_INVALID_CODE' });
    return;
  }

  res.json({ token: issueSessionToken(account.id), account: accountSummary(account) });
});

// --- MFA management (logged-in users) ---

authRouter.post('/mfa/setup', requireAuth, async (req, res) => {
  const account = req.account!;
  if (account.mfa_enabled) {
    res.status(409).json({ error: 'MFA is already enabled', code: 'MFA_ALREADY_ENABLED' });
    return;
  }
  const secret = generateSecret();
  await db('accounts').where({ id: account.id }).update({ mfa_secret: secret, updated_at: db.fn.now() });
  res.json({ secret, otpauth_url: otpauthUrl(secret, account.email) });
});

authRouter.post('/mfa/verify', requireAuth, async (req, res) => {
  const parsed = z.object({ code: z.string() }).safeParse(req.body);
  const account = req.account!;
  if (!parsed.success || !account.mfa_secret) {
    res.status(400).json({ error: 'Run MFA setup first', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!verifyTotp(account.mfa_secret, parsed.data.code)) {
    res.status(401).json({ error: "That code didn't match. Scan the QR code again and retry.", code: 'MFA_INVALID_CODE' });
    return;
  }
  await db('accounts').where({ id: account.id }).update({ mfa_enabled: true, updated_at: db.fn.now() });
  res.json({ message: 'MFA enabled.' });
});

authRouter.post('/mfa/disable', requireAuth, async (req, res) => {
  const parsed = z.object({ code: z.string() }).safeParse(req.body);
  const account = req.account!;
  if (!account.mfa_enabled || !account.mfa_secret) {
    res.status(409).json({ error: 'MFA is not enabled', code: 'MFA_NOT_ENABLED' });
    return;
  }
  if (!parsed.success || !verifyTotp(account.mfa_secret, parsed.data.code)) {
    res.status(401).json({ error: 'Enter a current code from your authenticator app to disable MFA', code: 'MFA_INVALID_CODE' });
    return;
  }
  await db('accounts')
    .where({ id: account.id })
    .update({ mfa_enabled: false, mfa_secret: null, updated_at: db.fn.now() });
  res.json({ message: 'MFA disabled.' });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const account = req.account!;
  res.json({
    id: account.id,
    email: account.email,
    display_name: account.display_name,
    role: account.role,
    avatar_url: account.avatar_url ?? null,
    date_of_birth: account.date_of_birth ?? null,
    gender: account.gender ?? null,
    pronouns: account.pronouns ?? null,
    subscription_tier: account.subscription_tier,
    subscription_status: account.subscription_status,
    current_period_end: account.current_period_end,
    ai_tokens_used: account.ai_tokens_used,
    ai_tokens_reset_at: account.ai_tokens_reset_at,
    mfa_enabled: account.mfa_enabled,
    oauth_provider: account.oauth_provider,
    has_password: !!account.password_hash,
  });
});

const updateMeSchema = z.object({
  display_name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  current_password: z.string().optional(),
  new_password: z.string().min(8).optional(),
  date_of_birth: z.string().optional().nullable(),
  gender: z.string().max(50).optional().nullable(),
  pronouns: z.string().max(50).optional().nullable(),
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
  if (parsed.data.date_of_birth !== undefined) updates.date_of_birth = parsed.data.date_of_birth || null;
  if (parsed.data.gender !== undefined) updates.gender = parsed.data.gender || null;
  if (parsed.data.pronouns !== undefined) updates.pronouns = parsed.data.pronouns || null;
  if (parsed.data.email && parsed.data.email.toLowerCase() !== account.email.toLowerCase()) {
    const newEmail = parsed.data.email.toLowerCase();
    const existing = await db<Account>('accounts').whereRaw('lower(email) = ?', [newEmail]).first();
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists', code: 'DUPLICATE_EMAIL' });
      return;
    }
    updates.email = newEmail;
  }

  if (parsed.data.new_password) {
    if (!account.password_hash) {
      res.status(400).json({ error: 'This account signs in with a social provider and has no password', code: 'OAUTH_ONLY_ACCOUNT' });
      return;
    }
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

// Upload / replace the current user's avatar
authRouter.post('/me/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  const account = req.account!;
  if (!req.file) {
    res.status(400).json({ error: 'No image provided', code: 'VALIDATION_ERROR' });
    return;
  }
  if (!req.file.mimetype.startsWith('image/')) {
    res.status(400).json({ error: 'Avatar must be an image', code: 'VALIDATION_ERROR' });
    return;
  }
  if (account.avatar_url) await deleteFile(account.avatar_url).catch(() => {});
  const ext = path.extname(req.file.originalname) || '.jpg';
  const key = `avatar/${account.id}/${Date.now()}${ext}`;
  const avatar_url = await uploadFile(req.file.buffer, key, req.file.mimetype);
  await db('accounts').where({ id: account.id }).update({ avatar_url, updated_at: db.fn.now() });
  res.json({ avatar_url });
});

// Remove the current user's avatar
authRouter.delete('/me/avatar', requireAuth, async (req, res) => {
  const account = req.account!;
  if (account.avatar_url) await deleteFile(account.avatar_url).catch(() => {});
  await db('accounts').where({ id: account.id }).update({ avatar_url: null, updated_at: db.fn.now() });
  res.json({ message: 'Avatar removed.' });
});

// Serve any account's avatar to authenticated users (<img> can't send the
// auth header, so this is fetched as a blob by the client).
authRouter.get('/avatar/:accountId', requireAuth, async (req, res) => {
  const account = await db<Account>('accounts').where({ id: req.params['accountId'] }).first();
  if (!account?.avatar_url) {
    res.status(404).json({ error: 'No avatar', code: 'NOT_FOUND' });
    return;
  }
  if (!account.avatar_url.startsWith('/uploads/')) {
    res.redirect(await getDownloadUrl(account.avatar_url));
    return;
  }
  const localPath = path.join(getStorageConfig().localPath, account.avatar_url.slice('/uploads/'.length));
  res.sendFile(localPath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Avatar missing from storage', code: 'NOT_FOUND' });
    }
  });
});
