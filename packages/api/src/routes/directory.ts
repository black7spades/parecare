import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { roleAtLeast } from '../middleware/requireRole';
import { providerAddressFields, withComposedAddress } from './providers';
import { addressColumns, ADDRESS_PART_KEYS, RESIDENCE_KIND, syncProfileResidence, syncResidenceForAddress } from '../services/addresses';
import { exportRecords, importRecords, type PortDescriptor, type PortFormat } from '../services/dataPort';
import type { AccountRole, CareProfile, Provider, ProfileKind } from '../types';

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
// medication and mirroring providers field for field — the same segmented
// address, the same link-to-profiles join, the same edit, delete and bulk
// tools. The medication count each supplier serves is shown alongside.

const supplierSchema = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  ...providerAddressFields,
  // A bare domain is accepted and defaulted to https on write, so a pasted
  // link works; hence a plain string rather than a strict url() here.
  order_url: z.string().max(2000).optional().nullable(),
  directions_link: z.string().max(2000).optional().nullable(),
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
 * List suppliers for the directory, with the profiles each is linked to (the
 * same join providers use) and how many medications reference it.
 *   super_admin  => every supplier
 *   admin        => their account's suppliers
 *   user/viewer  => suppliers linked to profiles they can access (read-only)
 */
directoryRouter.get('/suppliers', requireAuth, async (req, res) => {
  const account = req.account!;

  // "Used by" is every person or pet connected to the supplier: those whose
  // medication names it (implicit, no manual step) unioned with any linked by
  // hand (the proactive "this is their pharmacy" case). One coherent answer,
  // deduplicated, rather than two rival notions of a link.
  let query = db('suppliers as s')
    .select(
      's.*',
      db.raw(`(
        SELECT count(*) FROM medications m WHERE m.supplier_id = s.id
      )::int AS medication_count`),
      db.raw(`(
        SELECT json_agg(json_build_object(
          'profile_id', p.id,
          'profile_name', p.full_name
        ) ORDER BY p.full_name)
        FROM (
          SELECT cp.id, cp.full_name
          FROM care_profiles cp
          WHERE cp.id IN (SELECT care_profile_id FROM care_profile_suppliers WHERE supplier_id = s.id)
             OR cp.id IN (SELECT care_profile_id FROM medications WHERE supplier_id = s.id)
        ) p
      ) AS linked_profiles`),
    )
    .orderBy([{ column: 's.name', order: 'asc' }, { column: 's.address_suburb', order: 'asc' }]);

  if (roleAtLeast(account.role, 'super_admin')) {
    // See everything
  } else if (roleAtLeast(account.role, 'admin')) {
    query = query.where('s.account_id', account.id);
  } else {
    // A non-admin sees a supplier connected to any profile they can access,
    // whether by a manual link or by a medication that names it.
    query = query.whereExists(function () {
      this.select(db.raw('1'))
        .from('care_circle_members as ccm')
        .where('ccm.account_id', account.id)
        .where('ccm.invite_accepted', true)
        .where(function () {
          this.whereExists(function () {
            this.select(db.raw('1'))
              .from('care_profile_suppliers as cps')
              .whereRaw('cps.supplier_id = s.id')
              .whereRaw('cps.care_profile_id = ccm.care_profile_id');
          }).orWhereExists(function () {
            this.select(db.raw('1'))
              .from('medications as m2')
              .whereRaw('m2.supplier_id = s.id')
              .whereRaw('m2.care_profile_id = ccm.care_profile_id');
          });
        });
    });
  }

  const suppliers = await query;
  // Suppliers are account-scoped and already creatable by any signed-in carer
  // from the medication editor, so the directory lets them be managed here too
  // rather than gating it behind a platform admin like providers.
  res.json({ suppliers, can_edit: true });
});

/** Create a supplier at the account level. */
directoryRouter.post('/suppliers', requireAuth, async (req, res) => {
  const account = req.account!;
  const parsed = supplierSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const [supplier] = await db('suppliers')
    .insert({
      account_id: account.id,
      ...withComposedAddress(parsed.data),
      name: parsed.data.name.trim(),
      phone: cleanField(parsed.data.phone),
      email: cleanField(parsed.data.email),
      order_url: normaliseSupplierUrl(parsed.data.order_url),
      directions_link: normaliseSupplierUrl(parsed.data.directions_link),
    })
    .returning('*');
  res.status(201).json({ supplier });
});

/** Update a supplier (its own account; super_admin for any). */
directoryRouter.patch('/suppliers/:id', requireAuth, async (req, res) => {
  const account = req.account!;
  const parsed = supplierSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const update: Record<string, unknown> = withComposedAddress(parsed.data);
  if ('name' in parsed.data) update['name'] = (parsed.data.name ?? '').trim();
  if ('phone' in parsed.data) update['phone'] = cleanField(parsed.data.phone);
  if ('email' in parsed.data) update['email'] = cleanField(parsed.data.email);
  if ('order_url' in parsed.data) update['order_url'] = normaliseSupplierUrl(parsed.data.order_url);
  if ('directions_link' in parsed.data) update['directions_link'] = normaliseSupplierUrl(parsed.data.directions_link);

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
 * supplier_id is set null by the foreign key; profile links cascade away.
 */
directoryRouter.delete('/suppliers/:id', requireAuth, async (req, res) => {
  const account = req.account!;
  let query = db('suppliers').where({ id: req.params['id'] });
  if (!roleAtLeast(account.role, 'super_admin')) query = query.where({ account_id: account.id });
  const affected = await query.delete();
  if (!affected) {
    res.status(404).json({ error: 'Supplier not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Supplier deleted.' });
});

/** Bulk link a supplier to multiple care profiles at once. */
directoryRouter.post('/suppliers/:id/bulk-link', requireAuth, async (req, res) => {
  const account = req.account!;
  const parsed = z.object({ profile_ids: z.array(z.string().uuid()).min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const supplier = await db('suppliers').where({ id: req.params['id'] }).first();
  if (!supplier) {
    res.status(404).json({ error: 'Supplier not found', code: 'NOT_FOUND' });
    return;
  }
  if (!roleAtLeast(account.role, 'super_admin') && supplier.account_id !== account.id) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }

  const { profile_ids } = parsed.data;
  const accessRows = roleAtLeast(account.role, 'super_admin')
    ? await db('care_profiles').whereIn('id', profile_ids).select('id')
    : await db('care_profiles').whereIn('id', profile_ids).where({ account_id: account.id }).select('id');
  const accessibleIds = accessRows.map((r) => r.id);

  const existing = await db('care_profile_suppliers')
    .where({ supplier_id: supplier.id })
    .whereIn('care_profile_id', accessibleIds)
    .select('care_profile_id');
  const existingSet = new Set(existing.map((r) => r.care_profile_id));
  const toInsert = accessibleIds.filter((id) => !existingSet.has(id));
  if (toInsert.length > 0) {
    await db('care_profile_suppliers').insert(
      toInsert.map((pid) => ({ care_profile_id: pid, supplier_id: supplier.id }))
    );
  }
  res.json({ linked: toInsert.length, already_linked: existingSet.size, skipped: profile_ids.length - accessibleIds.length });
});

/** Bulk unlink a supplier from multiple care profiles. */
directoryRouter.post('/suppliers/:id/bulk-unlink', requireAuth, async (req, res) => {
  const account = req.account!;
  const parsed = z.object({ profile_ids: z.array(z.string().uuid()).min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const removed = await db('care_profile_suppliers')
    .where({ supplier_id: req.params['id'] })
    .whereIn('care_profile_id', parsed.data.profile_ids)
    .delete();
  res.json({ unlinked: removed });
});

// ---------------------------------------------------------------------------
// Asset directory: the account's equipment register (a wheelchair, a hoist, a
// bed), account-scoped and mirroring suppliers — the same link-to-profiles
// join, the same edit, delete, bulk and import/export tools. Every fact (the
// unit name, its number, price, purchase date, warranty, condition) is its own
// column.

const assetSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().max(100).optional().nullable(),
  serial_number: z.string().max(120).optional().nullable(),
  make_model: z.string().max(255).optional().nullable(),
  price: z.coerce.number().min(0).max(1e9).optional().nullable(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  supplier: z.string().max(255).optional().nullable(),
  warranty_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  condition: z.string().max(30).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

// Postgres returns a decimal as a string and a date as a Date; hand the client
// a real number and a plain YYYY-MM-DD so the list and form get what they expect.
const assetDate = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const serializeAsset = <T extends Record<string, unknown>>(a: T): T => ({
  ...a,
  price: a['price'] == null || a['price'] === '' ? null : Number(a['price']),
  purchase_date: assetDate(a['purchase_date']),
  warranty_expiry: assetDate(a['warranty_expiry']),
});

// Turn a validated body into the columns to write, cleaning blank strings to null.
function assetColumns(data: z.infer<typeof assetSchema> | Partial<z.infer<typeof assetSchema>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('name' in data) out['name'] = (data.name ?? '').trim();
  if ('category' in data) out['category'] = cleanField(data.category);
  if ('serial_number' in data) out['serial_number'] = cleanField(data.serial_number);
  if ('make_model' in data) out['make_model'] = cleanField(data.make_model);
  if ('price' in data) out['price'] = data.price ?? null;
  if ('purchase_date' in data) out['purchase_date'] = data.purchase_date ?? null;
  if ('supplier' in data) out['supplier'] = cleanField(data.supplier);
  if ('warranty_expiry' in data) out['warranty_expiry'] = data.warranty_expiry ?? null;
  if ('condition' in data) out['condition'] = cleanField(data.condition);
  if ('location' in data) out['location'] = cleanField(data.location);
  if ('notes' in data) out['notes'] = cleanField(data.notes);
  return out;
}

/**
 * List assets for the directory, with the profiles each is linked to.
 *   super_admin  => every asset
 *   admin        => their account's assets
 *   user/viewer  => assets linked to profiles they can access (read-only)
 */
directoryRouter.get('/assets', requireAuth, async (req, res) => {
  const account = req.account!;
  let query = db('assets as a')
    .select(
      'a.*',
      db.raw(`(
        SELECT json_agg(json_build_object(
          'profile_id', cp.id,
          'profile_name', cp.full_name
        ) ORDER BY cp.full_name)
        FROM care_profile_assets cpa
        JOIN care_profiles cp ON cp.id = cpa.care_profile_id
        WHERE cpa.asset_id = a.id
      ) AS linked_profiles`),
    )
    .orderBy('a.name', 'asc');

  if (roleAtLeast(account.role, 'super_admin')) {
    // See everything
  } else if (roleAtLeast(account.role, 'admin')) {
    query = query.where('a.account_id', account.id);
  } else {
    query = query.whereExists(function () {
      this.select(db.raw('1'))
        .from('care_profile_assets as cpa')
        .join('care_circle_members as ccm', 'ccm.care_profile_id', 'cpa.care_profile_id')
        .whereRaw('cpa.asset_id = a.id')
        .where('ccm.account_id', account.id)
        .where('ccm.invite_accepted', true);
    });
  }

  const assets = await query;
  // Assets are account-scoped and managed here by any signed-in carer, the same
  // as suppliers, rather than gated behind a platform admin.
  res.json({ assets: assets.map(serializeAsset), can_edit: true });
});

/** Create an asset at the account level. */
directoryRouter.post('/assets', requireAuth, async (req, res) => {
  const account = req.account!;
  const parsed = assetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const [asset] = await db('assets')
    .insert({ account_id: account.id, ...assetColumns(parsed.data) })
    .returning('*');
  res.status(201).json({ asset: serializeAsset(asset) });
});

/** Update an asset (its own account; super_admin for any). */
directoryRouter.patch('/assets/:id', requireAuth, async (req, res) => {
  const account = req.account!;
  const parsed = assetSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  let query = db('assets').where({ id: req.params['id'] });
  if (!roleAtLeast(account.role, 'super_admin')) query = query.where({ account_id: account.id });
  const [asset] = await query.update(assetColumns(parsed.data)).returning('*');
  if (!asset) {
    res.status(404).json({ error: 'Asset not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ asset: serializeAsset(asset) });
});

/** Delete an asset. Its profile links cascade away. */
directoryRouter.delete('/assets/:id', requireAuth, async (req, res) => {
  const account = req.account!;
  let query = db('assets').where({ id: req.params['id'] });
  if (!roleAtLeast(account.role, 'super_admin')) query = query.where({ account_id: account.id });
  const affected = await query.delete();
  if (!affected) {
    res.status(404).json({ error: 'Asset not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Asset deleted.' });
});

/** Bulk link an asset to multiple care profiles at once. */
directoryRouter.post('/assets/:id/bulk-link', requireAuth, async (req, res) => {
  const account = req.account!;
  const parsed = z.object({ profile_ids: z.array(z.string().uuid()).min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const asset = await db('assets').where({ id: req.params['id'] }).first();
  if (!asset) {
    res.status(404).json({ error: 'Asset not found', code: 'NOT_FOUND' });
    return;
  }
  if (!roleAtLeast(account.role, 'super_admin') && asset.account_id !== account.id) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  const { profile_ids } = parsed.data;
  const accessRows = roleAtLeast(account.role, 'super_admin')
    ? await db('care_profiles').whereIn('id', profile_ids).select('id')
    : await db('care_profiles').whereIn('id', profile_ids).where({ account_id: account.id }).select('id');
  const accessibleIds = accessRows.map((r) => r.id);

  const existing = await db('care_profile_assets')
    .where({ asset_id: asset.id })
    .whereIn('care_profile_id', accessibleIds)
    .select('care_profile_id');
  const existingSet = new Set(existing.map((r) => r.care_profile_id));
  const toInsert = accessibleIds.filter((id) => !existingSet.has(id));
  if (toInsert.length > 0) {
    await db('care_profile_assets').insert(
      toInsert.map((pid) => ({ care_profile_id: pid, asset_id: asset.id }))
    );
  }
  res.json({ linked: toInsert.length, already_linked: existingSet.size, skipped: profile_ids.length - accessibleIds.length });
});

/** Bulk unlink an asset from multiple care profiles. */
directoryRouter.post('/assets/:id/bulk-unlink', requireAuth, async (req, res) => {
  const account = req.account!;
  const parsed = z.object({ profile_ids: z.array(z.string().uuid()).min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const removed = await db('care_profile_assets')
    .where({ asset_id: req.params['id'] })
    .whereIn('care_profile_id', parsed.data.profile_ids)
    .delete();
  res.json({ unlinked: removed });
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

// ---------------------------------------------------------------------------
// Bulk import and export for every directory resource. Each resource plugs a
// small descriptor into the shared dataPort toolkit (CSV and JSON, flexible
// header matching, a blank template), the same way medications do, so every
// directory sub-item can be exported and re-imported. Writes follow each
// resource's normal permission: suppliers by any signed-in carer for their
// account, the rest by an admin.

const portBlank = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};
const portUrl = (v: string | null | undefined): string | null => {
  const u = (v ?? '').trim();
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
};
const portEmail = (v: string | null | undefined): string | null => {
  const e = (v ?? '').trim();
  return e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
};
const portDate = (v: string | null | undefined): string | null => {
  const d = (v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
};
const portBool = (v: string | null | undefined): boolean =>
  ['true', 'yes', '1', 'y'].includes((v ?? '').trim().toLowerCase());
const portFullName = (full: string): { first_name: string | null; middle_name: string | null; last_name: string | null } => {
  const w = full.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: w[0] ?? null,
    middle_name: w.length > 2 ? w.slice(1, -1).join(' ') : null,
    last_name: w.length > 1 ? w[w.length - 1] : null,
  };
};
const portReadFormat = (v: unknown): PortFormat => (String(v).toLowerCase() === 'json' ? 'json' : 'csv');

const PORT_PHASES = new Set([
  'early_concern', 'home_with_support', 'increased_dependency',
  'transition_to_residential', 'residential_ongoing', 'end_of_life',
]);

// Any directory record carries the columns its list query selects.
type AnyRow = Record<string, unknown>;
const cell = (v: unknown): string => (v == null ? '' : String(v));
// A date column comes back as a Date (or a string); export it as plain
// YYYY-MM-DD, never a locale string like "Tue Mar 11".
const cellDate = (v: unknown): string => {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
};

// A parsed import record is the set of columns to insert (minus account_id).
type PortRecord = Record<string, unknown>;

const providerPort: PortDescriptor<AnyRow, PortRecord> = {
  resource: 'providers',
  columns: [
    { key: 'name', header: 'Name', aliases: ['provider', 'full name'], toCell: (r) => cell(r['name']) },
    { key: 'provider_type', header: 'Type', aliases: ['provider type', 'role'], toCell: (r) => cell(r['provider_type']) },
    { key: 'organisation', header: 'Organisation', aliases: ['org', 'clinic', 'practice'], toCell: (r) => cell(r['organisation']) },
    { key: 'phone', header: 'Phone', toCell: (r) => cell(r['phone']) },
    { key: 'email', header: 'Email', toCell: (r) => cell(r['email']) },
    { key: 'address_line1', header: 'Address line 1', aliases: ['address', 'street'], toCell: (r) => cell(r['address_line1']) },
    { key: 'address_line2', header: 'Address line 2', toCell: (r) => cell(r['address_line2']) },
    { key: 'address_suburb', header: 'Suburb', aliases: ['city', 'town'], toCell: (r) => cell(r['address_suburb']) },
    { key: 'address_state', header: 'State', toCell: (r) => cell(r['address_state']) },
    { key: 'address_postcode', header: 'Postcode', aliases: ['zip', 'postal code'], toCell: (r) => cell(r['address_postcode']) },
    { key: 'address_country', header: 'Country', toCell: (r) => cell(r['address_country']) },
    { key: 'booking_link', header: 'Booking link', aliases: ['booking'], toCell: (r) => cell(r['booking_link']) },
    { key: 'directions_link', header: 'Directions', aliases: ['directions link', 'map'], toCell: (r) => cell(r['directions_link']) },
  ],
  coerce: (raw, n) => {
    const name = (raw['name'] ?? '').trim();
    if (!name) return { ok: false as const, error: `Row ${n}: a provider name is required.` };
    return {
      ok: true as const,
      value: withComposedAddress({
        provider_type: portBlank(raw['provider_type']) ?? 'other',
        name,
        organisation: portBlank(raw['organisation']),
        phone: portBlank(raw['phone']),
        email: portEmail(raw['email']),
        address_line1: portBlank(raw['address_line1']),
        address_line2: portBlank(raw['address_line2']),
        address_suburb: portBlank(raw['address_suburb']),
        address_state: portBlank(raw['address_state']),
        address_postcode: portBlank(raw['address_postcode']),
        address_country: portBlank(raw['address_country']),
        booking_link: portUrl(raw['booking_link']),
        directions_link: portUrl(raw['directions_link']),
      }),
    };
  },
};

const supplierPort: PortDescriptor<AnyRow, PortRecord> = {
  resource: 'suppliers',
  columns: [
    { key: 'name', header: 'Vendor', aliases: ['name', 'supplier', 'pharmacy'], toCell: (r) => cell(r['name']) },
    { key: 'phone', header: 'Phone', toCell: (r) => cell(r['phone']) },
    { key: 'email', header: 'Email', toCell: (r) => cell(r['email']) },
    { key: 'address_line1', header: 'Address line 1', aliases: ['address', 'street'], toCell: (r) => cell(r['address_line1']) },
    { key: 'address_line2', header: 'Address line 2', toCell: (r) => cell(r['address_line2']) },
    { key: 'address_suburb', header: 'Suburb', aliases: ['city', 'town'], toCell: (r) => cell(r['address_suburb']) },
    { key: 'address_state', header: 'State', toCell: (r) => cell(r['address_state']) },
    { key: 'address_postcode', header: 'Postcode', aliases: ['zip', 'postal code'], toCell: (r) => cell(r['address_postcode']) },
    { key: 'address_country', header: 'Country', toCell: (r) => cell(r['address_country']) },
    { key: 'order_url', header: 'Reorder link', aliases: ['order url', 'order link', 'reorder'], toCell: (r) => cell(r['order_url']) },
    { key: 'directions_link', header: 'Directions', aliases: ['directions link', 'map'], toCell: (r) => cell(r['directions_link']) },
  ],
  coerce: (raw, n) => {
    const name = (raw['name'] ?? '').trim();
    if (!name) return { ok: false as const, error: `Row ${n}: a vendor name is required.` };
    return {
      ok: true as const,
      value: withComposedAddress({
        name,
        phone: portBlank(raw['phone']),
        email: portEmail(raw['email']),
        address_line1: portBlank(raw['address_line1']),
        address_line2: portBlank(raw['address_line2']),
        address_suburb: portBlank(raw['address_suburb']),
        address_state: portBlank(raw['address_state']),
        address_postcode: portBlank(raw['address_postcode']),
        address_country: portBlank(raw['address_country']),
        order_url: portUrl(raw['order_url']),
        directions_link: portUrl(raw['directions_link']),
      }),
    };
  },
};

const assetPort: PortDescriptor<AnyRow, PortRecord> = {
  resource: 'assets',
  columns: [
    { key: 'name', header: 'Unit name', aliases: ['name', 'equipment', 'item'], toCell: (r) => cell(r['name']) },
    { key: 'category', header: 'Category', aliases: ['type', 'kind'], toCell: (r) => cell(r['category']) },
    { key: 'serial_number', header: 'Serial or unit number', aliases: ['serial', 'serial number', 'unit number', 'number', 'asset number'], toCell: (r) => cell(r['serial_number']) },
    { key: 'make_model', header: 'Make or model', aliases: ['make', 'model'], toCell: (r) => cell(r['make_model']) },
    { key: 'price', header: 'Price', aliases: ['cost', 'purchase price'], toCell: (r) => cell(r['price']) },
    { key: 'purchase_date', header: 'Purchase date', aliases: ['bought', 'date bought', 'purchased'], toCell: (r) => cellDate(r['purchase_date']) },
    { key: 'supplier', header: 'Bought from', aliases: ['supplier', 'vendor', 'shop'], toCell: (r) => cell(r['supplier']) },
    { key: 'warranty_expiry', header: 'Warranty expiry', aliases: ['warranty', 'warranty ends'], toCell: (r) => cellDate(r['warranty_expiry']) },
    { key: 'condition', header: 'Condition', aliases: ['state'], toCell: (r) => cell(r['condition']) },
    { key: 'location', header: 'Location', aliases: ['kept', 'where'], toCell: (r) => cell(r['location']) },
    { key: 'notes', header: 'Notes', toCell: (r) => cell(r['notes']) },
  ],
  coerce: (raw, n) => {
    const name = (raw['name'] ?? '').trim();
    if (!name) return { ok: false as const, error: `Row ${n}: a unit name is required.` };
    const priceNum = parseFloat(String(raw['price'] ?? '').replace(/[^0-9.]/g, ''));
    return {
      ok: true as const,
      value: {
        name,
        category: portBlank(raw['category']),
        serial_number: portBlank(raw['serial_number']),
        make_model: portBlank(raw['make_model']),
        price: Number.isFinite(priceNum) ? priceNum : null,
        purchase_date: portDate(raw['purchase_date']),
        supplier: portBlank(raw['supplier']),
        warranty_expiry: portDate(raw['warranty_expiry']),
        condition: portBlank(raw['condition']),
        location: portBlank(raw['location']),
        notes: portBlank(raw['notes']),
      },
    };
  },
};

const addressPort: PortDescriptor<AnyRow, PortRecord> = {
  resource: 'addresses',
  columns: [
    { key: 'label', header: 'Label', aliases: ['name'], toCell: (r) => cell(r['label']) },
    { key: 'address_line1', header: 'Address line 1', aliases: ['address', 'street'], toCell: (r) => cell(r['address_line1']) },
    { key: 'address_line2', header: 'Address line 2', toCell: (r) => cell(r['address_line2']) },
    { key: 'address_suburb', header: 'Suburb', aliases: ['city', 'town'], toCell: (r) => cell(r['address_suburb']) },
    { key: 'address_state', header: 'State', toCell: (r) => cell(r['address_state']) },
    { key: 'address_postcode', header: 'Postcode', aliases: ['zip', 'postal code'], toCell: (r) => cell(r['address_postcode']) },
    { key: 'address_country', header: 'Country', toCell: (r) => cell(r['address_country']) },
  ],
  coerce: (raw, n) => {
    const parts = {
      address_line1: portBlank(raw['address_line1']),
      address_line2: portBlank(raw['address_line2']),
      address_suburb: portBlank(raw['address_suburb']),
      address_state: portBlank(raw['address_state']),
      address_postcode: portBlank(raw['address_postcode']),
      address_country: portBlank(raw['address_country']),
    };
    if (!ADDRESS_PART_KEYS.some((k) => (parts as Record<string, unknown>)[k])) {
      return { ok: false as const, error: `Row ${n}: an address is required.` };
    }
    return { ok: true as const, value: { ...addressColumns(parts, portBlank(raw['label'])) } };
  },
};

const personPort: PortDescriptor<AnyRow, PortRecord> = {
  resource: 'people',
  columns: [
    { key: 'full_name', header: 'Name', aliases: ['full name', 'person'], toCell: (r) => cell(r['full_name']) },
    { key: 'preferred_name', header: 'Preferred name', aliases: ['known as'], toCell: (r) => cell(r['preferred_name']) },
    { key: 'date_of_birth', header: 'Date of birth', aliases: ['dob', 'birthdate'], toCell: (r) => cell(r['date_of_birth']).slice(0, 10) },
    { key: 'pronouns', header: 'Pronouns', toCell: (r) => cell(r['pronouns']) },
    { key: 'primary_language', header: 'Language', aliases: ['primary language'], toCell: (r) => cell(r['primary_language']) },
    { key: 'current_phase', header: 'Phase', toCell: (r) => cell(r['current_phase']) },
    { key: 'owner_relationship', header: 'Relationship', aliases: ['relationship'], toCell: (r) => cell(r['owner_relationship']) },
    { key: 'contact_name', header: 'Contact name', toCell: (r) => cell(r['contact_name']) },
    { key: 'contact_phone', header: 'Contact phone', toCell: (r) => cell(r['contact_phone']) },
    { key: 'contact_email', header: 'Contact email', toCell: (r) => cell(r['contact_email']) },
  ],
  coerce: (raw, n) => {
    const full = (raw['full_name'] ?? '').trim();
    if (!full) return { ok: false as const, error: `Row ${n}: a name is required.` };
    const contactName = portBlank(raw['contact_name']);
    const phase = (raw['current_phase'] ?? '').trim();
    return {
      ok: true as const,
      value: {
        kind: 'person',
        full_name: full,
        ...portFullName(full),
        preferred_name: portBlank(raw['preferred_name']),
        date_of_birth: portDate(raw['date_of_birth']),
        pronouns: portBlank(raw['pronouns']),
        primary_language: portBlank(raw['primary_language']),
        current_phase: PORT_PHASES.has(phase) ? phase : 'early_concern',
        owner_relationship: portBlank(raw['owner_relationship']),
        contact_kind: contactName ? 'contact' : null,
        contact_name: contactName,
        contact_phone: portBlank(raw['contact_phone']),
        contact_email: portEmail(raw['contact_email']),
      },
    };
  },
};

const petPort: PortDescriptor<AnyRow, PortRecord> = {
  resource: 'pets',
  columns: [
    { key: 'full_name', header: 'Name', aliases: ['pet', 'full name'], toCell: (r) => cell(r['full_name']) },
    { key: 'species', header: 'Species', toCell: (r) => cell(r['species']) },
    { key: 'breed', header: 'Breed', toCell: (r) => cell(r['breed']) },
    { key: 'desexed', header: 'Desexed', aliases: ['neutered', 'spayed'], toCell: (r) => (r['desexed'] ? 'true' : 'false') },
    { key: 'microchip_number', header: 'Microchip', aliases: ['microchip number', 'chip'], toCell: (r) => cell(r['microchip_number']) },
    { key: 'date_of_birth', header: 'Date of birth', aliases: ['dob'], toCell: (r) => cell(r['date_of_birth']).slice(0, 10) },
    { key: 'owner_relationship', header: 'Relationship', aliases: ['relationship'], toCell: (r) => cell(r['owner_relationship']) },
    { key: 'contact_name', header: 'Contact name', toCell: (r) => cell(r['contact_name']) },
    { key: 'contact_phone', header: 'Contact phone', toCell: (r) => cell(r['contact_phone']) },
    { key: 'contact_email', header: 'Contact email', toCell: (r) => cell(r['contact_email']) },
  ],
  coerce: (raw, n) => {
    const full = (raw['full_name'] ?? '').trim();
    if (!full) return { ok: false as const, error: `Row ${n}: a name is required.` };
    const contactName = portBlank(raw['contact_name']);
    return {
      ok: true as const,
      value: {
        kind: 'pet',
        full_name: full,
        ...portFullName(full),
        species: portBlank(raw['species']),
        breed: portBlank(raw['breed']),
        desexed: portBool(raw['desexed']),
        microchip_number: portBlank(raw['microchip_number']),
        date_of_birth: portDate(raw['date_of_birth']),
        current_phase: 'early_concern',
        owner_relationship: portBlank(raw['owner_relationship']),
        contact_kind: contactName ? 'contact' : null,
        contact_name: contactName,
        contact_phone: portBlank(raw['contact_phone']),
        contact_email: portEmail(raw['contact_email']),
      },
    };
  },
};

// Fetch the rows to export for a table, scoped to what the caller may see:
// super_admin sees all, everyone else their own account's records.
async function exportRows(table: string, account: { id: string; role: AccountRole }, extra?: (q: import('knex').Knex.QueryBuilder) => void) {
  let q = db(table).select('*');
  if (!roleAtLeast(account.role, 'super_admin')) q = q.where({ account_id: account.id });
  if (extra) extra(q);
  return q;
}

const importBody = z.object({ format: z.enum(['csv', 'json']).optional(), data: z.string().min(1) });

// Wire an export and an import route for one directory resource.
function mountPort(
  path: string,
  descriptor: PortDescriptor<AnyRow, PortRecord>,
  opts: {
    table: string;
    kind?: ProfileKind;
    canWrite: (role: AccountRole) => boolean;
    afterImport?: (ids: string[]) => Promise<void>;
  }
) {
  directoryRouter.get(`/${path}/export`, requireAuth, async (req, res) => {
    const account = req.account!;
    const format = portReadFormat(req.query['format']);
    const rows = await exportRows(opts.table, account, (q) => {
      if (opts.kind) q.where({ kind: opts.kind, archived: false });
      q.orderBy(opts.kind ? 'full_name' : (descriptor.columns[0]!.key), 'asc');
    });
    const { body, contentType, filename } = exportRecords(descriptor, rows as AnyRow[], format);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  });

  directoryRouter.post(`/${path}/import`, requireAuth, async (req, res) => {
    const account = req.account!;
    if (!opts.canWrite(account.role)) {
      res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
      return;
    }
    const parsed = importBody.safeParse(req.body);
    let text: string;
    let format: PortFormat;
    if (typeof req.body === 'string') {
      text = req.body;
      format = portReadFormat(req.query['format'] ?? (req.is('application/json') ? 'json' : 'csv'));
    } else if (parsed.success) {
      text = parsed.data.data;
      format = parsed.data.format ?? portReadFormat(req.query['format']);
    } else {
      res.status(400).json({ error: 'Provide the file contents in a "data" field.', code: 'VALIDATION_ERROR' });
      return;
    }
    const { records, errors, total } = importRecords(descriptor, text, format);
    if (records.length === 0) {
      res.status(400).json({ error: 'No valid rows found to import.', code: 'IMPORT_EMPTY', imported: 0, skipped: total, errors });
      return;
    }
    const rows = records.map((r) => ({ ...r, account_id: account.id }));
    const inserted = await db(opts.table).insert(rows).returning('id');
    if (opts.afterImport) await opts.afterImport(inserted.map((r) => (r as { id: string }).id));
    res.status(201).json({ imported: inserted.length, skipped: errors.length, errors });
  });
}

const adminWrite = (role: AccountRole) => roleAtLeast(role, 'admin');
const anyWrite = () => true;

mountPort('providers', providerPort, { table: 'providers', canWrite: adminWrite });
mountPort('suppliers', supplierPort, { table: 'suppliers', canWrite: anyWrite });
mountPort('assets', assetPort, { table: 'assets', canWrite: anyWrite });
mountPort('addresses', addressPort, { table: 'addresses', canWrite: adminWrite });
mountPort('people', personPort, { table: 'care_profiles', kind: 'person', canWrite: adminWrite });
mountPort('pets', petPort, { table: 'care_profiles', kind: 'pet', canWrite: adminWrite });
