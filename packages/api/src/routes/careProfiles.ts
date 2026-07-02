import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireCountBelow } from '../middleware/subscriptionGate';
import { PHASE_CHECKLISTS } from '../db/seeds/001_checklist_templates';
import type { CareProfile, CarePhase } from '../types';

export const careProfilesRouter = Router();

// Reject malformed ids up front — postgres errors on invalid uuid input,
// which would surface as a 500 instead of a 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
careProfilesRouter.param('id', (_req, res, next, value) => {
  if (!UUID_RE.test(value)) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }
  next();
});

const profileSchema = z.object({
  full_name: z.string().min(1).max(255),
  date_of_birth: z.string().optional().nullable(),
  current_phase: z
    .enum([
      'early_concern',
      'home_with_support',
      'increased_dependency',
      'transition_to_residential',
      'residential_ongoing',
      'end_of_life',
    ])
    .default('early_concern'),
  preferred_name: z.string().max(100).optional().nullable(),
  pronouns: z.string().max(50).optional().nullable(),
  primary_language: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
});

careProfilesRouter.get('/', requireAuth, async (req, res) => {
  const profiles = await db<CareProfile>('care_profiles')
    .where({ account_id: req.account!.id, archived: false })
    .orderBy('created_at', 'asc');
  res.json({ profiles });
});

careProfilesRouter.post(
  '/',
  requireAuth,
  requireCountBelow('care_profiles', async (req) => {
    const result = await db('care_profiles')
      .where({ account_id: req.account!.id, archived: false })
      .count('id as count')
      .first();
    return Number(result?.count ?? 0);
  }),
  async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      return;
    }

    const [profile] = await db<CareProfile>('care_profiles')
      .insert({ ...parsed.data, account_id: req.account!.id })
      .returning('*');

    // Seed checklists for the initial phase
    const phase = profile.current_phase as CarePhase;
    const templates = PHASE_CHECKLISTS[phase] ?? [];
    if (templates.length > 0) {
      await db('checklist_items').insert(
        templates.map((t, i) => ({
          care_profile_id: profile.id,
          phase,
          title: t.title,
          description: t.description,
          sort_order: i,
        }))
      );
    }

    res.status(201).json({ profile });
  }
);

careProfilesRouter.get('/:id', requireAuth, async (req, res) => {
  const profile = await db<CareProfile>('care_profiles')
    .where({ id: req.params['id'], account_id: req.account!.id })
    .first();
  if (!profile) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ profile });
});

const updateProfileSchema = profileSchema.partial();

careProfilesRouter.patch('/:id', requireAuth, async (req, res) => {
  const profile = await db<CareProfile>('care_profiles')
    .where({ id: req.params['id'], account_id: req.account!.id })
    .first();
  if (!profile) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const [updated] = await db<CareProfile>('care_profiles')
    .where({ id: req.params['id'] })
    .update({ ...parsed.data, updated_at: db.fn.now() })
    .returning('*');

  res.json({ profile: updated });
});

careProfilesRouter.delete('/:id', requireAuth, async (req, res) => {
  const affected = await db('care_profiles')
    .where({ id: req.params['id'], account_id: req.account!.id })
    .update({ archived: true, updated_at: db.fn.now() });

  if (!affected) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ message: 'Profile archived.' });
});

careProfilesRouter.patch('/:id/phase', requireAuth, async (req, res) => {
  const phaseSchema = z.object({
    current_phase: z.enum([
      'early_concern',
      'home_with_support',
      'increased_dependency',
      'transition_to_residential',
      'residential_ongoing',
      'end_of_life',
    ]),
  });
  const parsed = phaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid phase', code: 'VALIDATION_ERROR' });
    return;
  }

  const profile = await db<CareProfile>('care_profiles')
    .where({ id: req.params['id'], account_id: req.account!.id })
    .first();
  if (!profile) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }

  const newPhase = parsed.data.current_phase;
  await db('care_profiles')
    .where({ id: req.params['id'] })
    .update({ current_phase: newPhase, updated_at: db.fn.now() });

  // Seed checklists for the new phase if none exist
  const existing = await db('checklist_items')
    .where({ care_profile_id: req.params['id'], phase: newPhase })
    .count('id as count')
    .first();
  if (Number(existing?.count ?? 0) === 0) {
    const templates = PHASE_CHECKLISTS[newPhase] ?? [];
    if (templates.length > 0) {
      await db('checklist_items').insert(
        templates.map((t, i) => ({
          care_profile_id: req.params['id'],
          phase: newPhase,
          title: t.title,
          description: t.description,
          sort_order: i,
        }))
      );
    }
  }

  res.json({ message: 'Phase updated.' });
});
