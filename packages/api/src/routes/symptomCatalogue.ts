import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

export const symptomCatalogueRouter = Router();

export async function resolveSymptomCatalogueId(name: string, accountId?: string): Promise<string> {
  const n = name.trim();
  const find = () => db('symptom_catalogue').whereRaw('lower(name) = lower(?)', [n]).first();
  const existing = await find();
  if (existing) return existing.id as string;
  try {
    const [row] = await db('symptom_catalogue')
      .insert({ name: n, created_by_account_id: accountId ?? null })
      .returning('id');
    return (row as { id: string }).id;
  } catch {
    const again = await find();
    if (again) return again.id as string;
    throw new Error('Could not resolve symptom catalogue entry');
  }
}

symptomCatalogueRouter.get('/', requireAuth, async (req, res) => {
  const q = String(req.query['search'] ?? '').trim();
  let query = db('symptom_catalogue').select('id', 'name');
  if (q) query = query.whereILike('name', `%${q}%`);
  const items = await query.orderBy('name', 'asc').limit(50);
  res.json({ items });
});
