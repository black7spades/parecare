import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';

export const siteCopyRouter = Router();

siteCopyRouter.get('/', requireAuth, async (_req, res) => {
  const rows = await db('site_copy').select('key', 'copy');
  const copy: Record<string, string> = {};
  for (const r of rows) copy[r.key] = r.copy;
  res.json({ copy });
});

const patchSchema = z.record(z.string().min(1).max(120), z.string().max(500));

siteCopyRouter.patch('/', requireAuth, requireRole('super_admin'), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Each key must be 1-120 characters, each value up to 500 characters.' });
    return;
  }
  const entries = Object.entries(parsed.data);
  if (entries.length === 0) {
    res.status(400).json({ error: 'Nothing to save.' });
    return;
  }

  await db.transaction(async (trx) => {
    for (const [key, copy] of entries) {
      await trx('site_copy')
        .insert({ key, copy, updated_at: trx.fn.now() })
        .onConflict('key')
        .merge({ copy, updated_at: trx.fn.now() });
    }
  });

  const rows = await db('site_copy').select('key', 'copy');
  const copy: Record<string, string> = {};
  for (const r of rows) copy[r.key] = r.copy;
  res.json({ copy });
});
