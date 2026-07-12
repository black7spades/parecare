import { Router } from 'express';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

/**
 * Personal access tokens, so bots and outside apps (a Discord bot, a
 * Telegram bot, a home automation script) can call the PareCare API as
 * this account without a browser session. The token is shown once at
 * creation; only its hash is stored. Tokens carry the account's full
 * access and can be revoked at any time.
 */
export const apiKeysRouter = Router();

export const API_KEY_PREFIX = 'pc_';

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

apiKeysRouter.get('/', requireAuth, async (req, res) => {
  const keys = await db('api_keys')
    .where({ account_id: req.account!.id })
    .whereNull('revoked_at')
    .orderBy('created_at', 'desc')
    .select('id', 'label', 'token_prefix', 'created_at', 'last_used_at');
  res.json({ keys });
});

apiKeysRouter.post('/', requireAuth, async (req, res) => {
  const parsed = z.object({ label: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const token = `${API_KEY_PREFIX}${randomBytes(24).toString('hex')}`;
  const [key] = await db('api_keys')
    .insert({
      account_id: req.account!.id,
      label: parsed.data.label,
      token_hash: hashApiKey(token),
      token_prefix: token.slice(0, 10),
    })
    .returning(['id', 'label', 'token_prefix', 'created_at']);
  // The only time the token is ever shown.
  res.status(201).json({ key, token });
});

apiKeysRouter.delete('/:keyId', requireAuth, async (req, res) => {
  const affected = await db('api_keys')
    .where({ id: req.params['keyId'], account_id: req.account!.id })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now() });
  if (!affected) {
    res.status(404).json({ error: 'API key not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'API key revoked. Anything using it stops working now.' });
});
