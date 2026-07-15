import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

/**
 * Instance-wide shared condition catalogue, mirroring the medication
 * catalogue. Any signed-in user can search it for typeahead suggestions.
 * New entries are created implicitly when someone records a condition
 * that is not in it yet (via resolveConditionCatalogueId), so a condition
 * typed once becomes a suggestion for everyone from then on.
 */
export const conditionCatalogueRouter = Router();

/** Find the shared catalogue entry for a condition, creating it if new. */
export async function resolveConditionCatalogueId(name: string, accountId?: string): Promise<string> {
  const n = name.trim();
  const find = () => db('condition_catalogue').whereRaw('lower(name) = lower(?)', [n]).first();
  const existing = await find();
  if (existing) return existing.id as string;
  try {
    const [row] = await db('condition_catalogue')
      .insert({ name: n, created_by_account_id: accountId ?? null })
      .returning('id');
    return (row as { id: string }).id;
  } catch {
    // Lost a race on the unique index — the entry now exists, so reuse it.
    const again = await find();
    if (again) return again.id as string;
    throw new Error('Could not resolve condition catalogue entry');
  }
}

conditionCatalogueRouter.get('/', requireAuth, async (req, res) => {
  const q = String(req.query['search'] ?? '').trim();
  let query = db('condition_catalogue').select('id', 'name', 'icd10_code', 'snomed_code');
  // A search by standard code finds the condition too, so a clinician can
  // type "E11" and land on Type 2 diabetes.
  if (q) {
    query = query.where((qb) => {
      qb.whereILike('name', `%${q}%`).orWhereILike('icd10_code', `${q}%`).orWhereILike('snomed_code', `${q}%`);
    });
  }
  const items = await query.orderBy('name', 'asc').limit(50);
  res.json({ items });
});
