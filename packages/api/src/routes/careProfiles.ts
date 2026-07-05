import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireCountBelow } from '../middleware/subscriptionGate';
import { PHASE_CHECKLISTS } from '../db/seeds/001_checklist_templates';
import type { CareProfile, CarePhase } from '../types';

export const careProfilesRouter = Router();

const PHASE_ORDER: CarePhase[] = [
  'early_concern',
  'home_with_support',
  'increased_dependency',
  'transition_to_residential',
  'residential_ongoing',
  'end_of_life',
];

async function canAccessProfile(profileId: string, accountId: string): Promise<boolean> {
  const profile = await db('care_profiles').where({ id: profileId, archived: false }).first();
  if (!profile) return false;
  if (profile.account_id === accountId) return true;
  const member = await db('care_circle_members')
    .where({ care_profile_id: profileId, account_id: accountId, invite_accepted: true })
    .first();
  return !!member;
}

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
  owner_relationship: z.string().max(100).optional().nullable(),
});

careProfilesRouter.get('/', requireAuth, async (req, res) => {
  // Profiles you own, plus profiles shared with you via the care circle
  const [owned, shared] = await Promise.all([
    db<CareProfile>('care_profiles')
      .where({ account_id: req.account!.id, archived: false })
      .orderBy('created_at', 'asc'),
    db<CareProfile>('care_profiles')
      .join('care_circle_members', 'care_profiles.id', 'care_circle_members.care_profile_id')
      .where({
        'care_circle_members.account_id': req.account!.id,
        'care_circle_members.invite_accepted': true,
        'care_profiles.archived': false,
      })
      .whereNot('care_profiles.account_id', req.account!.id)
      .select('care_profiles.*', 'care_circle_members.relationship as viewer_relationship')
      .orderBy('care_profiles.created_at', 'asc'),
  ]);
  res.json({
    profiles: [
      ...owned.map((p) => ({ ...p, access: 'owner', relationship: p.owner_relationship })),
      ...shared.map((p) => ({
        ...p,
        access: 'member',
        relationship: (p as CareProfile & { viewer_relationship: string | null }).viewer_relationship,
      })),
    ],
  });
});

// Glanceable dashboard data: contacts, POA holders, last activity, next event.
careProfilesRouter.get('/summary', requireAuth, async (req, res) => {
  const accountId = req.account!.id;
  const [owned, shared] = await Promise.all([
    db<CareProfile>('care_profiles').where({ account_id: accountId, archived: false }).orderBy('created_at', 'asc'),
    db<CareProfile>('care_profiles')
      .join('care_circle_members', 'care_profiles.id', 'care_circle_members.care_profile_id')
      .where({
        'care_circle_members.account_id': accountId,
        'care_circle_members.invite_accepted': true,
        'care_profiles.archived': false,
      })
      .whereNot('care_profiles.account_id', accountId)
      .select('care_profiles.*', 'care_circle_members.relationship as viewer_relationship')
      .orderBy('care_profiles.created_at', 'asc'),
  ]);

  const profiles = [
    ...owned.map((p) => ({ ...p, access: 'owner' as const, relationship: p.owner_relationship })),
    ...shared.map((p) => ({
      ...p,
      access: 'member' as const,
      relationship: (p as CareProfile & { viewer_relationship: string | null }).viewer_relationship,
    })),
  ];
  const ids = profiles.map((p) => p.id);
  if (ids.length === 0) {
    res.json({ profiles: [] });
    return;
  }

  const [pins, plans, poa, activity, events] = await Promise.all([
    db('care_profile_pins').where({ account_id: accountId }).whereIn('care_profile_id', ids).select('care_profile_id'),
    db('care_plans').whereIn('care_profile_id', ids).select('care_profile_id', 'gp_phone', 'emergency_contacts'),
    db('care_circle_members')
      .whereIn('care_profile_id', ids)
      .whereNotNull('poa_type')
      .select('care_profile_id', 'display_name', 'poa_type', 'poa_activated'),
    db.raw(
      `SELECT DISTINCT ON (a.care_profile_id) a.care_profile_id, a.action, a.entity_type, a.summary, a.created_at,
              acc.display_name as actor_name
       FROM audit_log a LEFT JOIN accounts acc ON acc.id = a.actor_account_id
       WHERE a.care_profile_id = ANY(?) ORDER BY a.care_profile_id, a.created_at DESC`,
      [ids]
    ),
    db.raw(
      `SELECT DISTINCT ON (care_profile_id) care_profile_id, title, next_due_at
       FROM reminders WHERE care_profile_id = ANY(?) AND completed = false AND next_due_at >= now()
       ORDER BY care_profile_id, next_due_at ASC`,
      [ids]
    ),
  ]);

  const pinSet = new Set(pins.map((p: { care_profile_id: string }) => p.care_profile_id));
  const planMap = new Map(plans.map((p: { care_profile_id: string }) => [p.care_profile_id, p]));
  const poaMap = new Map<string, Array<Record<string, unknown>>>();
  for (const m of poa as Array<{ care_profile_id: string }>) {
    const arr = poaMap.get(m.care_profile_id) ?? [];
    arr.push(m);
    poaMap.set(m.care_profile_id, arr);
  }
  const actMap = new Map((activity.rows as Array<{ care_profile_id: string }>).map((r) => [r.care_profile_id, r]));
  const evMap = new Map((events.rows as Array<{ care_profile_id: string }>).map((r) => [r.care_profile_id, r]));

  const result = profiles.map((p) => {
    const plan = planMap.get(p.id) as { gp_phone?: string; emergency_contacts?: unknown } | undefined;
    const contacts = Array.isArray(plan?.emergency_contacts) ? (plan!.emergency_contacts as Array<{ phone?: string }>) : [];
    return {
      id: p.id,
      full_name: p.full_name,
      preferred_name: p.preferred_name,
      relationship: p.relationship,
      access: p.access,
      current_phase: p.current_phase,
      photo_url: p.photo_url,
      date_of_birth: p.date_of_birth,
      pinned: pinSet.has(p.id),
      primary_phone: plan?.gp_phone || contacts[0]?.phone || null,
      poa_holders: (poaMap.get(p.id) ?? []).map((m) => ({
        display_name: m['display_name'],
        poa_type: m['poa_type'],
        poa_activated: m['poa_activated'],
      })),
      last_activity: actMap.get(p.id) ?? null,
      next_event: evMap.get(p.id) ?? null,
    };
  });
  res.json({ profiles: result });
});

// Lightweight pinned list for the left nav.
careProfilesRouter.get('/pinned', requireAuth, async (req, res) => {
  const rows = await db('care_profile_pins')
    .join('care_profiles', 'care_profile_pins.care_profile_id', 'care_profiles.id')
    .where('care_profile_pins.account_id', req.account!.id)
    .andWhere('care_profiles.archived', false)
    .orderBy('care_profile_pins.pinned_at', 'asc')
    .select('care_profiles.id', 'care_profiles.full_name', 'care_profiles.preferred_name', 'care_profiles.photo_url');
  res.json({ profiles: rows });
});

careProfilesRouter.post('/:id/pin', requireAuth, async (req, res) => {
  if (!(await canAccessProfile(req.params['id'], req.account!.id))) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }
  await db('care_profile_pins')
    .insert({ account_id: req.account!.id, care_profile_id: req.params['id'] })
    .onConflict(['account_id', 'care_profile_id'])
    .ignore();
  res.json({ pinned: true });
});

careProfilesRouter.delete('/:id/pin', requireAuth, async (req, res) => {
  await db('care_profile_pins').where({ account_id: req.account!.id, care_profile_id: req.params['id'] }).del();
  res.json({ pinned: false });
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
  // Owners and accepted circle members can view; mutations stay owner-only
  const profile = await db<CareProfile>('care_profiles')
    .where({ id: req.params['id'], archived: false })
    .first();
  if (!profile) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }
  const phaseHistory = await db('care_phase_history')
    .where({ care_profile_id: profile.id })
    .select('phase', 'entered_at', 'locked_at');
  if (profile.account_id !== req.account!.id) {
    const membership = await db('care_circle_members')
      .where({ care_profile_id: profile.id, account_id: req.account!.id, invite_accepted: true })
      .first();
    if (!membership) {
      res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
      return;
    }
    res.json({
      profile,
      access: membership.permission === 'viewer' ? 'viewer' : 'contributor',
      relationship: membership.relationship ?? null,
      phase_history: phaseHistory,
    });
    return;
  }
  res.json({ profile, access: 'owner', relationship: profile.owner_relationship ?? null, phase_history: phaseHistory });
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
  const oldPhase = profile.current_phase as CarePhase;
  const oldIndex = PHASE_ORDER.indexOf(oldPhase);
  const newIndex = PHASE_ORDER.indexOf(newPhase);
  const isSuperAdmin = req.account!.role === 'super_admin';

  if (newIndex === oldIndex) {
    res.json({ message: 'No change.' });
    return;
  }
  // Care journeys only move forward; going back reopens a locked phase and is
  // reserved for super admins correcting records.
  if (newIndex < oldIndex && !isSuperAdmin) {
    res.status(403).json({
      error: 'Care journeys only move forward. A super admin can unlock an earlier phase to correct records.',
      code: 'PHASE_LOCKED',
    });
    return;
  }

  const now = new Date();
  await db.transaction(async (trx) => {
    // Make sure the phase being left has a history row before we lock it.
    await trx('care_phase_history')
      .insert({ care_profile_id: profile.id, phase: oldPhase, entered_at: profile.created_at ?? now })
      .onConflict(['care_profile_id', 'phase'])
      .ignore();

    if (newIndex < oldIndex) {
      // Super-admin unlock: reopen the target phase.
      await trx('care_phase_history')
        .where({ care_profile_id: profile.id, phase: newPhase })
        .update({ locked_at: null, locked_by: null });
    } else {
      // Forward: lock the phase we are leaving, and (re)open the one we enter.
      await trx('care_phase_history')
        .where({ care_profile_id: profile.id, phase: oldPhase })
        .whereNull('locked_at')
        .update({ locked_at: now, locked_by: req.account!.id });
      await trx('care_phase_history')
        .insert({ care_profile_id: profile.id, phase: newPhase, entered_at: now })
        .onConflict(['care_profile_id', 'phase'])
        .ignore();
      await trx('care_phase_history')
        .where({ care_profile_id: profile.id, phase: newPhase })
        .update({ locked_at: null, locked_by: null });
    }

    await trx('care_profiles').where({ id: profile.id }).update({ current_phase: newPhase, updated_at: trx.fn.now() });
  });

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
