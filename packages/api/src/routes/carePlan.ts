import { Router, type Request } from 'express';
import { createHash } from 'crypto';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { resolveOptions } from './optionCatalogue';
import {
  applyPending,
  approveVersion,
  baselineGaps,
  deleteCarePlan,
  generateBaseline,
  newReviewToken,
  parseContent,
  parseIds,
  pendingEvents,
  rejectVersion,
  revertToVersion,
} from '../services/carePlanUpdater';
import { renderPlanPdf } from '../services/carePlanPdf';
import type { CarePlan } from '../types';

export const carePlanRouter = Router({ mergeParams: true });

/**
 * Two very different things live under /plan:
 *
 * 1. The care-needs record (GET / and PUT /): the only plan-owned data —
 *    day-to-day needs, the advance care directive facts and emergency
 *    contacts. It is COLLECTED on the Care needs page, never on the Care
 *    plan page, which is output only.
 * 2. The versioned care plan document (/versions, /changelog, /access,
 *    …): assembled from the first-class tables by the event-driven
 *    incremental updater, with review, sign-off, signatures and export.
 */

// ---------------------------------------------------------------------------
// The care-needs record (data collection endpoint)

const planSchema = z.object({
  dietary_requirements: z.array(z.string().min(1).max(255)).default([]),
  mobility_aids: z.array(z.string().min(1).max(255)).default([]),
  communication_needs: z.array(z.string().min(1).max(255)).default([]),
  advance_care_directive: z.boolean().default(false),
  advance_care_directive_location: z.string().max(255).optional().nullable(),
  emergency_contacts: z
    .array(
      z.object({
        name: z.string(),
        relationship: z.string().optional(),
        phone: z.string(),
      })
    )
    .default([]),
});

carePlanRouter.get('/', requireAuth, async (req, res) => {
  const plan = await db<CarePlan>('care_plans')
    .where({ care_profile_id: req.params['id'] })
    .orderBy('updated_at', 'desc')
    .first();
  res.json({ plan: plan ?? null });
});

carePlanRouter.put('/', requireAuth, async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const existing = await db('care_plans').where({ care_profile_id: req.params['id'] }).first();

  // dietary_requirements and mobility_aids are text[] columns, which knex
  // maps from plain JS arrays; the jsonb columns need explicit JSON
  // serialisation instead, because knex would treat their raw JS arrays as
  // Postgres array literals and corrupt the stored value.
  const values = {
    advance_care_directive: parsed.data.advance_care_directive,
    advance_care_directive_location: parsed.data.advance_care_directive_location ?? null,
    dietary_requirements: parsed.data.dietary_requirements,
    mobility_aids: parsed.data.mobility_aids,
    communication_needs: db.raw('?::jsonb', [JSON.stringify(parsed.data.communication_needs)]),
    emergency_contacts: db.raw('?::jsonb', [JSON.stringify(parsed.data.emergency_contacts)]),
  };

  let plan: CarePlan;
  if (existing) {
    const [updated] = await db<CarePlan>('care_plans')
      .where({ id: existing.id })
      .update({ ...values, updated_at: db.fn.now() })
      .returning('*');
    plan = updated;
  } else {
    const [created] = await db<CarePlan>('care_plans')
      .insert({ care_profile_id: req.params['id'], ...values })
      .returning('*');
    plan = created;
  }

  // Anything picked that is not in the shared lists yet joins them, so it
  // is offered to everyone from now on.
  await Promise.all([
    resolveOptions('dietary_requirement', parsed.data.dietary_requirements, req.account!.id),
    resolveOptions('mobility_aid', parsed.data.mobility_aids, req.account!.id),
    resolveOptions('communication_need', parsed.data.communication_needs, req.account!.id),
    resolveOptions('directive_location', [parsed.data.advance_care_directive_location], req.account!.id),
  ]);

  res.json({ plan });
});

// ---------------------------------------------------------------------------
// Fine-grained plan permissions

interface PlanPermissions {
  view: boolean;
  comment: boolean;
  edit: boolean;
  sign: boolean;
}

/**
 * An explicit access row for the account wins; otherwise the circle
 * access level decides: owners, platform admins and lead coordinators do
 * everything, contributors can view, comment and trigger updates, and
 * viewers can only read.
 */
async function planPermissions(req: Request): Promise<PlanPermissions> {
  const explicit = await db('care_plan_access')
    .where({ care_profile_id: req.params['id'], account_id: req.account!.id })
    .first();
  if (explicit) {
    return {
      view: !!explicit.can_view,
      comment: !!explicit.can_comment,
      edit: !!explicit.can_edit,
      sign: !!explicit.can_sign,
    };
  }
  const level = req.careAccess?.level;
  if (level === 'owner' || level === 'admin') return { view: true, comment: true, edit: true, sign: true };
  if (level === 'contributor') return { view: true, comment: true, edit: true, sign: false };
  return { view: true, comment: false, edit: false, sign: false };
}

/** Owners, platform admins, and lead coordinators manage plan access. */
async function canManageAccess(req: Request): Promise<boolean> {
  const level = req.careAccess?.level;
  if (level === 'owner' || level === 'admin') return true;
  const explicit = await db('care_plan_access')
    .where({ care_profile_id: req.params['id'], account_id: req.account!.id, access_role: 'lead_coordinator' })
    .first();
  return !!explicit?.can_edit;
}

const forbidden = (res: { status: (n: number) => { json: (b: unknown) => void } }, what: string): void => {
  res.status(403).json({ error: `You do not have permission to ${what} this care plan`, code: 'FORBIDDEN' });
};

/** Every access, change, review and signature lands in the audit trail. */
function logPlanAudit(profileId: string, actorId: string | null, action: string, summary: string): void {
  void db('audit_log')
    .insert({
      care_profile_id: profileId,
      actor_account_id: actorId,
      action,
      entity_type: 'care_plan',
      summary: summary.slice(0, 255),
    })
    .catch((err) => console.warn('Care plan audit write failed:', (err as Error).message));
}

// ---------------------------------------------------------------------------
// Versions

const versionMeta = (
  v: Record<string, unknown> | import('../services/carePlanUpdater').VersionRow,
  extras: { author_name?: string | null; signature_count?: number } = {}
) => ({
  id: v['id'],
  version: v['version'],
  status: v['status'],
  content_hash: v['content_hash'],
  changelog: v['changelog'],
  author_account_id: v['author_account_id'],
  author_name: extras.author_name ?? null,
  applied_event_ids: parseIds(v['applied_event_ids']),
  document_id: v['document_id'],
  restored_from_version: v['restored_from_version'],
  locked: !!v['locked'],
  created_at: v['created_at'],
  published_at: v['published_at'],
  signature_count: extras.signature_count ?? 0,
});

carePlanRouter.get('/versions', requireAuth, async (req, res) => {
  const perms = await planPermissions(req);
  if (!perms.view) {
    forbidden(res, 'view');
    return;
  }
  const versions = await db('care_plan_versions as v')
    .leftJoin('accounts as a', 'v.author_account_id', 'a.id')
    .where({ 'v.care_profile_id': req.params['id'] })
    .orderBy('v.version', 'desc')
    .select('v.*', 'a.display_name as author_name');
  const counts = await db('care_plan_signatures')
    .whereIn('version_id', versions.map((v) => v.id))
    .groupBy('version_id')
    .select('version_id')
    .count('id as count');
  const countByVersion = new Map(counts.map((c) => [c.version_id as string, Number(c.count)]));
  res.json({
    versions: versions.map((v) =>
      versionMeta(v, { author_name: v.author_name, signature_count: countByVersion.get(v.id) ?? 0 })
    ),
    permissions: perms,
  });
});

/**
 * What is waiting to flow into the plan: unprocessed events, whether any
 * version exists yet, whether one is awaiting sign-off, and which
 * baseline facts are still missing for a useful first version.
 */
carePlanRouter.get('/versions/pending', requireAuth, async (req, res) => {
  const perms = await planPermissions(req);
  if (!perms.view) {
    forbidden(res, 'view');
    return;
  }
  const profileId = String(req.params['id']);
  const [events, gaps, latest, awaiting] = await Promise.all([
    pendingEvents(profileId),
    baselineGaps(profileId),
    db('care_plan_versions').where({ care_profile_id: profileId }).orderBy('version', 'desc').first(),
    db('care_plan_versions').where({ care_profile_id: profileId, status: 'awaiting_signoff' }).first(),
  ]);
  res.json({
    pending_events: events.map((e) => ({
      id: e.id,
      source_table: e.source_table,
      action: e.action,
      summary: e.summary,
      created_at: e.created_at,
    })),
    has_versions: !!latest,
    awaiting_signoff: awaiting ? versionMeta(awaiting) : null,
    baseline_gaps: gaps,
  });
});

/**
 * Generate the plan. First run assembles version 1 as the baseline;
 * afterwards it applies only the pending events as a minimal delta —
 * the full document is never regenerated.
 */
carePlanRouter.post('/versions/generate', requireAuth, async (req, res) => {
  const perms = await planPermissions(req);
  if (!perms.edit) {
    forbidden(res, 'update');
    return;
  }
  const profileId = String(req.params['id']);
  const actorId = req.account!.id;
  const existing = await db('care_plan_versions').where({ care_profile_id: profileId }).first();
  if (!existing) {
    const version = await generateBaseline(profileId, actorId);
    logPlanAudit(profileId, actorId, 'created', `Care plan version ${version.version} generated`);
    res.status(201).json({ result: { status: version.status, applied: version.applied_event_ids.length }, version: versionMeta(version) });
    return;
  }
  const result = await applyPending(profileId, actorId);
  if (result.version) {
    logPlanAudit(
      profileId,
      actorId,
      'created',
      `Care plan version ${result.version.version} ${result.status === 'awaiting_signoff' ? 'awaiting sign-off' : 'published'}`
    );
  }
  res.status(result.version ? 201 : 200).json({
    result: { status: result.status, applied: result.applied },
    version: result.version ? versionMeta(result.version) : null,
  });
});

/**
 * The full reset: every version, change, event, signature, review link,
 * access grant and filed plan document is removed. Owner or platform
 * admin only — this is the destructive escape hatch, and the recorded
 * facts themselves are untouched.
 */
carePlanRouter.delete('/versions', requireAuth, async (req, res) => {
  const level = req.careAccess?.level;
  if (level !== 'owner' && level !== 'admin') {
    res.status(403).json({
      error: 'Only the profile owner or an admin can delete the care plan',
      code: 'OWNER_ONLY',
    });
    return;
  }
  const removed = await deleteCarePlan(String(req.params['id']));
  logPlanAudit(
    String(req.params['id']),
    req.account!.id,
    'deleted',
    `Care plan deleted: ${removed} ${removed === 1 ? 'version' : 'versions'} and all plan records removed`
  );
  res.json({ message: 'Care plan deleted.', removed });
});

async function findVersion(req: Request) {
  return db('care_plan_versions')
    .where({ id: req.params['versionId'], care_profile_id: req.params['id'] })
    .first();
}

carePlanRouter.get('/versions/:versionId', requireAuth, async (req, res) => {
  const perms = await planPermissions(req);
  if (!perms.view) {
    forbidden(res, 'view');
    return;
  }
  const version = await findVersion(req);
  if (!version) {
    res.status(404).json({ error: 'Version not found', code: 'NOT_FOUND' });
    return;
  }
  const [changes, signatures, reviews, author] = await Promise.all([
    db('care_plan_changes').where({ version_id: version.id }).orderBy('position', 'asc'),
    db('care_plan_signatures').where({ version_id: version.id }).orderBy('signed_at', 'asc'),
    db('care_plan_reviews').where({ version_id: version.id }).orderBy('created_at', 'desc'),
    version.author_account_id ? db('accounts').where({ id: version.author_account_id }).first() : null,
  ]);
  logPlanAudit(String(req.params['id']), req.account!.id, 'viewed', `Care plan version ${version.version} viewed`);
  res.json({
    version: {
      ...versionMeta(version, { author_name: author?.display_name ?? null, signature_count: signatures.length }),
      content: parseContent(version.content),
    },
    changes: changes.map((c) => ({ ...c, source_event_ids: parseIds(c.source_event_ids) })),
    signatures: signatures.map((s) => ({
      id: s.id,
      signer_account_id: s.signer_account_id,
      signer_name: s.signer_name,
      signed_at: s.signed_at,
      signature_hash: s.signature_hash,
      consent: s.consent,
    })),
    reviews: reviews.map((r) => ({
      id: r.id,
      invited_email: r.invited_email,
      invited_name: r.invited_name,
      can_comment: r.can_comment,
      can_approve: r.can_approve,
      status: r.status,
      comment: r.comment,
      created_at: r.created_at,
      responded_at: r.responded_at,
      expires_at: r.expires_at,
    })),
    permissions: perms,
  });
});

carePlanRouter.post('/versions/:versionId/approve', requireAuth, async (req, res) => {
  const perms = await planPermissions(req);
  if (!perms.sign) {
    forbidden(res, 'approve');
    return;
  }
  const version = await findVersion(req);
  if (!version) {
    res.status(404).json({ error: 'Version not found', code: 'NOT_FOUND' });
    return;
  }
  await approveVersion(version.id, String(req.params['id']));
  logPlanAudit(String(req.params['id']), req.account!.id, 'approved', `Care plan version ${version.version} approved`);
  res.json({ message: 'Version approved and published.' });
});

carePlanRouter.post('/versions/:versionId/reject', requireAuth, async (req, res) => {
  const perms = await planPermissions(req);
  if (!perms.sign) {
    forbidden(res, 'reject');
    return;
  }
  const version = await findVersion(req);
  if (!version) {
    res.status(404).json({ error: 'Version not found', code: 'NOT_FOUND' });
    return;
  }
  await rejectVersion(version.id, String(req.params['id']));
  logPlanAudit(String(req.params['id']), req.account!.id, 'deleted', `Care plan version ${version.version} rejected`);
  res.json({ message: 'Version rejected. Its changes will be offered again on the next update.' });
});

carePlanRouter.post('/versions/:versionId/revert', requireAuth, async (req, res) => {
  const perms = await planPermissions(req);
  if (!perms.edit) {
    forbidden(res, 'change');
    return;
  }
  const target = await findVersion(req);
  if (!target) {
    res.status(404).json({ error: 'Version not found', code: 'NOT_FOUND' });
    return;
  }
  const version = await revertToVersion(String(req.params['id']), target.version, req.account!.id);
  logPlanAudit(
    String(req.params['id']),
    req.account!.id,
    'created',
    `Care plan reverted to version ${target.version} as version ${version.version}`
  );
  res.status(201).json({ version: versionMeta(version) });
});

carePlanRouter.get('/versions/:versionId/export', requireAuth, async (req, res) => {
  const perms = await planPermissions(req);
  if (!perms.view) {
    forbidden(res, 'view');
    return;
  }
  const version = await findVersion(req);
  if (!version) {
    res.status(404).json({ error: 'Version not found', code: 'NOT_FOUND' });
    return;
  }
  const [profile, signatures] = await Promise.all([
    db('care_profiles').where({ id: req.params['id'] }).first(),
    db('care_plan_signatures').where({ version_id: version.id }).orderBy('signed_at', 'asc'),
  ]);
  logPlanAudit(String(req.params['id']), req.account!.id, 'exported', `Care plan version ${version.version} exported to PDF`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="care-plan-v${version.version}.pdf"`);
  const pdf = renderPlanPdf({
    profileName: profile?.full_name ?? 'this person',
    version: version.version,
    status: version.status,
    hash: version.content_hash,
    createdAt: new Date(version.created_at),
    content: parseContent(version.content),
    changelog: version.changelog,
    signatures,
  });
  pdf.pipe(res);
});

const signSchema = z.object({
  signer_name: z.string().min(1).max(255),
  signature_image: z.string().max(500_000).optional().nullable(),
  consent: z.literal(true),
});

/**
 * eSignature on a version: who signed, when, a hash binding the
 * signature to this exact content, the drawn signature if given, and the
 * device and address it came from. Signing locks the version: later
 * automatic updates go to sign-off instead of publishing themselves.
 */
carePlanRouter.post('/versions/:versionId/sign', requireAuth, async (req, res) => {
  const perms = await planPermissions(req);
  if (!perms.sign) {
    forbidden(res, 'sign');
    return;
  }
  const parsed = signSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Signing requires your name and consent', code: 'VALIDATION_ERROR' });
    return;
  }
  const version = await findVersion(req);
  if (!version) {
    res.status(404).json({ error: 'Version not found', code: 'NOT_FOUND' });
    return;
  }
  if (version.status !== 'published') {
    res.status(409).json({ error: 'Only published versions can be signed', code: 'CONFLICT' });
    return;
  }
  const signedAt = new Date();
  const signatureHash = createHash('sha256')
    .update(
      [version.content_hash, req.account!.id, parsed.data.signer_name, signedAt.toISOString(), parsed.data.signature_image ?? ''].join('|')
    )
    .digest('hex');
  const [signature] = await db('care_plan_signatures')
    .insert({
      version_id: version.id,
      signer_account_id: req.account!.id,
      signer_name: parsed.data.signer_name,
      signed_at: signedAt,
      signature_hash: signatureHash,
      signature_image: parsed.data.signature_image ?? null,
      device: (req.headers['user-agent'] ?? '').slice(0, 512) || null,
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null,
      consent: true,
    })
    .returning('*');
  await db('care_plan_versions').where({ id: version.id }).update({ locked: true });
  logPlanAudit(String(req.params['id']), req.account!.id, 'signed', `Care plan version ${version.version} signed by ${parsed.data.signer_name}`);
  res.status(201).json({
    signature: {
      id: signature.id,
      signer_name: signature.signer_name,
      signed_at: signature.signed_at,
      signature_hash: signature.signature_hash,
    },
  });
});

// ---------------------------------------------------------------------------
// Changelog across versions

carePlanRouter.get('/changelog', requireAuth, async (req, res) => {
  const perms = await planPermissions(req);
  if (!perms.view) {
    forbidden(res, 'view');
    return;
  }
  const rows = await db('care_plan_changes as c')
    .join('care_plan_versions as v', 'c.version_id', 'v.id')
    .leftJoin('accounts as a', 'v.author_account_id', 'a.id')
    .where({ 'v.care_profile_id': req.params['id'] })
    .orderBy([
      { column: 'v.version', order: 'desc' },
      { column: 'c.position', order: 'asc' },
    ])
    .limit(500)
    .select(
      'c.id',
      'c.op',
      'c.section',
      'c.entry_key',
      'c.before',
      'c.after',
      'c.source_event_ids',
      'c.created_at',
      'v.version',
      'v.status as version_status',
      'a.display_name as actor_name'
    );
  res.json({
    changes: rows.map((r) => ({ ...r, source_event_ids: parseIds(r.source_event_ids) })),
  });
});

// ---------------------------------------------------------------------------
// Access control

const accessSchema = z.object({
  account_id: z.string().uuid().optional().nullable(),
  email: z.string().email().optional().nullable(),
  access_role: z.enum(['lead_coordinator', 'provider', 'carer', 'emergency_contact', 'shared']),
  can_view: z.boolean().default(true),
  can_comment: z.boolean().default(false),
  can_edit: z.boolean().default(false),
  can_sign: z.boolean().default(false),
});

carePlanRouter.get('/access', requireAuth, async (req, res) => {
  const perms = await planPermissions(req);
  if (!perms.view) {
    forbidden(res, 'view');
    return;
  }
  const rows = await db('care_plan_access as p')
    .leftJoin('accounts as a', 'p.account_id', 'a.id')
    .where({ 'p.care_profile_id': req.params['id'] })
    .orderBy('p.created_at', 'asc')
    .select('p.*', 'a.display_name as account_name', 'a.email as account_email');
  res.json({ access: rows, can_manage: await canManageAccess(req) });
});

carePlanRouter.post('/access', requireAuth, async (req, res) => {
  if (!(await canManageAccess(req))) {
    forbidden(res, 'manage access to');
    return;
  }
  const parsed = accessSchema.safeParse(req.body);
  if (!parsed.success || (!parsed.data.account_id && !parsed.data.email)) {
    res.status(400).json({ error: 'Pick a person or an email address', code: 'VALIDATION_ERROR' });
    return;
  }
  const [row] = await db('care_plan_access')
    .insert({
      care_profile_id: req.params['id'],
      account_id: parsed.data.account_id ?? null,
      email: parsed.data.email ?? null,
      access_role: parsed.data.access_role,
      can_view: parsed.data.can_view,
      can_comment: parsed.data.can_comment,
      can_edit: parsed.data.can_edit,
      can_sign: parsed.data.can_sign,
      created_by: req.account!.id,
    })
    .returning('*');
  logPlanAudit(String(req.params['id']), req.account!.id, 'created', `Care plan access granted: ${parsed.data.access_role}`);
  res.status(201).json({ access: row });
});

carePlanRouter.patch('/access/:accessId', requireAuth, async (req, res) => {
  if (!(await canManageAccess(req))) {
    forbidden(res, 'manage access to');
    return;
  }
  const parsed = accessSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const [row] = await db('care_plan_access')
    .where({ id: req.params['accessId'], care_profile_id: req.params['id'] })
    .update(parsed.data)
    .returning('*');
  if (!row) {
    res.status(404).json({ error: 'Access entry not found', code: 'NOT_FOUND' });
    return;
  }
  logPlanAudit(String(req.params['id']), req.account!.id, 'updated', `Care plan access changed: ${row.access_role}`);
  res.json({ access: row });
});

carePlanRouter.delete('/access/:accessId', requireAuth, async (req, res) => {
  if (!(await canManageAccess(req))) {
    forbidden(res, 'manage access to');
    return;
  }
  const deleted = await db('care_plan_access')
    .where({ id: req.params['accessId'], care_profile_id: req.params['id'] })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Access entry not found', code: 'NOT_FOUND' });
    return;
  }
  logPlanAudit(String(req.params['id']), req.account!.id, 'deleted', 'Care plan access removed');
  res.json({ message: 'Access removed.' });
});

// ---------------------------------------------------------------------------
// Review invitations (secure links)

const reviewSchema = z.object({
  invited_email: z.string().email().optional().nullable(),
  invited_name: z.string().max(255).optional().nullable(),
  can_comment: z.boolean().default(true),
  can_approve: z.boolean().default(false),
});

carePlanRouter.post('/versions/:versionId/reviews', requireAuth, async (req, res) => {
  const perms = await planPermissions(req);
  if (!perms.edit) {
    forbidden(res, 'invite reviewers to');
    return;
  }
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const version = await findVersion(req);
  if (!version) {
    res.status(404).json({ error: 'Version not found', code: 'NOT_FOUND' });
    return;
  }
  const token = newReviewToken();
  const expires = new Date();
  expires.setDate(expires.getDate() + 14);
  const [review] = await db('care_plan_reviews')
    .insert({
      version_id: version.id,
      token,
      invited_email: parsed.data.invited_email ?? null,
      invited_name: parsed.data.invited_name ?? null,
      can_comment: parsed.data.can_comment,
      can_approve: parsed.data.can_approve,
      created_by: req.account!.id,
      expires_at: expires,
    })
    .returning('*');
  logPlanAudit(
    String(req.params['id']),
    req.account!.id,
    'created',
    `Care plan review invited for version ${version.version}${parsed.data.invited_email ? `: ${parsed.data.invited_email}` : ''}`
  );
  res.status(201).json({
    review: { id: review.id, expires_at: review.expires_at },
    // The caller turns this into a shareable link on its own origin.
    review_path: `/plan-review/${token}`,
  });
});

// ---------------------------------------------------------------------------
// Public receiving end of a review link (no login; the token is the key)

export const planReviewsRouter = Router();

async function findLiveReview(token: string) {
  const review = await db('care_plan_reviews').where({ token }).first();
  if (!review) return null;
  if (new Date(review.expires_at) < new Date()) return null;
  return review;
}

planReviewsRouter.get('/:token', async (req, res) => {
  const review = await findLiveReview(String(req.params['token']));
  if (!review) {
    res.status(404).json({ error: 'This review link is invalid or has expired', code: 'NOT_FOUND' });
    return;
  }
  const version = await db('care_plan_versions').where({ id: review.version_id }).first();
  const profile = version ? await db('care_profiles').where({ id: version.care_profile_id }).first() : null;
  if (!version || !profile) {
    res.status(404).json({ error: 'This review link is invalid or has expired', code: 'NOT_FOUND' });
    return;
  }
  logPlanAudit(version.care_profile_id, null, 'viewed', `Care plan version ${version.version} viewed via review link`);
  res.json({
    review: {
      invited_name: review.invited_name,
      can_comment: review.can_comment,
      can_approve: review.can_approve,
      status: review.status,
      comment: review.comment,
      expires_at: review.expires_at,
    },
    version: {
      version: version.version,
      status: version.status,
      content: parseContent(version.content),
      content_hash: version.content_hash,
      changelog: version.changelog,
      created_at: version.created_at,
    },
    profile_name: profile.full_name,
  });
});

const respondSchema = z.object({ comment: z.string().max(5000).optional().nullable() });

planReviewsRouter.post('/:token/comment', async (req, res) => {
  const review = await findLiveReview(String(req.params['token']));
  if (!review || !review.can_comment) {
    res.status(404).json({ error: 'This review link is invalid or has expired', code: 'NOT_FOUND' });
    return;
  }
  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.comment?.trim()) {
    res.status(400).json({ error: 'A comment is required', code: 'VALIDATION_ERROR' });
    return;
  }
  await db('care_plan_reviews')
    .where({ id: review.id })
    .update({ status: 'commented', comment: parsed.data.comment.trim(), responded_at: db.fn.now() });
  const version = await db('care_plan_versions').where({ id: review.version_id }).first();
  if (version) {
    logPlanAudit(
      version.care_profile_id,
      null,
      'reviewed',
      `Care plan version ${version.version} commented on by ${review.invited_name ?? review.invited_email ?? 'a reviewer'}`
    );
  }
  res.json({ message: 'Comment recorded.' });
});

planReviewsRouter.post('/:token/approve', async (req, res) => {
  const review = await findLiveReview(String(req.params['token']));
  if (!review || !review.can_approve) {
    res.status(404).json({ error: 'This review link is invalid or has expired', code: 'NOT_FOUND' });
    return;
  }
  const parsed = respondSchema.safeParse(req.body);
  const version = await db('care_plan_versions').where({ id: review.version_id }).first();
  if (!version) {
    res.status(404).json({ error: 'This review link is invalid or has expired', code: 'NOT_FOUND' });
    return;
  }
  await db('care_plan_reviews')
    .where({ id: review.id })
    .update({
      status: 'approved',
      comment: parsed.success ? parsed.data.comment?.trim() || review.comment : review.comment,
      responded_at: db.fn.now(),
    });
  if (version.status === 'awaiting_signoff') {
    await approveVersion(version.id, version.care_profile_id);
  }
  logPlanAudit(
    version.care_profile_id,
    null,
    'approved',
    `Care plan version ${version.version} approved by ${review.invited_name ?? review.invited_email ?? 'a reviewer'}`
  );
  res.json({ message: 'Approval recorded.' });
});
