import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import type { Supplier } from '../types';

/**
 * Account-level supplier directory. Suppliers are the pharmacies and shops a
 * medication is reordered from, shared across every profile in the account and
 * kept separate from care providers. The medication editor pulls its
 * "reordered from" field from here, and creates a new supplier when one does
 * not exist yet.
 */
export const suppliersRouter = Router();

const SUPPLIER_COLS = ['id', 'account_id', 'name', 'suburb', 'phone', 'order_url', 'created_at'] as const;

const supplierSchema = z.object({
  name: z.string().min(1).max(255),
  suburb: z.string().max(120).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  order_url: z.string().url().max(2000).optional().nullable().or(z.literal('')),
});

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

// Accept a bare domain by defaulting to https, so a pasted link works.
const normaliseUrl = (v: string | null | undefined): string | null => {
  const u = (v ?? '').trim();
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
};

/** List or search the account's suppliers, name first, for the picker. */
suppliersRouter.get('/', requireAuth, async (req, res) => {
  const q = (req.query['q'] as string || '').trim();
  let query = db<Supplier>('suppliers')
    .where({ account_id: req.account!.id })
    .orderBy([{ column: 'name', order: 'asc' }, { column: 'suburb', order: 'asc' }])
    .limit(200)
    .select(...SUPPLIER_COLS);
  if (q) {
    query = query.where((qb) => {
      qb.whereRaw('name ilike ?', [`%${q}%`]).orWhereRaw('suburb ilike ?', [`%${q}%`]);
    });
  }
  const suppliers = await query;
  res.json({ suppliers });
});

/** Create a supplier, reusing an existing one with the same vendor+suburb. */
suppliersRouter.post('/', requireAuth, async (req, res) => {
  const parsed = supplierSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const name = parsed.data.name.trim();
  const suburb = clean(parsed.data.suburb);

  // A supplier is unique by vendor name and suburb within the account, so the
  // same branch is never created twice; return the existing one if it is there.
  const existing = await db<Supplier>('suppliers')
    .where({ account_id: req.account!.id })
    .whereRaw('lower(name) = lower(?)', [name])
    .modify((qb) => {
      if (suburb === null) qb.whereNull('suburb');
      else qb.whereRaw('lower(suburb) = lower(?)', [suburb]);
    })
    .first();
  if (existing) {
    res.status(200).json({ supplier: existing });
    return;
  }

  const [supplier] = await db<Supplier>('suppliers')
    .insert({
      account_id: req.account!.id,
      name,
      suburb,
      phone: clean(parsed.data.phone),
      order_url: normaliseUrl(parsed.data.order_url),
    })
    .returning([...SUPPLIER_COLS]);
  res.status(201).json({ supplier });
});
