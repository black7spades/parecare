import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import {
  addPracticeMember,
  attachMemberById,
  practiceColumns,
  practiceMembers,
  removePracticeMember,
  storeProviderType,
  syncPracticeMembers,
} from '../services/providerPractices';
import type { Provider, CareProfileProvider } from '../types';
import { similarName } from '../lib/providerNames';

export const providersRouter = Router({ mergeParams: true });

// Segmented address, each part its own field, shared by both provider
// routers (per-profile here and account-level in the directory).
export const providerAddressFields = {
  // Kept as a composed one-line display, recomposed from the parts on write.
  address: z.string().optional().nullable(),
  address_line1: z.string().max(255).optional().nullable(),
  address_line2: z.string().max(255).optional().nullable(),
  address_suburb: z.string().max(120).optional().nullable(),
  address_state: z.string().max(120).optional().nullable(),
  address_postcode: z.string().max(20).optional().nullable(),
  address_country: z.string().max(120).optional().nullable(),
};

/**
 * Where a provider works, shared by both provider routers. A practice is
 * picked by id, or named in words (found, or filed if new). "organisation"
 * is the older name for the same thing and is still accepted.
 */
export const providerPracticeFields = {
  practice_id: z.string().uuid().optional().nullable(),
  practice_name: z.string().max(255).optional().nullable(),
  organisation: z.string().max(255).optional().nullable(),
  uses_practice_address: z.boolean().optional(),
};

/** The other names a provider goes by: one field, several names. */
export const providerOtherNames = {
  also_known_as: z.array(z.string().trim().min(1).max(255)).max(30).optional(),
};

const providerSchema = z.object({
  provider_type: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  ...providerAddressFields,
  ...providerPracticeFields,
  ...providerOtherNames,
  booking_link: z.string().url().optional().nullable(),
  directions_link: z.string().url().optional().nullable(),
});

const PRACTICE_KEYS = ['practice_id', 'practice_name', 'organisation', 'uses_practice_address'] as const;

/** Split a parsed provider write into its own columns and its practice input. */
export function splitPracticeInput<T extends Record<string, unknown>>(data: T): {
  own: Record<string, unknown>;
  practice: Record<string, unknown>;
} {
  const own: Record<string, unknown> = {};
  const practice: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if ((PRACTICE_KEYS as readonly string[]).includes(k)) practice[k] = v;
    else own[k] = v;
  }
  return { own, practice };
}

const ADDRESS_PARTS = ['address_line1', 'address_line2', 'address_suburb', 'address_state', 'address_postcode', 'address_country'] as const;

/** Provider columns returned to the client, including the segmented address. */
const PROVIDER_COLS = [
  'p.id', 'p.account_id', 'p.provider_type', 'p.name', 'p.organisation',
  'p.phone', 'p.email', 'p.address',
  'p.address_line1', 'p.address_line2', 'p.address_suburb', 'p.address_state', 'p.address_postcode', 'p.address_country',
  'p.booking_link', 'p.directions_link', 'p.practice_id', 'p.uses_practice_address', 'p.also_known_as',
  'p.created_at', 'cpp.poa_type', 'cpp.poa_activated', 'cpp.primary_contact_member_id',
  db.raw('(SELECT count(*)::int FROM providers m WHERE m.practice_id = p.id) AS member_count'),
] as const;

/**
 * Keep the one-line `address` in step with the segmented parts whenever a
 * write touches them, so every existing reader of `address` stays correct.
 */
export function withComposedAddress<T extends Record<string, unknown>>(data: T): T {
  if (!ADDRESS_PARTS.some((k) => k in data)) return data;
  const composed = ADDRESS_PARTS.map((k) => data[k])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .join(', ');
  return { ...data, address: composed || null };
}

/**
 * Everything a provider write needs before it reaches the table: the type
 * stored (a new one joins the shared list), the address composed, and the
 * practice resolved. Shared by every route that saves a provider.
 */
export async function providerWriteColumns(
  accountId: string,
  data: Record<string, unknown>,
  selfId?: string
): Promise<{ columns: Record<string, unknown>; note: string | null }> {
  const { own, practice } = splitPracticeInput(data);
  if (typeof own['provider_type'] === 'string') own['provider_type'] = await storeProviderType(own['provider_type'] as string, accountId);
  const composed = withComposedAddress(own);
  const { columns, note } = await practiceColumns(accountId, practice, composed, selfId);
  return { columns: { ...composed, ...columns }, note };
}

const linkSchema = z.object({
  poa_type: z.enum(['enduring', 'medical', 'financial', 'guardianship']).optional().nullable(),
  poa_activated: z.boolean().optional(),
});

function selectLinked(profileId: string, providerId: string) {
  return db('care_profile_providers as cpp')
    .join('providers as p', 'cpp.provider_id', 'p.id')
    .where({ 'cpp.care_profile_id': profileId, 'cpp.provider_id': providerId })
    .select(...PROVIDER_COLS)
    .first();
}

providersRouter.get('/', requireAuth, async (req, res) => {
  const rows = await db('care_profile_providers as cpp')
    .join('providers as p', 'cpp.provider_id', 'p.id')
    .where({ 'cpp.care_profile_id': req.params['id'] })
    .select(...PROVIDER_COLS)
    .orderBy('p.name', 'asc');
  res.json({ providers: rows });
});

providersRouter.post('/', requireAuth, async (req, res) => {
  const { provider_id, ...rest } = req.body;
  const profileId = req.params['id'] as string;

  if (provider_id) {
    const existing = await db<Provider>('providers')
      .where({ id: provider_id, account_id: req.account!.id })
      .first();
    if (!existing) {
      res.status(404).json({ error: 'Provider not found in this account', code: 'NOT_FOUND' });
      return;
    }
    const linkParsed = linkSchema.safeParse(rest);
    const linkData = linkParsed.success ? linkParsed.data : {};
    try {
      await db<CareProfileProvider>('care_profile_providers').insert({
        care_profile_id: profileId,
        provider_id,
        poa_type: linkData.poa_type ?? null,
        poa_activated: linkData.poa_activated ?? false,
      });
    } catch (err: any) {
      if (err.code === '23505') {
        res.status(409).json({ error: 'Provider already linked to this profile', code: 'ALREADY_LINKED' });
        return;
      }
      throw err;
    }
    res.status(201).json({ provider: await selectLinked(profileId, provider_id) });
    return;
  }

  const parsed = providerSchema.safeParse(rest);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const linkParsed = linkSchema.safeParse(rest);
  const linkData = linkParsed.success ? linkParsed.data : {};

  const { columns, note } = await providerWriteColumns(req.account!.id, parsed.data);
  const [provider] = await db<Provider>('providers')
    .insert({ account_id: req.account!.id, ...columns })
    .returning('*');

  await db<CareProfileProvider>('care_profile_providers').insert({
    care_profile_id: profileId,
    provider_id: provider.id,
    poa_type: linkData.poa_type ?? null,
    poa_activated: linkData.poa_activated ?? false,
  });

  res.status(201).json({ provider: await selectLinked(profileId, provider.id), note });
});

providersRouter.patch('/:providerId', requireAuth, async (req, res) => {
  const providerParsed = providerSchema.partial().safeParse(req.body);
  const linkParsed = linkSchema.safeParse(req.body);

  if (!providerParsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const link = await db<CareProfileProvider>('care_profile_providers')
    .where({ care_profile_id: req.params['id'], provider_id: req.params['providerId'] })
    .first();
  if (!link) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }
  const current = await db<Provider>('providers').where({ id: req.params['providerId'] }).first();
  if (!current) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }

  const { columns, note } = await providerWriteColumns(current.account_id, providerParsed.data, current.id);
  if (Object.keys(columns).length > 0) {
    await db<Provider>('providers').where({ id: current.id }).update(columns);
    // Anyone who works here follows a rename or a move.
    await syncPracticeMembers(current.id);
  }

  if (linkParsed.success) {
    const linkUpdates: Record<string, unknown> = {};
    if (linkParsed.data.poa_type !== undefined) linkUpdates.poa_type = linkParsed.data.poa_type;
    if (linkParsed.data.poa_activated !== undefined) linkUpdates.poa_activated = linkParsed.data.poa_activated;
    if (Object.keys(linkUpdates).length > 0) {
      await db<CareProfileProvider>('care_profile_providers')
        .where({ id: link.id })
        .update(linkUpdates);
    }
  }

  res.json({ provider: await selectLinked(req.params['id'] as string, current.id), note });
});

providersRouter.delete('/:providerId', requireAuth, async (req, res) => {
  const affected = await db('care_profile_providers')
    .where({ care_profile_id: req.params['id'], provider_id: req.params['providerId'] })
    .delete();
  if (!affected) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Provider unlinked from this profile.' });
});

// ── People who work at a practice, from the practice's side ─────────────

/** The practice, if it is linked to this profile. */
async function linkedPractice(profileId: string, providerId: string): Promise<Provider | undefined> {
  return db('care_profile_providers as cpp')
    .join('providers as p', 'cpp.provider_id', 'p.id')
    .where({ 'cpp.care_profile_id': profileId, 'cpp.provider_id': providerId })
    .select('p.*')
    .first();
}

providersRouter.get('/:providerId/members', requireAuth, async (req, res) => {
  const practice = await linkedPractice(req.params['id'] as string, req.params['providerId'] as string);
  if (!practice) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ members: await practiceMembers(practice.id) });
});

const memberSchema = z.union([
  z.object({ provider_id: z.string().uuid() }),
  z.object({
    name: z.string().min(1).max(255),
    provider_type: z.string().max(100).optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    email: z.string().max(255).optional().nullable(),
    // On a person's page, someone added at their practice is almost always
    // someone they see, so they are linked to the person too unless told not to.
    link_to_profile: z.boolean().optional(),
  }),
]);

providersRouter.post('/:providerId/members', requireAuth, async (req, res) => {
  const profileId = req.params['id'] as string;
  const practice = await linkedPractice(profileId, req.params['providerId'] as string);
  if (!practice) {
    res.status(404).json({ error: 'Provider not found', code: 'NOT_FOUND' });
    return;
  }
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  let outcome: string;
  if ('provider_id' in parsed.data) {
    const result = await attachMemberById(practice.id, parsed.data.provider_id);
    if (!result) {
      res.status(404).json({ error: 'Provider not found in this account', code: 'NOT_FOUND' });
      return;
    }
    outcome = result;
  } else {
    const { link_to_profile, name, ...details } = parsed.data;
    const added = await addPracticeMember(practice.account_id, name, practice.name, details);
    outcome = added.outcome;
    if (link_to_profile !== false) {
      await db('care_profile_providers')
        .insert({ care_profile_id: profileId, provider_id: added.practitionerId })
        .onConflict(['care_profile_id', 'provider_id'])
        .ignore();
    }
  }
  res.status(201).json({ message: outcome, members: await practiceMembers(practice.id) });
});

providersRouter.delete('/:providerId/members/:memberId', requireAuth, async (req, res) => {
  const practice = await linkedPractice(req.params['id'] as string, req.params['providerId'] as string);
  if (!practice || !(await removePracticeMember(practice.id, req.params['memberId'] as string))) {
    res.status(404).json({ error: 'That person is not filed at this practice.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Removed from this practice.', members: await practiceMembers(practice.id) });
});

/** Account-level provider search for the "link existing" picker. */
export const providerSearchRouter = Router();

providerSearchRouter.get('/', requireAuth, async (req, res) => {
  const q = (req.query.q as string || '').trim();
  const profileId = req.query.profile_id as string | undefined;

  let query = db<Provider>('providers')
    .where({ account_id: req.account!.id })
    .orderBy('name', 'asc')
    .limit(50);

  if (q) {
    query = query.where((qb) => {
      qb.whereRaw('name ilike ?', [`%${q}%`])
        .orWhereRaw('organisation ilike ?', [`%${q}%`])
        .orWhereRaw("array_to_string(also_known_as, ' ') ilike ?", [`%${q}%`]);
    });
  }

  let providers = await query;
  // Also offer close names, so "Health Hub Doctors Morayfield" turns up
  // "Health Hub Morayfield" before anyone files it twice.
  if (q && q.split(/\s+/).length >= 2) {
    const seen = new Set(providers.map((p) => p.id));
    const others = await db<Provider>('providers').where({ account_id: req.account!.id }).limit(2000);
    const close = others.filter(
      (p) => !seen.has(p.id) && [p.name, ...((p as unknown as { also_known_as?: string[] }).also_known_as ?? [])].some((n) => similarName(n, q))
    );
    providers = [...close, ...providers].slice(0, 50);
  }

  if (profileId) {
    const linked = await db('care_profile_providers')
      .where({ care_profile_id: profileId })
      .select('provider_id');
    const linkedIds = new Set(linked.map((r) => r.provider_id));
    res.json({ providers: providers.map((p) => ({ ...p, linked: linkedIds.has(p.id) })) });
    return;
  }

  res.json({ providers });
});
