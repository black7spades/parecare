import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { roleAtLeast } from '../middleware/requireRole';
import { providerAddressFields, withComposedAddress } from './providers';
import { addressColumns, ADDRESS_PART_KEYS, RESIDENCE_KIND, syncProfileResidence, syncResidenceForAddress } from '../services/addresses';
import type { CareProfile, Provider, ProfileKind } from '../types';

export const directoryRouter = Router();

// ── Care profiles (people & pets) ─────────────────────────

/**
 * List care profiles of a given kind for the directory.
 *   super_admin  => every profile of that kind in the system
 *   admin        => profiles belonging to their account
 *   user/viewer  => profiles they can access via care circle (read-only)
 */
function profilesEndpoint(kind: ProfileKind) {
  return async (req: import('express').Request, res: import('express').Response) => {
    const account = req.account!;

    const columns = [
      'cp.id', 'cp.full_name', 'cp.preferred_name', 'cp.date_of_birth',
      'cp.current_phase', 'cp.photo_url', 'cp.photo_color',
      'cp.contact_kind', 'cp.contact_account_id', 'cp.contact_profile_id',
      'cp.contact_name', 'cp.contact_phone', 'cp.contact_email',
      'cp.owner_relationship',
      ...(kind === 'pet' ? ['cp.species', 'cp.breed', 'cp.desexed', 'cp.microchip_number', 'cp.owner_profile_id'] as const : []),
    ];

    // A pet's owner is a person profile; resolve their name for the list.
    const ownerSelect =
      kind === 'pet'
        ? [db.raw(`(SELECT o.full_name FROM care_profiles o WHERE o.id = cp.owner_profile_id) AS owner_name`)]
        : [];

    let query = db('care_profiles as cp')
      .select(
        ...columns,
        ...ownerSelect,
        db.raw(`(
          SELECT json_agg(json_build_object(
            'display_name', ccm.display_name,
            'relationship', ccm.relationship,
            'role', ccm.role
          ) ORDER BY ccm.display_name)
          FROM care_circle_members ccm
          WHERE ccm.care_profile_id = cp.id AND ccm.invite_accepted = true
        ) AS circle_members`),
      )
      .where('cp.kind', kind)
      .where('cp.archived', false)
      .orderBy('cp.full_name', 'asc');

    if (roleAtLeast(account.role, 'super_admin')) {
      // See everything
    } else if (roleAtLeast(account.role, 'admin')) {
      query = query.where('cp.account_id', account.id);
    } else {
      query = query
        .join('care_circle_members as ccm2', 'ccm2.care_profile_id', 'cp.id')
        .where('ccm2.account_id', account.id)
        .where('ccm2.invite_accepted', true)
        .groupBy('cp.id');
    }

    const rows = await query;
    const ids = rows.map((r: { id: string }) => r.id);

    // Resolve linked-account contacts (contact_kind = 'user')
    const contactAccountIds = [
      ...new Set(
        rows
          .map((r: CareProfile) => r.contact_account_id)
          .filter((v: string | null): v is string => !!v),
      ),
    ];
    const contactAccounts = contactAccountIds.length
      ? await db('accounts').whereIn('id', contactAccountIds).select('id', 'display_name', 'email')
      : [];
    const contactAccountMap = new Map(contactAccounts.map((a: { id: string; display_name: string; email: string }) => [a.id, a]));

    // Resolve person contacts (contact_kind = 'profile'): the carer is another
    // person, whose own name, phone and email stand in.
    const contactProfileIds = [
      ...new Set(
        rows
          .map((r: CareProfile) => r.contact_profile_id)
          .filter((v: string | null): v is string => !!v),
      ),
    ];
    const contactProfiles = contactProfileIds.length
      ? await db('care_profiles').whereIn('id', contactProfileIds).select('id', 'full_name', 'contact_phone', 'contact_email')
      : [];
    const contactProfileMap = new Map(
      contactProfiles.map((p: { id: string; full_name: string; contact_phone: string | null; contact_email: string | null }) => [p.id, p]),
    );

    // GP phone fallback
    const gpPhoneMap = new Map<string, string>();
    if (ids.length > 0) {
      const gpRows = await db('care_profile_providers as cpp')
        .join('providers as p', 'cpp.provider_id', 'p.id')
        .whereIn('cpp.care_profile_id', ids)
        .where({ 'p.provider_type': 'gp' })
        .whereNotNull('p.phone')
        .select('cpp.care_profile_id', 'p.phone');
      for (const g of gpRows as Array<{ care_profile_id: string; phone: string }>) {
        if (!gpPhoneMap.has(g.care_profile_id)) gpPhoneMap.set(g.care_profile_id, g.phone);
      }
    }

    const profiles = rows.map((p: CareProfile) => {
      const linked = p.contact_account_id ? contactAccountMap.get(p.contact_account_id) : undefined;
      const carer = p.contact_profile_id ? contactProfileMap.get(p.contact_profile_id) : undefined;
      const contactName =
        p.contact_kind === 'self'
          ? p.full_name
          : p.contact_kind === 'user'
            ? linked?.display_name ?? null
            : p.contact_kind === 'profile'
              ? carer?.full_name ?? null
              : p.contact_name ?? null;
      const contactPhone = p.contact_phone || carer?.contact_phone || gpPhoneMap.get(p.id) || null;
      const contactEmail = p.contact_email || carer?.contact_email || linked?.email || null;

      const { contact_kind, contact_account_id, contact_profile_id, ...rest } = p;
      return {
        ...rest,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail,
      };
    });

    const canEdit = roleAtLeast(account.role, 'admin');
    res.json({ profiles, can_edit: canEdit });
  };
}

directoryRouter.get('/people', requireAuth, profilesEndpoint('person'));
directoryRouter.get('/pets', requireAuth, profilesEndpoint('pet'));

const providerSchema = z.object({
  provider_type: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  organisation: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  ...providerAddressFields,
  booking_link: z.string().url().optional().nullable(),
  directions_link: z.string().url().optional().nullable(),
});

/**
 * List providers for the directory.
 *   super_admin  => every provider in the system
 *   admin        => providers belonging to their account
 *   user/viewer  => providers linked to profiles they can access (read-only)
 */
directoryRouter.get('/providers', requireAuth, async (req, res) => {
  const account = req.account!;

  let query = db('providers as p')
    .select(
      'p.*',
      db.raw(`(
        SELECT json_agg(json_build_object(
          'profile_id', cpp.care_profile_id,
          'profile_name', cp.full_name
        ) ORDER BY cp.full_name)
        FROM care_profile_providers cpp
        JOIN care_profiles cp ON cp.id = cpp.care_profile_id
        WHERE cpp.provider_id = p.id
      ) AS linked_profiles`),
    )
    .orderBy('p.name', 'asc');

  if (roleAtLeast(account.role, 'super_admin')) {
    // See everything
  } else if (roleAtLeast(account.role, 'admin')) {
    query = query.where('p.account_id', account.id);
  } else {
    query = query
      .join('care_profile_providers as cpp', 'cpp.provider_id', 'p.id')
      .join('care_circle_members as ccm', 'ccm.care_profile_id', 'cpp.care_profile_id')
      .where('ccm.account_id', account.id)
      .where('ccm.invite_accepted', true)
      .groupBy('p.id');
  }

  const providers = await query;
  const canEdit = roleAtLeast(account.role, 'admin');
  res.json({ providers, can_edit: canEdit });
});

/**
 * Create a provider at the account level (admin+).
 */
directoryRouter.post('/providers', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }

  const parsed = providerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const [provider] = await db<Provider>('providers')
    .insert({ account_id: account.id, ...withComposedAddress(parsed.data) })
    .returning('*');

  res.status(201).json({ provider });
});

/**
 * Update a provider (admin+ for their account, super_admin for any).
 */
directoryRouter.patch('/providers/:id', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }

  const parsed = providerSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  let query = db<Provider>('providers').where({ id: req.params['id'] });
  if (!roleAtLeast(account.role, 'super_admin')) {
    query = query.where({ account_id: account.id });
  }

  const [provider] = await query.update(withComposedAddress(parsed.data)).returning('*');
  if (!provider) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ provider });
});

/**
 * Delete a provider entirely (admin+ for their account, super_admin for any).
 * This removes it from all linked profiles.
 */
directoryRouter.delete('/providers/:id', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }

  let query = db('providers').where({ id: req.params['id'] });
  if (!roleAtLeast(account.role, 'super_admin')) {
    query = query.where({ account_id: account.id });
  }

  const affected = await query.delete();
  if (!affected) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Provider deleted.' });
});

/**
 * Bulk link a provider to multiple care profiles at once.
 * Admin+ only. Profiles must be accessible to the account.
 */
directoryRouter.post('/providers/:id/bulk-link', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }

  const bodySchema = z.object({ profile_ids: z.array(z.string().uuid()).min(1).max(100) });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const provider = await db<Provider>('providers').where({ id: req.params['id'] }).first();
  if (!provider) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }
  if (!roleAtLeast(account.role, 'super_admin') && provider.account_id !== account.id) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }

  const { profile_ids } = parsed.data;

  // Verify profile access: admin can link to any profile they manage,
  // super_admin to any profile in the system.
  let accessibleIds: string[];
  if (roleAtLeast(account.role, 'super_admin')) {
    const rows = await db('care_profiles').whereIn('id', profile_ids).select('id');
    accessibleIds = rows.map((r) => r.id);
  } else {
    const rows = await db('care_profiles')
      .whereIn('id', profile_ids)
      .where({ account_id: account.id })
      .select('id');
    accessibleIds = rows.map((r) => r.id);
  }

  // Skip already-linked profiles
  const existing = await db('care_profile_providers')
    .where({ provider_id: provider.id })
    .whereIn('care_profile_id', accessibleIds)
    .select('care_profile_id');
  const existingSet = new Set(existing.map((r) => r.care_profile_id));
  const toInsert = accessibleIds.filter((id) => !existingSet.has(id));

  if (toInsert.length > 0) {
    await db('care_profile_providers').insert(
      toInsert.map((pid) => ({ care_profile_id: pid, provider_id: provider.id }))
    );
  }

  res.json({ linked: toInsert.length, already_linked: existingSet.size, skipped: profile_ids.length - accessibleIds.length });
});

/**
 * Bulk unlink a provider from multiple care profiles.
 */
directoryRouter.post('/providers/:id/bulk-unlink', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }

  const bodySchema = z.object({ profile_ids: z.array(z.string().uuid()).min(1).max(100) });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const removed = await db('care_profile_providers')
    .where({ provider_id: req.params['id'] })
    .whereIn('care_profile_id', parsed.data.profile_ids)
    .delete();

  res.json({ unlinked: removed });
});

// ---------------------------------------------------------------------------
// Supplier directory: the account's pharmacies and shops, reused across every
// medication. Suppliers link to profiles indirectly, through the medications
// that name them, so "used by" is derived from those medications.

const supplierSchema = z.object({
  name: z.string().min(1).max(255),
  suburb: z.string().max(120).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  order_url: z.string().url().max(2000).optional().nullable().or(z.literal('')),
});

const cleanField = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};
const normaliseSupplierUrl = (v: string | null | undefined): string | null => {
  const u = (v ?? '').trim();
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
};

/**
 * List suppliers for the directory, with the profiles each is used by (via
 * their medications) and how many medications reference it.
 *   super_admin  => every supplier
 *   admin        => their account's suppliers
 *   user/viewer  => suppliers used by profiles they can access (read-only)
 */
directoryRouter.get('/suppliers', requireAuth, async (req, res) => {
  const account = req.account!;

  let query = db('suppliers as s')
    .select(
      's.*',
      db.raw(`(
        SELECT count(*) FROM medications m WHERE m.supplier_id = s.id
      )::int AS medication_count`),
      db.raw(`(
        SELECT json_agg(x) FROM (
          SELECT DISTINCT cp.id AS profile_id, cp.full_name AS profile_name
          FROM medications m
          JOIN care_profiles cp ON cp.id = m.care_profile_id
          WHERE m.supplier_id = s.id
          ORDER BY cp.full_name
        ) x
      ) AS linked_profiles`),
    )
    .orderBy([{ column: 's.name', order: 'asc' }, { column: 's.suburb', order: 'asc' }]);

  if (roleAtLeast(account.role, 'super_admin')) {
    // See everything
  } else if (roleAtLeast(account.role, 'admin')) {
    query = query.where('s.account_id', account.id);
  } else {
    query = query
      .join('medications as m2', 'm2.supplier_id', 's.id')
      .join('care_circle_members as ccm', 'ccm.care_profile_id', 'm2.care_profile_id')
      .where('ccm.account_id', account.id)
      .where('ccm.invite_accepted', true)
      .groupBy('s.id');
  }

  const suppliers = await query;
  const canEdit = roleAtLeast(account.role, 'admin');
  res.json({ suppliers, can_edit: canEdit });
});

/** Create a supplier at the account level (admin+). */
directoryRouter.post('/suppliers', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  const parsed = supplierSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const [supplier] = await db('suppliers')
    .insert({
      account_id: account.id,
      name: parsed.data.name.trim(),
      suburb: cleanField(parsed.data.suburb),
      phone: cleanField(parsed.data.phone),
      order_url: normaliseSupplierUrl(parsed.data.order_url),
    })
    .returning('*');
  res.status(201).json({ supplier });
});

/** Update a supplier (admin+ for their account, super_admin for any). */
directoryRouter.patch('/suppliers/:id', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  const parsed = supplierSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const update: Record<string, unknown> = {};
  if ('name' in parsed.data) update['name'] = (parsed.data.name ?? '').trim();
  if ('suburb' in parsed.data) update['suburb'] = cleanField(parsed.data.suburb);
  if ('phone' in parsed.data) update['phone'] = cleanField(parsed.data.phone);
  if ('order_url' in parsed.data) update['order_url'] = normaliseSupplierUrl(parsed.data.order_url);

  let query = db('suppliers').where({ id: req.params['id'] });
  if (!roleAtLeast(account.role, 'super_admin')) query = query.where({ account_id: account.id });
  const [supplier] = await query.update(update).returning('*');
  if (!supplier) {
    res.status(404).json({ error: 'Supplier not found', code: 'NOT_FOUND' });
    return;
  }
  // The medication's denormalised supplier name and reorder link mirror the
  // supplier, so keep every medication that names it in step.
  await db('medications')
    .where({ supplier_id: supplier.id })
    .update({ supplier: supplier.name, supplier_order_url: supplier.order_url ?? null });
  res.json({ supplier });
});

/**
 * Delete a supplier (admin+ for their account, super_admin for any). Any
 * medication that named it keeps its typed-in name but loses the link, as the
 * supplier_id is set null by the foreign key.
 */
directoryRouter.delete('/suppliers/:id', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  let query = db('suppliers').where({ id: req.params['id'] });
  if (!roleAtLeast(account.role, 'super_admin')) query = query.where({ account_id: account.id });
  const affected = await query.delete();
  if (!affected) {
    res.status(404).json({ error: 'Supplier not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Supplier deleted.' });
});

// ---------------------------------------------------------------------------
// Address directory: the reusable address book, the same shape as providers.

const addressSchema = z.object({
  label: z.string().max(255).optional().nullable(),
  address_line1: z.string().max(255).optional().nullable(),
  address_line2: z.string().max(255).optional().nullable(),
  address_suburb: z.string().max(120).optional().nullable(),
  address_state: z.string().max(120).optional().nullable(),
  address_postcode: z.string().max(20).optional().nullable(),
  address_country: z.string().max(120).optional().nullable(),
});

/**
 * List addresses for the directory, with the profiles each is linked to.
 *   super_admin  => every address
 *   admin        => their account's addresses
 *   user/viewer  => addresses linked to profiles they can access (read-only)
 */
directoryRouter.get('/addresses', requireAuth, async (req, res) => {
  const account = req.account!;

  let query = db('addresses as a')
    .select(
      'a.*',
      db.raw(`(
        SELECT json_agg(json_build_object(
          'profile_id', cpa.care_profile_id,
          'profile_name', cp.full_name,
          'address_kind', cpa.address_kind
        ) ORDER BY cp.full_name)
        FROM care_profile_addresses cpa
        JOIN care_profiles cp ON cp.id = cpa.care_profile_id
        WHERE cpa.address_id = a.id
      ) AS linked_profiles`)
    )
    .orderBy('a.formatted', 'asc');

  if (roleAtLeast(account.role, 'super_admin')) {
    // See everything
  } else if (roleAtLeast(account.role, 'admin')) {
    query = query.where('a.account_id', account.id);
  } else {
    query = query
      .join('care_profile_addresses as cpa', 'cpa.address_id', 'a.id')
      .join('care_circle_members as ccm', 'ccm.care_profile_id', 'cpa.care_profile_id')
      .where('ccm.account_id', account.id)
      .where('ccm.invite_accepted', true)
      .groupBy('a.id');
  }

  const addresses = await query;
  const canEdit = roleAtLeast(account.role, 'admin');
  res.json({ addresses, can_edit: canEdit });
});

directoryRouter.post('/addresses', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  const parsed = addressSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  if (!ADDRESS_PART_KEYS.some((k) => (parsed.data as Record<string, unknown>)[k])) {
    res.status(400).json({ error: 'Provide an address', code: 'VALIDATION_ERROR' });
    return;
  }
  const [address] = await db('addresses')
    .insert({ account_id: account.id, ...addressColumns(parsed.data, parsed.data.label) })
    .returning('*');
  res.status(201).json({ address });
});

directoryRouter.patch('/addresses/:id', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  const parsed = addressSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  let query = db('addresses').where({ id: req.params['id'] });
  if (!roleAtLeast(account.role, 'super_admin')) query = query.where({ account_id: account.id });
  const current = await query.clone().first();
  if (!current) {
    res.status(404).json({ error: 'Address not found', code: 'NOT_FOUND' });
    return;
  }
  const merged = { ...current, ...parsed.data };
  const [address] = await query.update({ ...addressColumns(merged, merged.label), updated_at: db.fn.now() }).returning('*');
  // Editing the shared address updates it everywhere, including each person's
  // "where they live" for whom it is their residence.
  await syncResidenceForAddress(address.id, address);
  res.json({ address });
});

directoryRouter.delete('/addresses/:id', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  let query = db('addresses').where({ id: req.params['id'] });
  if (!roleAtLeast(account.role, 'super_admin')) query = query.where({ account_id: account.id });
  const affected = await query.delete();
  if (!affected) {
    res.status(404).json({ error: 'Address not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Address deleted.' });
});

/** Bulk link an address to multiple care profiles, like providers. */
directoryRouter.post('/addresses/:id/bulk-link', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  const parsed = z.object({ profile_ids: z.array(z.string().uuid()).min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const address = await db('addresses').where({ id: req.params['id'] }).first();
  if (!address) {
    res.status(404).json({ error: 'Address not found', code: 'NOT_FOUND' });
    return;
  }
  if (!roleAtLeast(account.role, 'super_admin') && address.account_id !== account.id) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }

  const { profile_ids } = parsed.data;
  const accessRows = roleAtLeast(account.role, 'super_admin')
    ? await db('care_profiles').whereIn('id', profile_ids).select('id')
    : await db('care_profiles').whereIn('id', profile_ids).where({ account_id: account.id }).select('id');
  const accessibleIds = accessRows.map((r) => r.id);

  const existing = await db('care_profile_addresses')
    .where({ address_id: address.id })
    .whereIn('care_profile_id', accessibleIds)
    .select('care_profile_id');
  const existingSet = new Set(existing.map((r) => r.care_profile_id));
  const toInsert = accessibleIds.filter((id) => !existingSet.has(id));
  if (toInsert.length > 0) {
    // Linking an address to a person records where they live, so link it as
    // their residence and copy it into each profile's "where they live".
    await db('care_profile_addresses').insert(
      toInsert.map((pid) => ({ care_profile_id: pid, address_id: address.id, address_kind: RESIDENCE_KIND }))
    );
    for (const pid of toInsert) await syncProfileResidence(pid, address);
  }
  res.json({ linked: toInsert.length, already_linked: existingSet.size, skipped: profile_ids.length - accessibleIds.length });
});

directoryRouter.post('/addresses/:id/bulk-unlink', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  const parsed = z.object({ profile_ids: z.array(z.string().uuid()).min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const removed = await db('care_profile_addresses')
    .where({ address_id: req.params['id'] })
    .whereIn('care_profile_id', parsed.data.profile_ids)
    .delete();
  res.json({ unlinked: removed });
});
