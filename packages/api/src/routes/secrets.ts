import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { decryptSecret, encryptSecret } from '../services/secretsCrypto';

/**
 * The secrets vault: the logins kept for someone's life admin, such as their
 * social accounts, the rental portal, or the bank. These are the most
 * sensitive rows in PareCare, so the rule is deliberately narrow and does not
 * follow the usual care-circle sharing.
 *
 * Who may read or write them:
 *   - the account owner, always;
 *   - a power of attorney holder in the care circle, but only once a date of
 *     death has been recorded against the person, since settling an estate
 *     means getting into their accounts.
 *
 * Nobody else, and that includes platform admins and super admins: a carer,
 * an editor or a viewer never sees them, and no admin screen surfaces them.
 * Passwords are stored encrypted at rest and only decrypted for the two roles
 * above.
 */
export const secretsRouter = Router({ mergeParams: true });

// Mounted under /care-profiles/:id, so the profile id arrives via mergeParams
// and is not part of this router's own path types.
const params = (req: { params: unknown }) => req.params as Record<string, string>;

const secretCategory = z.enum([
  'social',
  'bank',
  'rental',
  'utility',
  'government',
  'shopping',
  'email',
  'other',
]);

const secretSchema = z.object({
  category: secretCategory.default('other'),
  label: z.string().min(1).max(255),
  website_url: z.string().max(500).optional().nullable(),
  username: z.string().max(255).optional().nullable(),
  password: z.string().max(500).optional().nullable(),
  account_number: z.string().max(120).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export type SecretsAccess = 'owner' | 'poa' | null;

/**
 * Who this account is to the secrets of this profile. Returns null when they
 * may not see them at all, which is everyone except the owner and, after a
 * death is recorded, a power of attorney holder.
 */
export async function secretsAccessFor(profileId: string, accountId: string): Promise<SecretsAccess> {
  const profile = await db('care_profiles').where({ id: profileId }).first();
  if (!profile) return null;
  if (profile.account_id === accountId) return 'owner';
  // A power of attorney only unlocks the vault once the person has died.
  if (!profile.died_on) return null;
  const member = await db('care_circle_members')
    .where({ care_profile_id: profileId, account_id: accountId, invite_accepted: true })
    .first();
  if (member?.poa_type) return 'poa';
  return null;
}

/** Reject anyone who is neither the owner nor a power of attorney after death. */
async function gate(req: { params: Record<string, string>; account?: { id: string } }): Promise<SecretsAccess> {
  const profileId = params(req)['id'];
  const accountId = req.account?.id;
  if (!profileId || !accountId) return null;
  return secretsAccessFor(profileId, accountId);
}

const readable = (row: Record<string, unknown>) => ({
  ...row,
  password: decryptSecret(row['password'] as string | null),
});

/**
 * Whether this viewer may see the vault at all, so the Documents page knows
 * whether to offer the section rather than showing a section that 403s.
 */
secretsRouter.get('/access', async (req, res) => {
  const access = await gate(req as never);
  res.json({ access, can_view: access !== null });
});

secretsRouter.get('/', async (req, res) => {
  const access = await gate(req as never);
  if (!access) {
    res.status(403).json({ error: 'Secrets are visible to the account owner only', code: 'FORBIDDEN' });
    return;
  }
  const rows = await db('secrets')
    .where({ care_profile_id: params(req)['id'] })
    .orderBy([{ column: 'category', order: 'asc' }, { column: 'label', order: 'asc' }]);
  res.json({ secrets: rows.map(readable), access });
});

secretsRouter.post('/', async (req, res) => {
  const access = await gate(req as never);
  if (!access) {
    res.status(403).json({ error: 'Secrets are visible to the account owner only', code: 'FORBIDDEN' });
    return;
  }
  const parsed = secretSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const { password, ...rest } = parsed.data;
  const [row] = await db('secrets')
    .insert({
      care_profile_id: params(req)['id'],
      created_by_account_id: req.account!.id,
      ...rest,
      password: encryptSecret(password),
    })
    .returning('*');
  res.status(201).json({ secret: readable(row) });
});

secretsRouter.patch('/:secretId', async (req, res) => {
  const access = await gate(req as never);
  if (!access) {
    res.status(403).json({ error: 'Secrets are visible to the account owner only', code: 'FORBIDDEN' });
    return;
  }
  const parsed = secretSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const { password, ...rest } = parsed.data;
  const updates: Record<string, unknown> = { ...rest, updated_at: db.fn.now() };
  // Only touch the password when the field was actually sent, so editing the
  // username alone does not wipe the stored password.
  if (password !== undefined) updates['password'] = encryptSecret(password);

  const [row] = await db('secrets')
    .where({ id: params(req)['secretId'], care_profile_id: params(req)['id'] })
    .update(updates)
    .returning('*');
  if (!row) {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ secret: readable(row) });
});

secretsRouter.delete('/:secretId', async (req, res) => {
  const access = await gate(req as never);
  if (!access) {
    res.status(403).json({ error: 'Secrets are visible to the account owner only', code: 'FORBIDDEN' });
    return;
  }
  const affected = await db('secrets')
    .where({ id: params(req)['secretId'], care_profile_id: params(req)['id'] })
    .delete();
  if (!affected) {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Deleted.' });
});
