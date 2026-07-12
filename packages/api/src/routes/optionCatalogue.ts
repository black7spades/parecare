import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

/**
 * Instance-wide shared lists of selectable values, categorised, backing
 * every dropdown that used to be a free-text box. Any signed-in user can
 * search a category for typeahead suggestions. New entries are created
 * implicitly when someone saves a value that is not listed yet (via
 * resolveOptions), so a value typed once is offered to everyone after.
 */
export const optionCatalogueRouter = Router();

export const OPTION_CATEGORIES = [
  'allergen',
  'allergy_reaction',
  'dietary_requirement',
  'mobility_aid',
  'communication_need',
  'directive_location',
] as const;

export type OptionCategory = (typeof OPTION_CATEGORIES)[number];

/** Ensure every value exists in the category's shared list. */
export async function resolveOptions(
  category: OptionCategory,
  values: Array<string | null | undefined>,
  accountId?: string
): Promise<void> {
  const unique = [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))];
  for (const name of unique) {
    const existing = await db('option_catalogue')
      .where({ category })
      .whereRaw('lower(name) = lower(?)', [name])
      .first();
    if (existing) continue;
    try {
      await db('option_catalogue').insert({ category, name, created_by_account_id: accountId ?? null });
    } catch {
      // Lost a race on the unique index — the entry now exists, fine.
    }
  }
}

optionCatalogueRouter.get('/', requireAuth, async (req, res) => {
  const category = String(req.query['category'] ?? '');
  if (!(OPTION_CATEGORIES as readonly string[]).includes(category)) {
    res.status(400).json({ error: 'Unknown option category', code: 'VALIDATION_ERROR' });
    return;
  }
  const q = String(req.query['search'] ?? '').trim();
  let query = db('option_catalogue').where({ category }).select('id', 'name');
  if (q) query = query.whereILike('name', `%${q}%`);
  const items = await query.orderBy('name', 'asc').limit(50);
  res.json({ items });
});
