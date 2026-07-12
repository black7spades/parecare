import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { db } from '../config/database';
import { getStorageConfig } from '../config/settings';
import { requireAuth } from '../middleware/auth';
import { requireAccountRight } from '../middleware/accountRights';
import { requireCountBelow } from '../middleware/subscriptionGate';
import { uploadFile, deleteFile, getDownloadUrl } from '../services/storage';
import {
  enrolProfileInTemplate,
  findLegacyJourney,
  phaseState,
  setCurrentJourneyPhase,
  type JourneyPhaseRow,
} from '../services/journeys';
import type { CareProfile, CarePhase } from '../types';

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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

/**
 * Who can edit a care profile (its details and photo): platform admins and
 * super admins (global), the owner who created it, and any circle member
 * granted the transferable edit right.
 */
async function editProfileAccess(
  profile: CareProfile,
  account: { id: string; role: string }
): Promise<'owner' | 'admin' | 'granted' | null> {
  if (account.role === 'super_admin' || account.role === 'admin') return 'admin';
  if (profile.account_id === account.id) return 'owner';
  const member = await db('care_circle_members')
    .where({ care_profile_id: profile.id, account_id: account.id, invite_accepted: true })
    .first();
  if (member?.can_edit_profile) return 'granted';
  return null;
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

// Every name part is its own field; full_name is the composed display name.
// full_name alone is still accepted (imports, older clients) and is split
// into parts on the way in.
const nameParts = {
  title: z.string().max(50).optional().nullable(),
  first_name: z.string().max(100).optional().nullable(),
  middle_name: z.string().max(100).optional().nullable(),
  last_name: z.string().max(100).optional().nullable(),
  suffix: z.string().max(50).optional().nullable(),
};

type NameParts = {
  title: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  suffix: string | null;
};

function splitFullName(full: string): Pick<NameParts, 'first_name' | 'middle_name' | 'last_name'> {
  const words = full.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: words[0] ?? null,
    middle_name: words.length > 2 ? words.slice(1, -1).join(' ') : null,
    last_name: words.length > 1 ? words[words.length - 1] : null,
  };
}

function composeDisplayName(parts: NameParts): string {
  return [parts.title, parts.first_name, parts.middle_name, parts.last_name, parts.suffix]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

const blankToNull = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

const profileSchema = z.object({
  kind: z.enum(['person', 'pet']).default('person'),
  full_name: z.string().min(1).max(255).optional(),
  ...nameParts,
  // Pet-only structured facts, each its own field.
  species: z.string().max(60).optional().nullable(),
  breed: z.string().max(120).optional().nullable(),
  desexed: z.boolean().optional(),
  microchip_number: z.string().max(60).optional().nullable(),
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
  photo_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  // Expected babies get a profile before birth.
  due_date: z.string().optional().nullable(),
  // Who to contact about this person: themselves, an existing platform user,
  // or a new contact. Each fact is its own field.
  contact_kind: z.enum(['self', 'user', 'contact']).optional().nullable(),
  contact_account_id: z.string().uuid().optional().nullable(),
  contact_name: z.string().max(255).optional().nullable(),
  contact_relationship: z.string().max(100).optional().nullable(),
  contact_phone: z.string().max(50).optional().nullable(),
  contact_phone_type: z.enum(['home', 'mobile']).optional().nullable(),
  contact_email: z.string().email().optional().nullable(),
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

/**
 * Platform users this account already knows, to pick as a profile's
 * contact. That is anyone in the care circle of a profile they own, and
 * the owner of any profile shared with them: people they are genuinely
 * connected to, never the whole user table.
 */
careProfilesRouter.get('/contactable-users', requireAuth, async (req, res) => {
  const accountId = req.account!.id;
  const rows = await db('accounts')
    .whereNot('accounts.id', accountId)
    .where((qb) => {
      qb.whereIn(
        'accounts.id',
        db('care_circle_members')
          .join('care_profiles', 'care_profiles.id', 'care_circle_members.care_profile_id')
          .where('care_profiles.account_id', accountId)
          .whereNotNull('care_circle_members.account_id')
          .select('care_circle_members.account_id')
      ).orWhereIn(
        'accounts.id',
        db('care_profiles')
          .join('care_circle_members', 'care_profiles.id', 'care_circle_members.care_profile_id')
          .where('care_circle_members.account_id', accountId)
          .where('care_circle_members.invite_accepted', true)
          .select('care_profiles.account_id')
      );
    })
    .distinct('accounts.id', 'accounts.display_name', 'accounts.email')
    .orderBy('accounts.display_name', 'asc');
  res.json({ users: rows });
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

  const [pins, plans, gpProviders, poa, activity, events, journeyRows] = await Promise.all([
    db('care_profile_pins').where({ account_id: accountId }).whereIn('care_profile_id', ids).select('care_profile_id'),
    db('care_plans').whereIn('care_profile_id', ids).select('care_profile_id', 'emergency_contacts'),
    // The GP lives in providers; their phone backs up the named contact's.
    db('care_profile_providers as cpp')
      .join('providers as p', 'cpp.provider_id', 'p.id')
      .whereIn('cpp.care_profile_id', ids)
      .where({ 'p.provider_type': 'gp' })
      .whereNotNull('p.phone')
      .select('cpp.care_profile_id', 'p.phone'),
    // Power of attorney can be held by a person in the care circle or by an
    // organisation in the providers list (e.g. a law firm). Gather both.
    Promise.all([
      db('care_circle_members')
        .whereIn('care_profile_id', ids)
        .whereNotNull('poa_type')
        .select('care_profile_id', 'display_name', 'poa_type', 'poa_activated'),
      db('care_profile_providers as cpp')
        .join('providers as p', 'cpp.provider_id', 'p.id')
        .whereIn('cpp.care_profile_id', ids)
        .whereNotNull('cpp.poa_type')
        .select('cpp.care_profile_id', 'p.name as display_name', 'cpp.poa_type', 'cpp.poa_activated'),
    ]).then(([members, orgs]) => [...members, ...orgs]),
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
    // Active journeys with their current phase, for dashboard sort/filter.
    db.raw(
      `SELECT j.care_profile_id, j.id, j.name, p.name AS phase_name, p.sort_order AS phase_sort_order
       FROM care_journeys j
       LEFT JOIN care_journey_phases p
         ON p.care_journey_id = j.id AND p.entered_at IS NOT NULL AND p.locked_at IS NULL
       WHERE j.care_profile_id = ANY(?) AND j.status = 'active'
       ORDER BY j.started_at ASC`,
      [ids]
    ),
  ]);

  // For profiles whose contact is an existing user, pull that user's email.
  const contactAccountIds = [
    ...new Set(profiles.map((p) => (p as CareProfile).contact_account_id).filter((v): v is string => !!v)),
  ];
  const contactAccounts = contactAccountIds.length
    ? await db('accounts').whereIn('id', contactAccountIds).select('id', 'display_name', 'email')
    : [];
  const contactAccountMap = new Map(contactAccounts.map((a) => [a.id, a]));

  const pinSet = new Set(pins.map((p: { care_profile_id: string }) => p.care_profile_id));
  const planMap = new Map(plans.map((p: { care_profile_id: string }) => [p.care_profile_id, p]));
  const gpPhoneMap = new Map<string, string>();
  for (const g of gpProviders as Array<{ care_profile_id: string; phone: string }>) {
    if (!gpPhoneMap.has(g.care_profile_id)) gpPhoneMap.set(g.care_profile_id, g.phone);
  }
  const poaMap = new Map<string, Array<Record<string, unknown>>>();
  for (const m of poa as Array<{ care_profile_id: string }>) {
    const arr = poaMap.get(m.care_profile_id) ?? [];
    arr.push(m);
    poaMap.set(m.care_profile_id, arr);
  }
  const actMap = new Map((activity.rows as Array<{ care_profile_id: string }>).map((r) => [r.care_profile_id, r]));
  const evMap = new Map((events.rows as Array<{ care_profile_id: string }>).map((r) => [r.care_profile_id, r]));
  const journeyMap = new Map<string, Array<Record<string, unknown>>>();
  for (const j of journeyRows.rows as Array<{ care_profile_id: string; id: string; name: string; phase_name: string | null; phase_sort_order: number | null }>) {
    const arr = journeyMap.get(j.care_profile_id) ?? [];
    arr.push({ id: j.id, name: j.name, phase_name: j.phase_name, phase_sort_order: j.phase_sort_order });
    journeyMap.set(j.care_profile_id, arr);
  }

  const result = profiles.map((p) => {
    const plan = planMap.get(p.id) as { emergency_contacts?: unknown } | undefined;
    const contacts = Array.isArray(plan?.emergency_contacts) ? (plan!.emergency_contacts as Array<{ phone?: string }>) : [];
    // The named contact leads; a linked user supplies their email; the GP
    // and emergency contact remain the fallback for a phone.
    const cp = p as CareProfile;
    const linked = cp.contact_account_id ? contactAccountMap.get(cp.contact_account_id) : undefined;
    const primaryPhone = cp.contact_phone || gpPhoneMap.get(p.id) || contacts[0]?.phone || null;
    const primaryEmail = cp.contact_email || linked?.email || null;
    const contactName =
      cp.contact_kind === 'self'
        ? p.full_name
        : cp.contact_kind === 'user'
          ? linked?.display_name ?? null
          : cp.contact_name ?? null;
    return {
      id: p.id,
      kind: p.kind,
      full_name: p.full_name,
      preferred_name: p.preferred_name,
      relationship: p.relationship,
      access: p.access,
      current_phase: p.current_phase,
      species: p.species,
      breed: p.breed,
      photo_url: p.photo_url,
      photo_color: p.photo_color,
      date_of_birth: p.date_of_birth,
      pinned: pinSet.has(p.id),
      contact_name: contactName,
      contact_relationship: cp.contact_relationship ?? null,
      primary_email: primaryEmail,
      primary_phone: primaryPhone,
      poa_holders: (poaMap.get(p.id) ?? []).map((m) => ({
        display_name: m['display_name'],
        poa_type: m['poa_type'],
        poa_activated: m['poa_activated'],
      })),
      last_activity: actMap.get(p.id) ?? null,
      next_event: evMap.get(p.id) ?? null,
      journeys: journeyMap.get(p.id) ?? [],
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
    .select('care_profiles.id', 'care_profiles.full_name', 'care_profiles.preferred_name', 'care_profiles.photo_url', 'care_profiles.photo_color');
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

// Care-recipient photo. Upload/remove need edit access; serving needs any access.
careProfilesRouter.post('/:id/photo', requireAuth, photoUpload.single('photo'), async (req, res) => {
  const profile = await db<CareProfile>('care_profiles').where({ id: req.params['id'], archived: false }).first();
  if (!profile || !(await editProfileAccess(profile, req.account!))) {
    res.status(profile ? 403 : 404).json({ error: profile ? 'Not allowed' : 'Care profile not found', code: profile ? 'FORBIDDEN' : 'NOT_FOUND' });
    return;
  }
  if (!req.file || !req.file.mimetype.startsWith('image/')) {
    res.status(400).json({ error: 'A valid image is required', code: 'VALIDATION_ERROR' });
    return;
  }
  if (profile.photo_url) await deleteFile(profile.photo_url).catch(() => {});
  const ext = path.extname(req.file.originalname) || '.jpg';
  const key = `care-photo/${profile.id}/${Date.now()}${ext}`;
  const photo_url = await uploadFile(req.file.buffer, key, req.file.mimetype);
  await db('care_profiles').where({ id: profile.id }).update({ photo_url, updated_at: db.fn.now() });
  res.json({ photo_url });
});

careProfilesRouter.delete('/:id/photo', requireAuth, async (req, res) => {
  const profile = await db<CareProfile>('care_profiles').where({ id: req.params['id'], archived: false }).first();
  if (!profile || !(await editProfileAccess(profile, req.account!))) {
    res.status(profile ? 403 : 404).json({ error: profile ? 'Not allowed' : 'Care profile not found', code: profile ? 'FORBIDDEN' : 'NOT_FOUND' });
    return;
  }
  if (profile.photo_url) await deleteFile(profile.photo_url).catch(() => {});
  await db('care_profiles').where({ id: profile.id }).update({ photo_url: null, updated_at: db.fn.now() });
  res.json({ message: 'Photo removed.' });
});

careProfilesRouter.get('/:id/photo', requireAuth, async (req, res) => {
  if (!(await canAccessProfile(req.params['id'], req.account!.id)) && req.account!.role !== 'admin' && req.account!.role !== 'super_admin') {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }
  const profile = await db<CareProfile>('care_profiles').where({ id: req.params['id'] }).first();
  if (!profile?.photo_url) {
    res.status(404).json({ error: 'No photo', code: 'NOT_FOUND' });
    return;
  }
  if (!profile.photo_url.startsWith('/uploads/')) {
    res.redirect(await getDownloadUrl(profile.photo_url));
    return;
  }
  const localPath = path.join(getStorageConfig().localPath, profile.photo_url.slice('/uploads/'.length));
  res.sendFile(localPath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Photo missing from storage', code: 'NOT_FOUND' });
  });
});

careProfilesRouter.post(
  '/',
  requireAuth,
  // Creating a person in care is an explicit account right. Invited helpers
  // do not have it unless an admin grants it; platform admins always do.
  requireAccountRight('can_create_care_profiles'),
  requireCountBelow('care_profiles', async (req) => {
    const result = await db('care_profiles')
      .where({ account_id: req.account!.id, archived: false })
      .count('id as count')
      .first();
    return Number(result?.count ?? 0);
  }),
  async (req, res) => {
    // Journeys to enrol the new person in, chosen from the library.
    const enrolSchema = z.object({ journey_template_ids: z.array(z.string().uuid()).optional() });
    const enrolParsed = enrolSchema.safeParse(req.body);
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success || !enrolParsed.success) {
      res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.success ? undefined : parsed.error.flatten() });
      return;
    }

    const parts: NameParts = {
      title: blankToNull(parsed.data.title),
      first_name: blankToNull(parsed.data.first_name),
      middle_name: blankToNull(parsed.data.middle_name),
      last_name: blankToNull(parsed.data.last_name),
      suffix: blankToNull(parsed.data.suffix),
    };
    if (!parts.first_name) {
      const legacyFull = blankToNull(parsed.data.full_name);
      if (!legacyFull) {
        res.status(400).json({ error: 'A first name is required', code: 'VALIDATION_ERROR' });
        return;
      }
      Object.assign(parts, splitFullName(legacyFull));
    }

    const [profile] = await db<CareProfile>('care_profiles')
      .insert({ ...parsed.data, ...parts, full_name: composeDisplayName(parts), account_id: req.account!.id })
      .returning('*');

    // Enrol in the chosen journeys; without a choice, a client that sent
    // a legacy phase gets the ageing journey opened at that phase.
    await db.transaction(async (trx) => {
      const chosen = enrolParsed.data.journey_template_ids;
      if (chosen && chosen.length > 0) {
        for (const templateId of chosen) {
          const template = await trx('journey_templates').where({ id: templateId, status: 'published' }).first();
          if (template) {
            await enrolProfileInTemplate(trx, {
              careProfileId: profile.id,
              templateId,
              createdByAccountId: req.account!.id,
            });
          }
        }
      } else if (chosen === undefined && profile.kind !== 'pet') {
        // Legacy client that knows nothing of journeys: preserve the old
        // behaviour by opening the ageing journey at the given phase. Pets
        // never belong in the human ageing journey.
        const ageing = await trx('journey_templates').where({ slug: 'more-help-at-home' }).first();
        if (ageing) {
          const phases = await trx('journey_template_phases')
            .where({ template_id: ageing.id })
            .orderBy('sort_order', 'asc');
          const startAt = phases.findIndex((p) => p.legacy_phase === profile.current_phase);
          await enrolProfileInTemplate(trx, {
            careProfileId: profile.id,
            templateId: ageing.id,
            createdByAccountId: req.account!.id,
            startAtSortOrder: Math.max(0, startAt),
          });
        }
      }
    });

    res.status(201).json({ profile });
  }
);

careProfilesRouter.get('/:id', requireAuth, async (req, res) => {
  const profile = await db<CareProfile>('care_profiles')
    .where({ id: req.params['id'], archived: false })
    .first();
  if (!profile) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }
  const account = req.account!;
  const phaseHistory = await db('care_phase_history')
    .where({ care_profile_id: profile.id })
    .select('phase', 'entered_at', 'locked_at');

  const isAdmin = account.role === 'super_admin' || account.role === 'admin';
  const isOwner = profile.account_id === account.id;
  let access: 'owner' | 'admin' | 'contributor' | 'viewer';
  let relationship: string | null;
  let membershipCanEdit = false;

  if (isOwner) {
    access = 'owner';
    relationship = profile.owner_relationship ?? null;
  } else {
    const membership = await db('care_circle_members')
      .where({ care_profile_id: profile.id, account_id: account.id, invite_accepted: true })
      .first();
    if (membership) {
      access = membership.permission === 'viewer' ? 'viewer' : 'contributor';
      relationship = membership.relationship ?? null;
      membershipCanEdit = !!membership.can_edit_profile;
    } else if (isAdmin) {
      access = 'admin';
      relationship = null;
    } else {
      res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
      return;
    }
  }

  const canEditProfile = isAdmin || isOwner || membershipCanEdit;
  const canManageEditors = isAdmin || isOwner;

  // When the contact is an existing platform user, resolve their name and
  // email so the overview can show who to reach without another lookup.
  let contactAccount: { display_name: string; email: string } | undefined;
  if (profile.contact_kind === 'user' && profile.contact_account_id) {
    contactAccount = await db('accounts')
      .where({ id: profile.contact_account_id })
      .select('display_name', 'email')
      .first();
  }

  res.json({
    profile: {
      ...profile,
      contact_account_name: contactAccount?.display_name ?? null,
      contact_account_email: contactAccount?.email ?? null,
    },
    access,
    relationship,
    phase_history: phaseHistory,
    can_edit_profile: canEditProfile,
    can_manage_editors: canManageEditors,
  });
});

const updateProfileSchema = profileSchema.partial();

careProfilesRouter.patch('/:id', requireAuth, async (req, res) => {
  const profile = await db<CareProfile>('care_profiles').where({ id: req.params['id'], archived: false }).first();
  if (!profile) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }
  const editAccess = await editProfileAccess(profile, req.account!);
  if (!editAccess) {
    res.status(403).json({ error: 'You do not have permission to edit this profile', code: 'FORBIDDEN' });
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }

  const update: Record<string, unknown> = { ...parsed.data };
  const partKeys = ['title', 'first_name', 'middle_name', 'last_name', 'suffix'] as const;
  const touchesParts = partKeys.some((k) => k in parsed.data);
  if (touchesParts) {
    const merged: NameParts = {
      title: 'title' in parsed.data ? blankToNull(parsed.data.title) : profile.title,
      first_name: 'first_name' in parsed.data ? blankToNull(parsed.data.first_name) : profile.first_name,
      middle_name: 'middle_name' in parsed.data ? blankToNull(parsed.data.middle_name) : profile.middle_name,
      last_name: 'last_name' in parsed.data ? blankToNull(parsed.data.last_name) : profile.last_name,
      suffix: 'suffix' in parsed.data ? blankToNull(parsed.data.suffix) : profile.suffix,
    };
    if (!merged.first_name) {
      res.status(400).json({ error: 'A first name is required', code: 'VALIDATION_ERROR' });
      return;
    }
    Object.assign(update, merged, { full_name: composeDisplayName(merged) });
  } else if (typeof parsed.data.full_name === 'string' && parsed.data.full_name.trim()) {
    // Older clients that only send full_name keep the parts in sync.
    Object.assign(update, splitFullName(parsed.data.full_name));
  }

  const [updated] = await db<CareProfile>('care_profiles')
    .where({ id: req.params['id'] })
    .update({ ...update, updated_at: db.fn.now() })
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

/**
 * Permanently delete a profile and everything under it. Unlike archiving,
 * this cannot be undone: the row is removed and every child record
 * (journeys, logs, medications, circle, documents and the rest) goes with
 * it through the foreign-key cascades. Owner or platform admin only.
 * Uploaded files are cleaned up first, best effort, since they live in
 * storage rather than the database and would otherwise be orphaned.
 */
careProfilesRouter.delete('/:id/permanent', requireAuth, async (req, res) => {
  const profile = await db<CareProfile>('care_profiles').where({ id: req.params['id'] }).first();
  if (!profile) {
    res.status(404).json({ error: 'Care profile not found', code: 'NOT_FOUND' });
    return;
  }
  const isOwner = profile.account_id === req.account!.id;
  const isAdmin = req.account!.role === 'admin' || req.account!.role === 'super_admin';
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: 'Only the profile owner can permanently delete it', code: 'FORBIDDEN' });
    return;
  }

  if (profile.photo_url) await deleteFile(profile.photo_url).catch(() => {});
  const docs = await db('documents').where({ care_profile_id: profile.id }).select('file_url');
  for (const doc of docs as Array<{ file_url: string }>) {
    if (doc.file_url) await deleteFile(doc.file_url).catch(() => {});
  }

  await db('care_profiles').where({ id: profile.id }).del();
  res.json({ message: 'Profile permanently deleted.' });
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
  if (PHASE_ORDER.indexOf(newPhase) === PHASE_ORDER.indexOf(oldPhase)) {
    res.json({ message: 'No change.' });
    return;
  }

  // The journey system is the source of truth: this legacy endpoint
  // drives the profile's ageing journey, which mirrors itself back onto
  // current_phase and care_phase_history.
  const result = await db.transaction(async (trx) => {
    let journey = await findLegacyJourney(profile.id, trx);
    if (!journey) {
      const ageing = await trx('journey_templates').where({ slug: 'more-help-at-home' }).first();
      if (!ageing) return { ok: false as const, code: 'NOT_FOUND' as const };
      const phases = await trx('journey_template_phases').where({ template_id: ageing.id }).orderBy('sort_order', 'asc');
      const startAt = phases.findIndex((p) => p.legacy_phase === oldPhase);
      journey = await enrolProfileInTemplate(trx, {
        careProfileId: profile.id,
        templateId: ageing.id,
        createdByAccountId: req.account!.id,
        startAtSortOrder: Math.max(0, startAt),
      });
    }
    const journeyPhases: JourneyPhaseRow[] = await trx('care_journey_phases')
      .where({ care_journey_id: journey.id })
      .orderBy('sort_order', 'asc');
    const target = journeyPhases.find((p) => p.legacy_phase === newPhase && phaseState(p) !== 'current');
    if (!target) return { ok: false as const, code: 'NOT_FOUND' as const };
    return setCurrentJourneyPhase(trx, {
      journey,
      targetPhaseId: target.id,
      actorAccountId: req.account!.id,
      actorIsSuperAdmin: req.account!.role === 'super_admin',
    });
  });

  if (!result.ok) {
    if (result.code === 'PHASE_LOCKED') {
      res.status(403).json({
        error: 'Care journeys only move forward. A super admin can unlock an earlier phase to correct records.',
        code: 'PHASE_LOCKED',
      });
    } else {
      res.status(404).json({ error: 'Phase not found', code: 'NOT_FOUND' });
    }
    return;
  }
  res.json({ message: 'Phase updated.' });
});
