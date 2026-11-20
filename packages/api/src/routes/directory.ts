import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { roleAtLeast } from '../middleware/requireRole';
import { providerAddressFields, providerContactFields, providerKindField, providerOtherNames, providerPracticeFields, providerWriteColumns, withComposedAddress } from './providers';
import { kindFor, type ProviderKind } from '../lib/providerTypes';
import { contactSummaries, ensureProfessional, linkContactToSuppliers, linkSupplierToContact, resolveAssetSupplier, supplierContacts } from '../services/professionals';
import { accountHasRight } from '../middleware/accountRights';
import { PLAN_LIMITS, getEffectiveTier } from '../middleware/subscriptionGate';
import { hoursFromText, hoursToText } from '../lib/openingHours';
import { dismissDuplicate, likelyDuplicates, mergeProviders, undoMerge } from '../services/providerMerge';
import {
  addPracticeMember,
  attachMemberById,
  practiceColumns,
  practiceMembers,
  removePracticeMember,
  storeProviderType,
  syncPracticeMembers,
  inheritContact,
  SHARED_CONTACT_FIELDS,
} from '../services/providerPractices';
import { addressColumns, ADDRESS_PART_KEYS, RESIDENCE_KIND, syncProfileResidence, syncResidenceForAddress, wifiColumns, withReadableWifi } from '../services/addresses';
import { decryptSecret } from '../services/secretsCrypto';
import { exportRecords, importRecords, type PortDescriptor, type PortFormat } from '../services/dataPort';
import { phaseFrom, phaseLabel } from '../lib/phases';
import type { AccountRole, CareProfile, Provider, ProfileKind } from '../types';

export const directoryRouter = Router();

// ── Who an ordinary account can see ─────────────────────────

/**
 * The care profiles an ordinary account can see: every one it set up, plus
 * every one it was invited to and accepted. Most owners are not members of
 * their own profiles, so a directory scoped by membership alone came up
 * empty for the very person who filled it in.
 */
const VISIBLE_PROFILE_IDS_SQL = `(
  SELECT vp.id FROM care_profiles vp WHERE vp.account_id = ?
  UNION
  SELECT vm.care_profile_id FROM care_circle_members vm WHERE vm.account_id = ? AND vm.invite_accepted = true
)`;
const visibleProfileBindings = (accountId: string) => [accountId, accountId];

// ── Care profiles (people & pets) ─────────────────────────

/**
 * List care profiles of a given kind for the directory.
 *   super_admin  => every profile of that kind in the system
 *   admin        => profiles belonging to their account
 *   user/viewer  => profiles they set up, and those shared with them
 */
function profilesEndpoint(kind: ProfileKind) {
  return async (req: import('express').Request, res: import('express').Response) => {
    const account = req.account!;

    const columns = [
      'cp.id', 'cp.full_name', 'cp.preferred_name', 'cp.date_of_birth',
      'cp.current_phase', 'cp.photo_url', 'cp.photo_color',
      'cp.contact_kind', 'cp.contact_account_id', 'cp.contact_profile_id',
      'cp.contact_name', 'cp.contact_phone', 'cp.contact_email', 'cp.contact_relationship',
      'cp.owner_relationship', 'cp.room_number',
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
      query = query.whereRaw(`cp.id IN ${VISIBLE_PROFILE_IDS_SQL}`, visibleProfileBindings(account.id));
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

    // Their GP, on columns of its own: never standing in as the contact.
    const gpMap = await mainGps(ids);

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
      const contactPhone = p.contact_phone || carer?.contact_phone || null;
      const contactEmail = p.contact_email || carer?.contact_email || linked?.email || null;
      const gp = gpMap.get(p.id) ?? null;
      // Next of kin is a person to contact about them, never themselves.
      const isKin = contact_kindOf(p) === 'contact' || contact_kindOf(p) === 'user' || contact_kindOf(p) === 'profile';

      const { contact_kind, contact_account_id, contact_profile_id, ...rest } = p;
      void contact_kind;
      void contact_account_id;
      void contact_profile_id;
      return {
        ...rest,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        gp_name: gp?.name ?? null,
        gp_phone: gp?.phone ?? null,
        gp_practice: gp?.practice ?? null,
        next_of_kin_name: isKin ? contactName : null,
        next_of_kin_relationship: isKin ? (p as CareProfile & { contact_relationship?: string | null }).contact_relationship ?? null : null,
        next_of_kin_phone: isKin ? contactPhone : null,
      };
    });

    const canEdit = roleAtLeast(account.role, 'admin');
    // Anyone who may set up a profile may bring a list of people in.
    res.json({ profiles, can_edit: canEdit, can_import: canEdit || accountHasRight(account, 'can_create_care_profiles') });
  };
}

const contact_kindOf = (p: CareProfile): string | null => (p as CareProfile & { contact_kind?: string | null }).contact_kind ?? null;

/** Each person's main GP: the one marked main, else the first linked, never one they no longer see. */
async function mainGps(ids: string[]): Promise<Map<string, { name: string; phone: string | null; practice: string | null }>> {
  const out = new Map<string, { name: string; phone: string | null; practice: string | null }>();
  if (ids.length === 0) return out;
  const rows = (await db.raw(
    `SELECT DISTINCT ON (cpp.care_profile_id) cpp.care_profile_id, cpp.provider_id
       FROM care_profile_providers cpp JOIN providers p ON p.id = cpp.provider_id
      WHERE cpp.care_profile_id = ANY(?) AND lower(p.provider_type) = 'gp' AND cpp.ended_on IS NULL
      ORDER BY cpp.care_profile_id, cpp.is_main DESC, cpp.created_at ASC, cpp.id`,
    [ids]
  )) as { rows: Array<{ care_profile_id: string; provider_id: string }> };
  const summaries = await contactSummaries(db, rows.rows.map((r) => r.provider_id));
  for (const r of rows.rows) {
    const s = summaries.get(r.provider_id);
    if (s) out.set(r.care_profile_id, { name: s.name, phone: s.phone, practice: s.organisation?.name ?? null });
  }
  return out;
}

directoryRouter.get('/people', requireAuth, profilesEndpoint('person'));
directoryRouter.get('/pets', requireAuth, profilesEndpoint('pet'));

const providerSchema = z.object({
  provider_type: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  ...providerAddressFields,
  ...providerPracticeFields,
  ...providerOtherNames,
  ...providerKindField,
  ...providerContactFields,
  booking_link: z.string().url().optional().nullable(),
  directions_link: z.string().url().optional().nullable(),
});

/**
 * List providers for the directory. `?kind=organisation` or `?kind=person`
 * lists only organisations or only professionals.
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
      // Who works here, so a practice shows its people and a person shows
      // their practice: the same link read from both ends.
      db.raw(`(
        SELECT json_agg(json_build_object('id', m.id, 'name', m.name, 'provider_type', m.provider_type, 'kind', m.kind) ORDER BY m.name)
        FROM providers m
        WHERE m.practice_id = p.id
      ) AS members`),
    )
    .orderBy('p.name', 'asc');
  const kind = req.query['kind'];
  if (kind === 'organisation' || kind === 'person') query = query.where('p.kind', kind);

  if (roleAtLeast(account.role, 'super_admin')) {
    // See everything
  } else if (roleAtLeast(account.role, 'admin')) {
    query = query.where('p.account_id', account.id);
  } else {
    // Their own contacts, and any linked to a profile they can see.
    query = query.where((qb) =>
      qb.where('p.account_id', account.id).orWhereRaw(
        `EXISTS (SELECT 1 FROM care_profile_providers cpp WHERE cpp.provider_id = p.id AND cpp.care_profile_id IN ${VISIBLE_PROFILE_IDS_SQL})`,
        visibleProfileBindings(account.id)
      )
    );
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

  const { columns, note } = await providerWriteColumns(account.id, parsed.data);
  const [provider] = await db<Provider>('providers')
    .insert({ account_id: account.id, ...columns })
    .returning('*');
  await linkContactToSuppliers(db, provider.id);

  res.status(201).json({ provider, note });
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

  const current = await editableProvider(account, req.params['id'] as string);
  if (!current) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }

  const { columns, note } = await providerWriteColumns(current.account_id, parsed.data, current.id);
  const [provider] = Object.keys(columns).length > 0
    ? await db<Provider>('providers').where({ id: current.id }).update(columns).returning('*')
    : [current];
  // Anyone who works here follows a rename or a move.
  await syncPracticeMembers(current.id);
  res.json({ provider, note });
});

/** A provider this account may change: its own, or any for a super admin. */
async function editableProvider(account: { id: string; role: AccountRole }, id: string): Promise<Provider | undefined> {
  let query = db<Provider>('providers').where({ id });
  if (!roleAtLeast(account.role, 'super_admin')) query = query.where({ account_id: account.id });
  return query.first();
}

// -- Duplicates: spot them, merge them, undo a merge -----------------------

directoryRouter.get('/providers/duplicates', requireAuth, async (req, res) => {
  if (!roleAtLeast(req.account!.role, 'admin')) {
    res.json({ pairs: [] });
    return;
  }
  res.json({ pairs: await likelyDuplicates(req.account!.id) });
});

const pairSchema = z.object({ first_id: z.string().uuid(), second_id: z.string().uuid() });

directoryRouter.post('/providers/duplicates/dismiss', requireAuth, async (req, res) => {
  const account = req.account!;
  const parsed = pairSchema.safeParse(req.body);
  if (!roleAtLeast(account.role, 'admin') || !parsed.success) {
    res.status(!parsed.success ? 400 : 403).json({ error: 'That could not be dismissed.', code: 'FORBIDDEN' });
    return;
  }
  const [a, b] = await Promise.all([editableProvider(account, parsed.data.first_id), editableProvider(account, parsed.data.second_id)]);
  if (!a || !b) {
    res.status(404).json({ error: 'One of those records is no longer there.', code: 'NOT_FOUND' });
    return;
  }
  await dismissDuplicate(a.account_id, a.id, b.id);
  res.json({ message: 'Dismissed. They will not be suggested as the same again.' });
});

const mergeSchema = z.object({ keep_id: z.string().uuid(), remove_id: z.string().uuid() });

directoryRouter.post('/providers/merge', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  const parsed = mergeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Pick the two records to merge.', code: 'VALIDATION_ERROR' });
    return;
  }
  const [keep, remove] = await Promise.all([editableProvider(account, parsed.data.keep_id), editableProvider(account, parsed.data.remove_id)]);
  if (!keep || !remove) {
    res.status(404).json({ error: 'One of those records is no longer there. Refresh the page and try again.', code: 'NOT_FOUND' });
    return;
  }
  const result = await mergeProviders(keep.id, remove.id, account.id);
  if ('error' in result) {
    res.status(409).json({ error: result.error, code: 'MERGE_FAILED' });
    return;
  }
  res.json({ merge_id: result.mergeId, message: result.summary });
});

directoryRouter.post('/providers/merges/:mergeId/undo', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  const result = await undoMerge(String(req.params['mergeId']), roleAtLeast(account.role, 'super_admin') ? null : account.id);
  if ('error' in result) {
    res.status(409).json({ error: result.error, code: 'UNDO_FAILED' });
    return;
  }
  res.json(result);
});

// -- People who work at a practice, from the practice's side ---------------

directoryRouter.get('/providers/:id/members', requireAuth, async (req, res) => {
  const practice = await db<Provider>('providers').where({ id: req.params['id'] }).first();
  if (!practice || (!roleAtLeast(req.account!.role, 'super_admin') && practice.account_id !== req.account!.id)) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ members: await practiceMembers(practice.id) });
});

const directoryMemberSchema = z.union([
  z.object({ provider_id: z.string().uuid() }),
  z.object({
    name: z.string().min(1).max(255),
    provider_type: z.string().max(100).optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    email: z.string().max(255).optional().nullable(),
  }),
]);

directoryRouter.post('/providers/:id/members', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  const practice = await editableProvider(account, req.params['id'] as string);
  if (!practice) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }
  const parsed = directoryMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  let message: string;
  if ('provider_id' in parsed.data) {
    const result = await attachMemberById(practice.id, parsed.data.provider_id);
    if (!result) {
      res.status(404).json({ error: 'Provider not found in this account', code: 'NOT_FOUND' });
      return;
    }
    message = result;
  } else {
    const { name, ...details } = parsed.data;
    message = (await addPracticeMember(practice.account_id, name, practice.name, details)).outcome;
  }
  res.status(201).json({ message, members: await practiceMembers(practice.id) });
});

directoryRouter.delete('/providers/:id/members/:memberId', requireAuth, async (req, res) => {
  const account = req.account!;
  if (!roleAtLeast(account.role, 'admin')) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return;
  }
  const practice = await editableProvider(account, req.params['id'] as string);
  if (!practice || !(await removePracticeMember(practice.id, req.params['memberId'] as string))) {
    res.status(404).json({ error: 'That person is not filed at this practice.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Removed from this practice.', members: await practiceMembers(practice.id) });
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
    // A non-admin sees their own suppliers, and any connected to a profile
    // they can see, whether by a manual link or by a medication that names it.
    query = query.where((qb) =>
      qb
        .where('s.account_id', account.id)
        .orWhereRaw(
          `EXISTS (SELECT 1 FROM care_profile_suppliers cps WHERE cps.supplier_id = s.id AND cps.care_profile_id IN ${VISIBLE_PROFILE_IDS_SQL})`,
          visibleProfileBindings(account.id)
        )
        .orWhereRaw(
          `EXISTS (SELECT 1 FROM medications m2 WHERE m2.supplier_id = s.id AND m2.care_profile_id IN ${VISIBLE_PROFILE_IDS_SQL})`,
          visibleProfileBindings(account.id)
        )
    );
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
  await linkSupplierToContact(db, supplier.id);
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
  // The supplier on file; a bare name above is found or filed as one.
  supplier_id: z.string().uuid().optional().nullable(),
  warranty_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  condition: z.string().max(30).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  // Years the equipment is written down over, for straight-line depreciation.
  useful_life_years: z.coerce.number().int().min(0).max(100).optional().nullable(),
});

// Straight-line depreciation from the price, purchase date and useful life:
// the yearly write-down, how much has been written down so far, and the current
// book value. Each is its own figure, computed, never stored.
function assetDepreciation(price: number | null, purchaseDate: string | null, usefulLife: number | null): {
  annual_depreciation: number | null;
  depreciated_amount: number | null;
  book_value: number | null;
} {
  if (price == null) return { annual_depreciation: null, depreciated_amount: null, book_value: null };
  if (usefulLife == null || usefulLife <= 0) {
    return { annual_depreciation: null, depreciated_amount: null, book_value: price };
  }
  const annual = price / usefulLife;
  let elapsedYears = 0;
  if (purchaseDate) {
    const ms = Date.now() - new Date(`${purchaseDate}T00:00:00Z`).getTime();
    elapsedYears = Math.max(0, ms / (365.25 * 24 * 3600 * 1000));
  }
  const depreciated = Math.min(price, annual * elapsedYears);
  const round2n = (n: number) => Math.round(n * 100) / 100;
  return {
    annual_depreciation: round2n(annual),
    depreciated_amount: round2n(depreciated),
    book_value: round2n(price - depreciated),
  };
}

// Postgres returns a decimal as a string and a date as a Date; hand the client
// a real number and a plain YYYY-MM-DD so the list and form get what they expect.
const assetDate = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const serializeAsset = <T extends Record<string, unknown>>(a: T): T => {
  const price = a['price'] == null || a['price'] === '' ? null : Number(a['price']);
  const purchaseDate = assetDate(a['purchase_date']);
  const usefulLife = a['useful_life_years'] == null || a['useful_life_years'] === '' ? null : Number(a['useful_life_years']);
  return {
    ...a,
    price,
    purchase_date: purchaseDate,
    warranty_expiry: assetDate(a['warranty_expiry']),
    useful_life_years: usefulLife,
    ...assetDepreciation(price, purchaseDate, usefulLife),
  };
};

// Turn a validated body into the columns to write, cleaning blank strings to null.
function assetColumns(data: z.infer<typeof assetSchema> | Partial<z.infer<typeof assetSchema>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ('name' in data) out['name'] = (data.name ?? '').trim();
  if ('category' in data) out['category'] = cleanField(data.category);
  if ('serial_number' in data) out['serial_number'] = cleanField(data.serial_number);
  if ('make_model' in data) out['make_model'] = cleanField(data.make_model);
  if ('price' in data) out['price'] = data.price ?? null;
  if ('purchase_date' in data) out['purchase_date'] = data.purchase_date ?? null;
  if ('warranty_expiry' in data) out['warranty_expiry'] = data.warranty_expiry ?? null;
  if ('condition' in data) out['condition'] = cleanField(data.condition);
  if ('location' in data) out['location'] = cleanField(data.location);
  if ('notes' in data) out['notes'] = cleanField(data.notes);
  if ('useful_life_years' in data) out['useful_life_years'] = data.useful_life_years ?? null;
  return out;
}

/**
 * The supplier columns for an equipment write: the supplier picked, or the
 * name found or filed as a supplier. Nothing when the write does not
 * mention one; null when the picked supplier belongs elsewhere.
 */
async function assetSupplierColumns(
  accountId: string,
  data: Partial<z.infer<typeof assetSchema>>
): Promise<Record<string, unknown> | null> {
  if (!('supplier_id' in data) && !('supplier' in data)) return {};
  return resolveAssetSupplier(db, accountId, { supplier_id: data.supplier_id, supplier: data.supplier });
}

/** One equipment record with who supplies it, as screens read it. */
async function assetOut(asset: Record<string, unknown>) {
  const contacts = await supplierContacts(db, [asset['supplier_id'] as string | null]);
  return serializeAsset({ ...asset, supplier_contact: (asset['supplier_id'] && contacts.get(asset['supplier_id'] as string)) || null });
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
    // Their own equipment, and any linked to a profile they can see.
    query = query.where((qb) =>
      qb.where('a.account_id', account.id).orWhereRaw(
        `EXISTS (SELECT 1 FROM care_profile_assets cpa WHERE cpa.asset_id = a.id AND cpa.care_profile_id IN ${VISIBLE_PROFILE_IDS_SQL})`,
        visibleProfileBindings(account.id)
      )
    );
  }

  const assets = await query;
  const contacts = await supplierContacts(db, assets.map((a: Record<string, unknown>) => a['supplier_id'] as string | null));
  // Assets are account-scoped and managed here by any signed-in carer, the same
  // as suppliers, rather than gated behind a platform admin.
  res.json({
    assets: assets.map((a: Record<string, unknown>) =>
      serializeAsset({ ...a, supplier_contact: (a['supplier_id'] && contacts.get(a['supplier_id'] as string)) || null })
    ),
    can_edit: true,
  });
});

/** Create an asset at the account level. */
directoryRouter.post('/assets', requireAuth, async (req, res) => {
  const account = req.account!;
  const parsed = assetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const supplier = await assetSupplierColumns(account.id, parsed.data);
  if (!supplier) {
    res.status(400).json({ error: 'That supplier is not in this account.', code: 'VALIDATION_ERROR' });
    return;
  }
  const [asset] = await db('assets')
    .insert({ account_id: account.id, ...assetColumns(parsed.data), ...supplier })
    .returning('*');
  res.status(201).json({ asset: await assetOut(asset) });
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
  const current = await query.clone().first('account_id');
  if (!current) {
    res.status(404).json({ error: 'Asset not found', code: 'NOT_FOUND' });
    return;
  }
  const supplier = await assetSupplierColumns(current.account_id, parsed.data);
  if (!supplier) {
    res.status(400).json({ error: 'That supplier is not in this account.', code: 'VALIDATION_ERROR' });
    return;
  }
  const [asset] = await query.update({ ...assetColumns(parsed.data), ...supplier }).returning('*');
  if (!asset) {
    res.status(404).json({ error: 'Asset not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ asset: await assetOut(asset) });
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
  // The Wi-Fi at this address: what the network is called, and the password.
  wifi_network_name: z.string().max(255).optional().nullable(),
  wifi_password: z.string().max(255).optional().nullable(),
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
    // Their own addresses, and any linked to a profile they can see.
    query = query.where((qb) =>
      qb.where('a.account_id', account.id).orWhereRaw(
        `EXISTS (SELECT 1 FROM care_profile_addresses cpa WHERE cpa.address_id = a.id AND cpa.care_profile_id IN ${VISIBLE_PROFILE_IDS_SQL})`,
        visibleProfileBindings(account.id)
      )
    );
  }

  const addresses = (await query).map(withReadableWifi);
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
    .insert({ account_id: account.id, ...addressColumns(parsed.data, parsed.data.label), ...wifiColumns(parsed.data) })
    .returning('*');
  res.status(201).json({ address: withReadableWifi(address) });
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
  const [address] = await query
    .update({ ...addressColumns(merged, merged.label), ...wifiColumns(parsed.data), updated_at: db.fn.now() })
    .returning('*');
  // Editing the shared address updates it everywhere, including each person's
  // "where they live" for whom it is their residence.
  await syncResidenceForAddress(address.id, address);
  res.json({ address: withReadableWifi(address) });
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
    { key: 'kind', header: 'Kind', aliases: ['record kind'], toCell: (r) => (r['kind'] === 'organisation' ? 'Organisation' : 'Professional') },
    { key: 'provider_type', header: 'Type', aliases: ['provider type', 'role'], toCell: (r) => cell(r['provider_type']) },
    { key: 'organisation', header: 'Based at', aliases: ['works at', 'part of', 'organisation', 'organization', 'org', 'clinic', 'practice'], toCell: (r) => cell(r['organisation']) },
    { key: 'phone', header: 'Phone', toCell: (r) => cell(r['phone']) },
    { key: 'email', header: 'Email', toCell: (r) => cell(r['email']) },
    { key: 'after_hours_phone', header: 'After-hours phone', aliases: ['after hours', 'after hours phone'], toCell: (r) => cell(r['after_hours_phone']) },
    { key: 'fax', header: 'Fax', toCell: (r) => cell(r['fax']) },
    { key: 'opening_hours', header: 'Opening hours', aliases: ['hours'], toCell: (r) => hoursToText(r['opening_hours']) },
    { key: 'address_line1', header: 'Address line 1', aliases: ['address', 'street'], toCell: (r) => cell(r['address_line1']) },
    { key: 'address_line2', header: 'Address line 2', toCell: (r) => cell(r['address_line2']) },
    { key: 'address_suburb', header: 'Suburb', aliases: ['city', 'town'], toCell: (r) => cell(r['address_suburb']) },
    { key: 'address_state', header: 'State', toCell: (r) => cell(r['address_state']) },
    { key: 'address_postcode', header: 'Postcode', aliases: ['zip', 'postal code'], toCell: (r) => cell(r['address_postcode']) },
    { key: 'address_country', header: 'Country', toCell: (r) => cell(r['address_country']) },
    { key: 'booking_link', header: 'Booking link', aliases: ['booking'], toCell: (r) => cell(r['booking_link']) },
    { key: 'directions_link', header: 'Directions', aliases: ['directions link', 'map'], toCell: (r) => cell(r['directions_link']) },
    { key: 'also_known_as', header: 'Also known as', aliases: ['other names', 'aka'], toCell: (r) => ((r['also_known_as'] as string[] | null) ?? []).join('; ') },
  ],
  coerce: (raw, n) => {
    const name = (raw['name'] ?? '').trim();
    if (!name) return { ok: false as const, error: `Row ${n}: a provider name is required.` };
    const otherNames = (raw['also_known_as'] ?? '').split(';').map((s) => s.trim()).filter(Boolean);
    const kindCell = (raw['kind'] ?? '').trim().toLowerCase();
    const kind: ProviderKind = /^org/.test(kindCell)
      ? 'organisation'
      : /^(prof|person|people)/.test(kindCell)
        ? 'person'
        : kindFor(raw['provider_type'], name);
    return {
      ok: true as const,
      value: withComposedAddress({
        kind,
        provider_type: portBlank(raw['provider_type']) ?? 'other',
        name,
        organisation: portBlank(raw['organisation']),
        phone: portBlank(raw['phone']),
        email: portEmail(raw['email']),
        after_hours_phone: portBlank(raw['after_hours_phone']),
        fax: portBlank(raw['fax']),
        opening_hours: (() => {
          const hours = hoursFromText(raw['opening_hours']);
          return hours ? JSON.stringify(hours) : null;
        })(),
        address_line1: portBlank(raw['address_line1']),
        address_line2: portBlank(raw['address_line2']),
        address_suburb: portBlank(raw['address_suburb']),
        address_state: portBlank(raw['address_state']),
        address_postcode: portBlank(raw['address_postcode']),
        address_country: portBlank(raw['address_country']),
        booking_link: portUrl(raw['booking_link']),
        directions_link: portUrl(raw['directions_link']),
        also_known_as: otherNames,
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
    { key: 'useful_life_years', header: 'Useful life (years)', aliases: ['useful life', 'depreciation years', 'life years'], toCell: (r) => cell(r['useful_life_years']) },
    // Computed columns for the accountant: worked out from price, purchase date
    // and useful life at export time, read-only on import.
    { key: 'annual_depreciation', header: 'Annual depreciation', toCell: (r) => {
      const d = assetDepreciation(r['price'] == null ? null : Number(r['price']), cellDate(r['purchase_date']) || null, r['useful_life_years'] == null ? null : Number(r['useful_life_years']));
      return d.annual_depreciation == null ? '' : d.annual_depreciation.toFixed(2);
    } },
    { key: 'book_value', header: 'Book value', toCell: (r) => {
      const d = assetDepreciation(r['price'] == null ? null : Number(r['price']), cellDate(r['purchase_date']) || null, r['useful_life_years'] == null ? null : Number(r['useful_life_years']));
      return d.book_value == null ? '' : d.book_value.toFixed(2);
    } },
    { key: 'location', header: 'Location', aliases: ['kept', 'where'], toCell: (r) => cell(r['location']) },
    { key: 'notes', header: 'Notes', toCell: (r) => cell(r['notes']) },
  ],
  coerce: (raw, n) => {
    const name = (raw['name'] ?? '').trim();
    if (!name) return { ok: false as const, error: `Row ${n}: a unit name is required.` };
    const priceNum = parseFloat(String(raw['price'] ?? '').replace(/[^0-9.]/g, ''));
    const lifeNum = parseInt(String(raw['useful_life_years'] ?? '').replace(/[^0-9]/g, ''), 10);
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
        useful_life_years: Number.isFinite(lifeNum) ? lifeNum : null,
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
    // The Wi-Fi is two data points, so two columns. The password exports in
    // the clear, because an export is for the person who already has access.
    { key: 'wifi_network_name', header: 'Wi-Fi network name', aliases: ['wifi', 'network name', 'ssid'], toCell: (r) => cell(r['wifi_network_name']) },
    {
      key: 'wifi_password',
      header: 'Wi-Fi password',
      aliases: ['wifi key', 'network password'],
      toCell: (r) => cell(decryptSecret(r['wifi_password'] as string | null)),
    },
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
    return {
      ok: true as const,
      value: {
        ...addressColumns(parts, portBlank(raw['label'])),
        ...wifiColumns({
          wifi_network_name: portBlank(raw['wifi_network_name']),
          wifi_password: portBlank(raw['wifi_password']),
        }),
      },
    };
  },
};

const personPort: PortDescriptor<AnyRow, PortRecord> = {
  resource: 'people',
  columns: [
    { key: 'full_name', header: 'Name', aliases: ['full name', 'person'], toCell: (r) => cell(r['full_name']) },
    { key: 'preferred_name', header: 'Preferred name', aliases: ['known as'], toCell: (r) => cell(r['preferred_name']) },
    { key: 'date_of_birth', header: 'Date of birth', aliases: ['dob', 'birthdate'], toCell: (r) => cellDate(r['date_of_birth']) },
    { key: 'pronouns', header: 'Pronouns', toCell: (r) => cell(r['pronouns']) },
    { key: 'primary_language', header: 'Language', aliases: ['primary language'], toCell: (r) => cell(r['primary_language']) },
    // The phase as the screens name it; a file read back in may carry either.
    { key: 'current_phase', header: 'Phase', aliases: ['care phase'], toCell: (r) => phaseLabel(r['current_phase'] as string | null) },
    { key: 'owner_relationship', header: 'Relationship', aliases: ['relationship'], toCell: (r) => cell(r['owner_relationship']) },
    { key: 'room_number', header: 'Room', aliases: ['room number', 'room no', 'bed'], toCell: (r) => cell(r['room_number']) },
    { key: 'gp_name', header: 'GP name', aliases: ['gp', 'doctor', 'general practitioner'], toCell: (r) => cell(r['gp_name']) },
    { key: 'gp_phone', header: 'GP phone', aliases: ['doctor phone'], toCell: (r) => cell(r['gp_phone']) },
    { key: 'gp_practice', header: 'GP practice', aliases: ['practice', 'medical centre', 'clinic'], toCell: (r) => cell(r['gp_practice']) },
    { key: 'contact_name', header: 'Next of kin name', aliases: ['next of kin', 'nok', 'nok name', 'contact name', 'contact'], toCell: (r) => cell(r['contact_name']) },
    { key: 'contact_relationship', header: 'Next of kin relationship', aliases: ['nok relationship', 'contact relationship', 'relationship to them'], toCell: (r) => cell(r['contact_relationship']) },
    { key: 'contact_phone', header: 'Next of kin phone', aliases: ['nok phone', 'contact phone'], toCell: (r) => cell(r['contact_phone']) },
    { key: 'contact_email', header: 'Next of kin email', aliases: ['nok email', 'contact email'], toCell: (r) => cell(r['contact_email']) },
  ],
  coerce: (raw, n) => {
    const full = (raw['full_name'] ?? '').trim();
    if (!full) return { ok: false as const, error: `Row ${n}: a name is required.` };
    const contactName = portBlank(raw['contact_name']);
    const phase = (raw['current_phase'] ?? '').trim();
    const room = portBlank(raw['room_number']);
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
        current_phase: phaseFrom(phase) ?? 'early_concern',
        owner_relationship: portBlank(raw['owner_relationship']),
        room_number: room,
        contact_kind: contactName ? 'contact' : null,
        contact_name: contactName,
        contact_relationship: portBlank(raw['contact_relationship']),
        contact_phone: portBlank(raw['contact_phone']),
        contact_phone_type: portBlank(raw['contact_phone']) ? (/^\s*(\+?61\s*4|04)/.test(raw['contact_phone'] ?? '') ? 'mobile' : 'home') : null,
        contact_email: portEmail(raw['contact_email']),
        // Filed in Contacts after the person is saved, not on the profile.
        _gp: portBlank(raw['gp_name']) ? { name: portBlank(raw['gp_name']), phone: portBlank(raw['gp_phone']), practice: portBlank(raw['gp_practice']) } : null,
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
    { key: 'date_of_birth', header: 'Date of birth', aliases: ['dob'], toCell: (r) => cellDate(r['date_of_birth']) },
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
    /** Organisations only, or professionals only, out of the providers table. */
    providerKind?: ProviderKind;
    canWrite: (role: AccountRole) => boolean;
    /** Who else may import, by an account right, such as setting up profiles. */
    canWriteAccount?: (account: NonNullable<import('express').Request['account']>) => boolean;
    afterImport?: (ids: string[], records?: PortRecord[]) => Promise<void>;
    /** Columns that live outside the table, added to each row before export. */
    decorate?: (rows: AnyRow[]) => Promise<AnyRow[]>;
    /** How many more rows this account may add, when its plan caps them. */
    roomFor?: (account: NonNullable<import('express').Request['account']>) => Promise<number>;
  }
) {
  directoryRouter.get(`/${path}/export`, requireAuth, async (req, res) => {
    const account = req.account!;
    const format = portReadFormat(req.query['format']);
    const rows = await exportRows(opts.table, account, (q) => {
      if (opts.kind) q.where({ kind: opts.kind, archived: false });
      if (opts.providerKind) q.where({ kind: opts.providerKind });
      q.orderBy(opts.kind ? 'full_name' : (descriptor.columns[0]!.key), 'asc');
    });
    const decorated = opts.decorate ? await opts.decorate(rows as AnyRow[]) : (rows as AnyRow[]);
    const { body, contentType, filename } = exportRecords(descriptor, decorated, format);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  });

  directoryRouter.post(`/${path}/import`, requireAuth, async (req, res) => {
    const account = req.account!;
    if (!opts.canWrite(account.role) && !opts.canWriteAccount?.(account)) {
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
    if (opts.roomFor) {
      const room = await opts.roomFor(account);
      if (records.length > room) {
        res.status(402).json({
          error: room <= 0
            ? 'Your plan has no room for more people. Upgrade to add more.'
            : `Your plan has room for ${room} more ${room === 1 ? 'person' : 'people'}, and the file has ${records.length}. Remove some rows or upgrade, then import again.`,
          code: 'PLAN_LIMIT_REACHED',
        });
        return;
      }
    }
    // Side data (a GP to file in Contacts) never goes into the table itself.
    const rows = records.map((r) => {
      const { _gp, ...cols } = r as PortRecord & { _gp?: unknown };
      void _gp;
      return { ...cols, ...(opts.providerKind ? { kind: opts.providerKind } : {}), account_id: account.id };
    });
    const inserted = await db(opts.table).insert(rows).returning('id');
    if (opts.afterImport) await opts.afterImport(inserted.map((r) => (r as { id: string }).id), records);
    res.status(201).json({ imported: inserted.length, skipped: errors.length, errors });
  });
}

const adminWrite = (role: AccountRole) => roleAtLeast(role, 'admin');
const anyWrite = () => true;

// Imported rows get the same treatment as typed ones: their type joins the
// shared list for their kind, and whatever names where it is based is filed there.
const afterProviderImport = async (ids: string[]) => {
  const rows = await db('providers').whereIn('id', ids);
  for (const r of rows) {
    const provider_type = await storeProviderType(r.provider_type, r.account_id, r.kind);
    const { columns } = r.organisation
      ? await practiceColumns(r.account_id, { organisation: r.organisation }, r, r.id)
      : { columns: {} as Record<string, unknown> };
    const practiceRow = columns['practice_id'] ? await db('providers').where({ id: columns['practice_id'] as string }).first() : null;
    // Details left empty in the file come from where they are based.
    const empties = Object.fromEntries(SHARED_CONTACT_FIELDS.filter((f) => !r[f]).map((f) => [f, null]));
    await db('providers').where({ id: r.id }).update({ provider_type, ...columns, ...inheritContact(practiceRow, empties, { ...r, inherited_fields: [] }) });
  }
};
mountPort('providers', providerPort, { table: 'providers', canWrite: adminWrite, afterImport: afterProviderImport });
mountPort('organisations', providerPort, { table: 'providers', providerKind: 'organisation', canWrite: adminWrite, afterImport: afterProviderImport });
mountPort('professionals', providerPort, { table: 'providers', providerKind: 'person', canWrite: adminWrite, afterImport: afterProviderImport });
mountPort('suppliers', supplierPort, {
  table: 'suppliers',
  canWrite: anyWrite,
  afterImport: async (ids) => {
    for (const id of ids) await linkSupplierToContact(db, id);
  },
});
mountPort('assets', assetPort, {
  table: 'assets',
  canWrite: anyWrite,
  // The supplier named in the file becomes the supplier on file.
  afterImport: async (ids) => {
    const rows = (await db('assets').whereIn('id', ids).whereNotNull('supplier').select('id', 'account_id', 'supplier')) as Array<{ id: string; account_id: string; supplier: string }>;
    for (const r of rows) {
      const cols = await resolveAssetSupplier(db, r.account_id, { supplier: r.supplier });
      if (cols) await db('assets').where({ id: r.id }).update(cols);
    }
  },
});
mountPort('addresses', addressPort, { table: 'addresses', canWrite: adminWrite });
mountPort('people', personPort, {
  table: 'care_profiles',
  kind: 'person',
  canWrite: adminWrite,
  // A home manager brings her residents in, the same right as adding one.
  canWriteAccount: (account) => accountHasRight(account, 'can_create_care_profiles'),
  roomFor: async (account) => {
    const limit = PLAN_LIMITS.care_profiles[getEffectiveTier(account)];
    if (limit === Infinity) return Number.MAX_SAFE_INTEGER;
    const row = await db('care_profiles').where({ account_id: account.id, archived: false }).count('id as n').first();
    return Math.max(0, limit - Number(row?.n ?? 0));
  },
  // The GP has columns of their own in the file.
  decorate: async (rows) => {
    const gps = await mainGps(rows.map((r) => String(r['id'])));
    return rows.map((r) => {
      const gp = gps.get(String(r['id']));
      return { ...r, gp_name: gp?.name ?? null, gp_phone: gp?.phone ?? null, gp_practice: gp?.practice ?? null };
    });
  },
  // Each GP named in the file is found in Contacts or filed there, with
  // their number and practice, and linked to the person.
  afterImport: async (ids, records) => {
    for (let i = 0; i < ids.length; i++) {
      const gp = (records?.[i] as { _gp?: { name: string; phone: string | null; practice: string | null } | null } | undefined)?._gp;
      if (!gp?.name) continue;
      const filed = await ensureProfessional(db, { profileId: ids[i]!, name: gp.name, providerType: 'gp', phone: gp.phone });
      if (!filed || !gp.practice) continue;
      const row = await db('providers').where({ id: filed.id }).first();
      if (!row || row.practice_id) continue;
      const { columns } = await practiceColumns(row.account_id, { organisation: gp.practice }, row, row.id);
      if (Object.keys(columns).length) await db('providers').where({ id: row.id }).update(columns);
    }
  },
});
mountPort('pets', petPort, { table: 'care_profiles', kind: 'pet', canWrite: adminWrite });
