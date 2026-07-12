import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import type { Provider, CareProfileProvider } from '../types';

export const providersRouter = Router({ mergeParams: true });

const providerSchema = z.object({
  provider_type: z.enum([
    'gp',
    'specialist',
    'pharmacy',
    'care_facility',
    'allied_health',
    'legal',
    'financial',
    'social_worker',
    'other',
  ]),
  name: z.string().min(1).max(255),
  organisation: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  booking_link: z.string().url().optional().nullable(),
  directions_link: z.string().url().optional().nullable(),
});

const linkSchema = z.object({
  poa_type: z.enum(['enduring', 'medical', 'financial', 'guardianship']).optional().nullable(),
  poa_activated: z.boolean().optional(),
});

providersRouter.get('/', requireAuth, async (req, res) => {
  const rows = await db('care_profile_providers as cpp')
    .join('providers as p', 'cpp.provider_id', 'p.id')
    .where({ 'cpp.care_profile_id': req.params['id'] })
    .select(
      'p.id',
      'p.account_id',
      'p.provider_type',
      'p.name',
      'p.organisation',
      'p.phone',
      'p.email',
      'p.address',
      'p.booking_link',
      'p.directions_link',
      'p.created_at',
      'cpp.poa_type',
      'cpp.poa_activated',
      'cpp.primary_contact_member_id',
    )
    .orderBy('p.name', 'asc');
  res.json({ providers: rows });
});

providersRouter.post('/', requireAuth, async (req, res) => {
  const { provider_id, ...rest } = req.body;

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
        care_profile_id: req.params['id'],
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
    const [row] = await db('care_profile_providers as cpp')
      .join('providers as p', 'cpp.provider_id', 'p.id')
      .where({ 'cpp.care_profile_id': req.params['id'], 'cpp.provider_id': provider_id })
      .select(
        'p.id', 'p.account_id', 'p.provider_type', 'p.name', 'p.organisation',
        'p.phone', 'p.email', 'p.address', 'p.booking_link', 'p.directions_link',
        'p.created_at', 'cpp.poa_type', 'cpp.poa_activated', 'cpp.primary_contact_member_id',
      );
    res.status(201).json({ provider: row });
    return;
  }

  const parsed = providerSchema.safeParse(rest);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const linkParsed = linkSchema.safeParse(rest);
  const linkData = linkParsed.success ? linkParsed.data : {};

  const [provider] = await db<Provider>('providers')
    .insert({ account_id: req.account!.id, ...parsed.data })
    .returning('*');

  await db<CareProfileProvider>('care_profile_providers').insert({
    care_profile_id: req.params['id'],
    provider_id: provider.id,
    poa_type: linkData.poa_type ?? null,
    poa_activated: linkData.poa_activated ?? false,
  });

  const [row] = await db('care_profile_providers as cpp')
    .join('providers as p', 'cpp.provider_id', 'p.id')
    .where({ 'cpp.care_profile_id': req.params['id'], 'cpp.provider_id': provider.id })
    .select(
      'p.id', 'p.account_id', 'p.provider_type', 'p.name', 'p.organisation',
      'p.phone', 'p.email', 'p.address', 'p.booking_link', 'p.directions_link',
      'p.created_at', 'cpp.poa_type', 'cpp.poa_activated', 'cpp.primary_contact_member_id',
    );
  res.status(201).json({ provider: row });
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

  const providerFields = providerParsed.data;
  if (Object.keys(providerFields).length > 0) {
    await db<Provider>('providers')
      .where({ id: req.params['providerId'] })
      .update(providerFields);
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

  const [row] = await db('care_profile_providers as cpp')
    .join('providers as p', 'cpp.provider_id', 'p.id')
    .where({ 'cpp.care_profile_id': req.params['id'], 'cpp.provider_id': req.params['providerId'] })
    .select(
      'p.id', 'p.account_id', 'p.provider_type', 'p.name', 'p.organisation',
      'p.phone', 'p.email', 'p.address', 'p.booking_link', 'p.directions_link',
      'p.created_at', 'cpp.poa_type', 'cpp.poa_activated', 'cpp.primary_contact_member_id',
    );
  res.json({ provider: row });
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
        .orWhereRaw('organisation ilike ?', [`%${q}%`]);
    });
  }

  const providers = await query;

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
