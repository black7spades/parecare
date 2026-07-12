import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { roleAtLeast } from '../middleware/requireRole';
import type { Provider, ProfileKind } from '../types';

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
      'cp.contact_name', 'cp.contact_phone', 'cp.contact_email',
      'cp.owner_relationship',
      ...(kind === 'pet' ? ['cp.species', 'cp.breed', 'cp.desexed', 'cp.microchip_number'] as const : []),
    ];

    let query = db('care_profiles as cp')
      .select(
        ...columns,
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

    const profiles = await query;
    const canEdit = roleAtLeast(account.role, 'admin');
    res.json({ profiles, can_edit: canEdit });
  };
}

directoryRouter.get('/people', requireAuth, profilesEndpoint('person'));
directoryRouter.get('/pets', requireAuth, profilesEndpoint('pet'));

const providerSchema = z.object({
  provider_type: z.enum([
    'gp', 'specialist', 'pharmacy', 'care_facility', 'allied_health',
    'legal', 'financial', 'social_worker', 'other',
  ]),
  name: z.string().min(1).max(255),
  organisation: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
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
    .insert({ account_id: account.id, ...parsed.data })
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

  const [provider] = await query.update(parsed.data).returning('*');
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
