import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

/**
 * Which of a profile's sections this carer keeps at the top of their
 * navigation. Pins are personal: each circle member orders their own,
 * according to what matters for the care they give.
 */

export const navPinsRouter = Router({ mergeParams: true });

navPinsRouter.get('/', requireAuth, async (req, res) => {
  const pins = await db('nav_pins')
    .where({ account_id: req.account!.id, care_profile_id: req.params['id'] })
    .orderBy('sort_order', 'asc')
    .select('item_key', 'sort_order');
  res.json({ pins });
});

const pinsSchema = z.object({
  // The full ordered list; the position in the array is the order shown.
  item_keys: z.array(z.string().min(1).max(50)).max(20),
});

navPinsRouter.put('/', requireAuth, async (req, res) => {
  const parsed = pinsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const accountId = req.account!.id;
  const profileId = req.params['id'];
  await db.transaction(async (trx) => {
    await trx('nav_pins').where({ account_id: accountId, care_profile_id: profileId }).del();
    const unique = [...new Set(parsed.data.item_keys)];
    if (unique.length > 0) {
      await trx('nav_pins').insert(
        unique.map((item_key, i) => ({
          account_id: accountId,
          care_profile_id: profileId,
          item_key,
          sort_order: i,
        }))
      );
    }
  });
  const pins = await db('nav_pins')
    .where({ account_id: accountId, care_profile_id: profileId })
    .orderBy('sort_order', 'asc')
    .select('item_key', 'sort_order');
  res.json({ pins });
});
