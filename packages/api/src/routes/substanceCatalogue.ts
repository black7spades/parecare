import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

/**
 * Instance-wide shared substance catalogue, mirroring the condition and
 * medication catalogues. Any signed-in user can search it for typeahead
 * suggestions. New entries are created implicitly when someone records a
 * substance that is not in it yet (via resolveSubstanceCatalogueId), so a
 * substance typed once becomes a suggestion for everyone from then on.
 */
export const substanceCatalogueRouter = Router();

export const SUBSTANCE_CLASSES = [
  'nicotine',
  'alcohol',
  'cannabis',
  'opioid',
  'stimulant',
  'depressant',
  'hallucinogen',
  'inhalant',
  'other',
] as const;

/** Find the shared catalogue entry for a substance, creating it if new. */
export async function resolveSubstanceCatalogueId(name: string, substanceClass?: string | null, accountId?: string): Promise<string> {
  const n = name.trim();
  const find = () => db('substance_catalogue').whereRaw('lower(name) = lower(?)', [n]).first();
  const existing = await find();
  if (existing) return existing.id as string;
  const cls = substanceClass && (SUBSTANCE_CLASSES as readonly string[]).includes(substanceClass) ? substanceClass : 'other';
  try {
    const [row] = await db('substance_catalogue')
      .insert({ name: n, substance_class: cls, created_by_account_id: accountId ?? null })
      .returning('id');
    return (row as { id: string }).id;
  } catch {
    // Lost a race on the unique index — the entry now exists, so reuse it.
    const again = await find();
    if (again) return again.id as string;
    throw new Error('Could not resolve substance catalogue entry');
  }
}

substanceCatalogueRouter.get('/', requireAuth, async (req, res) => {
  const q = String(req.query['search'] ?? '').trim();
  let query = db('substance_catalogue').select('id', 'name', 'substance_class');
  if (q) query = query.whereILike('name', `${q}%`);
  const items = await query.orderBy('name', 'asc').limit(50);
  res.json({ items });
});
