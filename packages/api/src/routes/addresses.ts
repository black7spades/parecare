import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { addressColumns, ADDRESS_PART_KEYS, RESIDENCE_KIND, syncProfileResidence } from '../services/addresses';

/** Whether a link kind marks the address as where the person lives. */
const isResidenceKind = (kind: string | null | undefined) => kind == null || kind === RESIDENCE_KIND;

/**
 * Addresses linked to one care profile. Mirrors the per-profile providers
 * router: link an existing address from the account's book, or create a new
 * one and link it in a single call. The address lives in the shared book,
 * so editing it in the directory updates it everywhere.
 */
export const addressesRouter = Router({ mergeParams: true });

const ADDRESS_COLS = [
  'a.id', 'a.account_id', 'a.label',
  'a.address_line1', 'a.address_line2', 'a.address_suburb', 'a.address_state', 'a.address_postcode', 'a.address_country',
  'a.formatted', 'a.created_at',
] as const;

const partsSchema = {
  label: z.string().max(255).optional().nullable(),
  address_line1: z.string().max(255).optional().nullable(),
  address_line2: z.string().max(255).optional().nullable(),
  address_suburb: z.string().max(120).optional().nullable(),
  address_state: z.string().max(120).optional().nullable(),
  address_postcode: z.string().max(20).optional().nullable(),
  address_country: z.string().max(120).optional().nullable(),
};

addressesRouter.get('/', requireAuth, async (req, res) => {
  const rows = await db('care_profile_addresses as cpa')
    .join('addresses as a', 'cpa.address_id', 'a.id')
    .where('cpa.care_profile_id', req.params['id'])
    .select(...ADDRESS_COLS, 'cpa.address_kind')
    .orderBy('a.formatted', 'asc');
  res.json({ addresses: rows });
});

// Link an existing address, or create one and link it.
const createSchema = z.object({
  address_id: z.string().uuid().optional().nullable(),
  address_kind: z.string().max(40).optional().nullable(),
  ...partsSchema,
});

addressesRouter.post('/', requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  let addressId = parsed.data.address_id ?? null;
  if (addressId) {
    // Linking an existing address: it must belong to this account.
    const existing = await db('addresses').where({ id: addressId, account_id: req.account!.id }).first();
    if (!existing) {
      res.status(404).json({ error: 'Address not found in this account', code: 'NOT_FOUND' });
      return;
    }
  } else {
    const hasPart = ADDRESS_PART_KEYS.some((k) => (parsed.data as Record<string, unknown>)[k]);
    if (!hasPart) {
      res.status(400).json({ error: 'Provide an address', code: 'VALIDATION_ERROR' });
      return;
    }
    const [created] = await db('addresses')
      .insert({ account_id: req.account!.id, ...addressColumns(parsed.data, parsed.data.label) })
      .returning('id');
    addressId = (created as { id: string }).id;
  }

  // An address linked to a person is where they live unless told otherwise,
  // so default the kind to residence and keep their profile in step below.
  const kind = parsed.data.address_kind ?? RESIDENCE_KIND;
  try {
    await db('care_profile_addresses').insert({
      care_profile_id: req.params['id'],
      address_id: addressId,
      address_kind: kind,
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'Address already linked to this profile', code: 'ALREADY_LINKED' });
      return;
    }
    throw err;
  }

  if (isResidenceKind(kind)) {
    const address = await db('addresses').where({ id: addressId }).first();
    if (address) await syncProfileResidence(req.params['id'] as string, address);
  }

  const [row] = await db('care_profile_addresses as cpa')
    .join('addresses as a', 'cpa.address_id', 'a.id')
    .where({ 'cpa.care_profile_id': req.params['id'], 'cpa.address_id': addressId })
    .select(...ADDRESS_COLS, 'cpa.address_kind');
  res.status(201).json({ address: row });
});

// Edit the linked address itself (in the shared book) and/or its kind here.
addressesRouter.patch('/:addressId', requireAuth, async (req, res) => {
  const parsed = z.object({ address_kind: z.string().max(40).optional().nullable(), ...partsSchema }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const link = await db('care_profile_addresses')
    .where({ care_profile_id: req.params['id'], address_id: req.params['addressId'] })
    .first();
  if (!link) {
    res.status(404).json({ error: 'Address not found', code: 'NOT_FOUND' });
    return;
  }
  const touchesParts = ADDRESS_PART_KEYS.some((k) => k in parsed.data) || 'label' in parsed.data;
  if (touchesParts) {
    const current = await db('addresses').where({ id: req.params['addressId'], account_id: req.account!.id }).first();
    if (current) {
      const merged = { ...current, ...parsed.data };
      await db('addresses')
        .where({ id: req.params['addressId'] })
        .update({ ...addressColumns(merged, merged.label), updated_at: db.fn.now() });
    }
  }
  if (parsed.data.address_kind !== undefined) {
    await db('care_profile_addresses').where({ id: link.id }).update({ address_kind: parsed.data.address_kind, updated_at: db.fn.now() });
  }
  // Keep the person's "where they live" in step: re-sync when this address is
  // their residence, whether the parts changed or the kind became residence.
  const effectiveKind = parsed.data.address_kind !== undefined ? parsed.data.address_kind : link.address_kind;
  if (isResidenceKind(effectiveKind)) {
    const address = await db('addresses').where({ id: req.params['addressId'] }).first();
    if (address) await syncProfileResidence(req.params['id'] as string, address);
  }
  const [row] = await db('care_profile_addresses as cpa')
    .join('addresses as a', 'cpa.address_id', 'a.id')
    .where({ 'cpa.care_profile_id': req.params['id'], 'cpa.address_id': req.params['addressId'] })
    .select(...ADDRESS_COLS, 'cpa.address_kind');
  res.json({ address: row });
});

// Unlink from this profile. The address stays in the book.
addressesRouter.delete('/:addressId', requireAuth, async (req, res) => {
  const affected = await db('care_profile_addresses')
    .where({ care_profile_id: req.params['id'], address_id: req.params['addressId'] })
    .delete();
  if (!affected) {
    res.status(404).json({ error: 'Address not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Address unlinked from this profile.' });
});
