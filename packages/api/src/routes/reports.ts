import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { getCareAccess } from '../middleware/subscriptionGate';
import { requireAccountRight } from '../middleware/accountRights';
import { z } from 'zod';
import { getRegistry, generateReport, toCsv, SYSTEM_PRESETS, type ReportPreset } from '../services/reportEngine';
import { sendShareEmail } from '../services/email';
import { SendProblem, createShareLink, linkOut, resolveRecipient, sendToSchema, shareUrl } from '../services/shareLinks';

export const reportsRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────

async function profileIdsForAccount(accountId: string, role: string): Promise<string[]> {
  if (role === 'super_admin') {
    const rows = await db('care_profiles').where({ archived: false }).select('id');
    return rows.map((r) => r.id);
  }

  const [owned, shared] = await Promise.all([
    db('care_profiles').where({ account_id: accountId, archived: false }).select('id'),
    db('care_circle_members')
      .join('care_profiles', 'care_profiles.id', 'care_circle_members.care_profile_id')
      .where({ 'care_circle_members.account_id': accountId, 'care_circle_members.invite_accepted': true, 'care_profiles.archived': false })
      .select('care_profiles.id'),
  ]);
  return [...new Set([...owned, ...shared].map((r) => r.id))];
}

function parseDateRange(query: Record<string, unknown>): { from: Date; to: Date } {
  const to = query['to'] ? new Date(String(query['to'])) : new Date();
  const from = query['from'] ? new Date(String(query['from'])) : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  return { from, to };
}

/** Who is reading each person's report, for documents shared only with some roles. */
async function docAccessFor(account: NonNullable<import('express').Request['account']>, profileIds: string[]) {
  const map = new Map<string, { owner: boolean; role: string | null }>();
  for (const id of profileIds) {
    const access = await getCareAccess(account, id);
    if (access) map.set(id, { owner: access.level === 'owner', role: access.member?.role ?? null });
  }
  return map;
}

async function accessibleProfileIds(accountId: string, role: string, requestedIds: string[]): Promise<string[]> {
  const allAccessible = await profileIdsForAccount(accountId, role);
  const accessible = new Set(allAccessible);
  if (requestedIds.length === 0) return allAccessible;
  return requestedIds.filter((id) => accessible.has(id));
}

// ── Legacy endpoints (kept for backwards compatibility) ────────────────

reportsRouter.get('/sentiment-trends', requireAuth, async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const profileIds = await profileIdsForAccount(req.account!.id, req.account!.role);
  if (profileIds.length === 0) {
    res.json({ weeks: [] });
    return;
  }

  const rows = await db.raw(
    `SELECT date_trunc('week', completed_at)::date AS week,
            round(avg(sentiment), 2) AS avg_sentiment,
            count(*)::int AS count
     FROM reminders
     WHERE care_profile_id = ANY(?)
       AND completed = true
       AND sentiment IS NOT NULL
       AND completed_at >= ? AND completed_at <= ?
     GROUP BY 1
     ORDER BY 1`,
    [profileIds, from, to]
  );

  res.json({ weeks: rows.rows });
});

reportsRouter.get('/health-status-summary', requireAuth, async (req, res) => {
  const profileIds = await profileIdsForAccount(req.account!.id, req.account!.role);
  if (profileIds.length === 0) {
    res.json({ summary: [] });
    return;
  }

  const rows = await db('health_statuses')
    .whereIn('care_profile_id', profileIds)
    .groupBy('category', 'status')
    .select('category', 'status')
    .count('* as count');

  res.json({ summary: rows.map((r) => ({ ...r, count: Number(r.count) })) });
});

reportsRouter.get('/outcome-analysis', requireAuth, async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const profileIds = await profileIdsForAccount(req.account!.id, req.account!.role);
  if (profileIds.length === 0) {
    res.json({ positive: 0, negative: 0, total: 0 });
    return;
  }

  const rows = await db.raw(
    `SELECT
       count(*) FILTER (WHERE sentiment >= 4)::int AS positive,
       count(*) FILTER (WHERE sentiment <= 3)::int AS negative,
       count(*)::int AS total
     FROM reminders
     WHERE care_profile_id = ANY(?)
       AND completed = true
       AND sentiment IS NOT NULL
       AND completed_at >= ? AND completed_at <= ?`,
    [profileIds, from, to]
  );

  const r = rows.rows[0] ?? { positive: 0, negative: 0, total: 0 };
  res.json(r);
});

// ── Report generator endpoints ─────────────────────────────────────────

reportsRouter.get('/registry', requireAuth, async (_req, res) => {
  res.json({ sections: getRegistry() });
});

reportsRouter.get('/profiles', requireAuth, async (req, res) => {
  const profileIds = await profileIdsForAccount(req.account!.id, req.account!.role);
  if (profileIds.length === 0) {
    res.json({ profiles: [] });
    return;
  }
  const profiles = await db('care_profiles')
    .whereIn('id', profileIds)
    .where({ archived: false })
    .select('id', 'full_name', 'preferred_name', 'kind', 'current_phase', 'photo_url', 'photo_color')
    .orderBy('full_name', 'asc');
  res.json({ profiles });
});

reportsRouter.post('/generate', requireAuth, async (req, res) => {
  const account = req.account!;
  const { profileIds: requestedIds, sections, dateRange, includeAiNarrative, aiPrompt } = req.body;

  if (!Array.isArray(sections) || sections.length === 0) {
    res.status(400).json({ error: 'At least one section is required', code: 'VALIDATION' });
    return;
  }

  const profileIds = await accessibleProfileIds(account.id, account.role, requestedIds ?? []);
  if (profileIds.length === 0) {
    res.status(404).json({ error: 'No accessible profiles found', code: 'NOT_FOUND' });
    return;
  }

  // Viewers cannot generate reports
  if (requestedIds && requestedIds.length === 1) {
    const access = await getCareAccess(account, requestedIds[0]);
    if (access && access.level === 'viewer') {
      res.status(403).json({ error: 'Viewers cannot generate reports', code: 'FORBIDDEN' });
      return;
    }
  }

  const result = await generateReport({
    profileIds,
    sections,
    dateRange: dateRange ?? null,
    includeAiNarrative: !!includeAiNarrative,
    aiPrompt: aiPrompt ?? undefined,
    docAccess: await docAccessFor(account, profileIds),
  });

  res.json(result);
});

reportsRouter.post('/export/csv', requireAuth, requireAccountRight('can_export_data'), async (req, res) => {
  const account = req.account!;
  const { profileIds: requestedIds, sections, dateRange } = req.body;

  if (!Array.isArray(sections) || sections.length === 0) {
    res.status(400).json({ error: 'At least one section is required', code: 'VALIDATION' });
    return;
  }

  const profileIds = await accessibleProfileIds(account.id, account.role, requestedIds ?? []);
  if (profileIds.length === 0) {
    res.status(404).json({ error: 'No accessible profiles found', code: 'NOT_FOUND' });
    return;
  }

  const result = await generateReport({
    profileIds,
    sections,
    dateRange: dateRange ?? null,
    includeAiNarrative: false,
    docAccess: await docAccessFor(account, profileIds),
  });

  const csv = toCsv(result.sections);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="parecare-report-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// ── Send a report ──────────────────────────────────────────────────────

const sendSchema = z.object({
  profile_id: z.string().uuid(),
  report: z.object({
    name: z.string().trim().min(1).max(200),
    sections: z.array(z.object({ key: z.string(), fields: z.array(z.string()).default([]), filters: z.record(z.unknown()).default({}) })).min(1).max(40),
    dateRange: z.object({ from: z.string(), to: z.string() }).nullable().optional(),
    // The summary the sender already read, when Pare wrote one.
    narrative: z.string().max(40000).optional().nullable(),
  }),
  to: sendToSchema,
  document_ids: z.array(z.string().uuid()).max(20).default([]),
});

/**
 * Send one person's report to someone, such as a specialist's rooms: an
 * email with a link that opens it with no login for 30 days, and the chosen
 * documents with it. Documents shared only with some roles never go. With no
 * email set up here, the link comes back to send another way.
 */
reportsRouter.post('/send', requireAuth, requireAccountRight('can_export_data'), async (req, res) => {
  const parsed = sendSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose who to send it to.', code: 'VALIDATION_ERROR' });
    return;
  }
  const account = req.account!;
  const { profile_id: profileId, report, to, document_ids } = parsed.data;
  const access = await getCareAccess(account, profileId);
  if (!access || access.level === 'viewer') {
    res.status(403).json({ error: 'Only someone who can change this person\'s records can send their report. Ask the person who manages the profile.', code: 'FORBIDDEN' });
    return;
  }
  let recipient;
  try {
    recipient = await resolveRecipient(profileId, to);
  } catch (err) {
    if (err instanceof SendProblem) {
      res.status(400).json({ error: err.message, code: 'NO_EMAIL' });
      return;
    }
    throw err;
  }
  // Someone outside the circle reads it, so only what the whole circle may see goes.
  const result = await generateReport({ profileIds: [profileId], sections: report.sections, dateRange: report.dateRange ?? null, includeAiNarrative: false });
  // Pare's summary was written from the sender's view. When a documents
  // section could hold documents shared only with some roles, it stays home.
  const hasHeld = report.sections.some((sec) => sec.key === 'documents')
    ? !!(await db('documents').where({ care_profile_id: profileId }).whereRaw('coalesce(array_length(visible_to_roles, 1), 0) > 0').first('id'))
    : false;
  if (report.narrative?.trim() && !hasHeld) result.aiNarrative = report.narrative.trim();
  const docs = document_ids.length
    ? ((await db('documents')
        .whereIn('id', document_ids)
        .where({ care_profile_id: profileId })
        .whereRaw('coalesce(array_length(visible_to_roles, 1), 0) = 0')
        .select('id', 'label')) as Array<{ id: string; label: string }>)
    : [];
  const profile = (await db('care_profiles').where({ id: profileId }).first('full_name', 'preferred_name')) as { full_name: string; preferred_name: string | null } | undefined;
  const totalRows = result.sections.reduce((sum, sec) => sum + sec.rows.length, 0);
  const [saved] = await db('saved_reports')
    .insert({
      account_id: account.id,
      name: `${report.name}, sent to ${recipient.name}`,
      config: JSON.stringify({ sections: report.sections, dateRange: report.dateRange ?? null, profileIds: [profileId] }),
      result: JSON.stringify(result),
      profile_count: 1,
      section_count: result.sections.length,
      total_rows: totalRows,
      has_ai_narrative: !!result.aiNarrative,
      generated_at: result.generatedAt,
    })
    .returning('id');
  const link = await createShareLink(db, {
    profileId,
    kind: 'report',
    entityId: (saved as { id: string }).id,
    providerId: recipient.provider_id,
    circleMemberId: recipient.circle_member_id,
    recipientEmail: recipient.email,
    documentIds: docs.map((d) => d.id),
    createdBy: account.id,
  });
  const name = profile?.preferred_name || profile?.full_name || 'Someone';
  const from = account.display_name || account.email;
  let sent = false;
  try {
    sent = await sendShareEmail(
      recipient.email,
      `${name}: ${report.name}`,
      [
        `${from} sent you ${name}'s ${report.name.toLowerCase()} through PareCare.`,
        ...(docs.length ? ['', `With it: ${docs.map((d) => d.label).join(', ')}.`] : []),
        '',
        'It opens without logging in, for the next 30 days.',
      ],
      { text: 'Open the report', url: shareUrl(link.token) }
    );
  } catch (err) {
    console.error('Report email failed:', err);
    res.status(502).json({
      error: `The email to ${recipient.name} did not go. Copy the link and send it another way, or try again in a minute.`,
      code: 'EMAIL_FAILED',
      link: linkOut(link),
      recipient: { name: recipient.name, email: recipient.email },
    });
    return;
  }
  res.status(201).json({ sent, link: linkOut(link), recipient: { name: recipient.name, email: recipient.email }, documents: docs });
});

// ── Presets ─────────────────────────────────────────────────────────────

reportsRouter.get('/presets', requireAuth, async (req, res) => {
  const account = req.account!;
  const dbPresets = await db('report_presets')
    .where(function () {
      this.where('account_id', account.id).orWhere('is_system', true);
    })
    .orderBy([{ column: 'is_system', order: 'desc' }, { column: 'name', order: 'asc' }]);

  const systemFromCode = SYSTEM_PRESETS.map((p, i) => ({
    id: `system_${i}`,
    ...p,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const dbSystemIds = new Set(dbPresets.filter((p) => p.is_system).map((p) => p.name));
  const mergedSystem = systemFromCode.filter((p) => !dbSystemIds.has(p.name));

  res.json({ presets: [...mergedSystem, ...dbPresets] });
});

reportsRouter.post('/presets', requireAuth, async (req, res) => {
  const account = req.account!;
  const { name, description, config } = req.body;

  if (!name || !config) {
    res.status(400).json({ error: 'Name and config are required', code: 'VALIDATION' });
    return;
  }

  const [preset] = await db('report_presets')
    .insert({
      account_id: account.id,
      name,
      description: description ?? null,
      is_system: false,
      config: JSON.stringify(config),
    })
    .returning('*');

  res.status(201).json(preset);
});

reportsRouter.put('/presets/:presetId', requireAuth, async (req, res) => {
  const account = req.account!;
  const { presetId } = req.params;
  const { name, description, config } = req.body;

  const existing = await db('report_presets').where({ id: presetId }).first();
  if (!existing || (existing.account_id !== account.id && account.role !== 'super_admin')) {
    res.status(404).json({ error: 'Preset not found', code: 'NOT_FOUND' });
    return;
  }

  const [updated] = await db('report_presets')
    .where({ id: presetId })
    .update({
      name: name ?? existing.name,
      description: description !== undefined ? description : existing.description,
      config: config ? JSON.stringify(config) : existing.config,
      updated_at: new Date(),
    })
    .returning('*');

  res.json(updated);
});

reportsRouter.delete('/presets/:presetId', requireAuth, async (req, res) => {
  const account = req.account!;
  const { presetId } = req.params;

  const existing = await db('report_presets').where({ id: presetId }).first();
  if (!existing || (existing.account_id !== account.id && account.role !== 'super_admin')) {
    res.status(404).json({ error: 'Preset not found', code: 'NOT_FOUND' });
    return;
  }

  await db('report_presets').where({ id: presetId }).delete();
  res.json({ ok: true });
});

// ── Saved reports ──────────────────────────────────────────────────────

reportsRouter.get('/saved', requireAuth, async (req, res) => {
  const reports = await db('saved_reports')
    .where({ account_id: req.account!.id })
    .orderBy('generated_at', 'desc');
  res.json({
    reports: reports.map((r) => ({
      id: r.id,
      name: r.name,
      profile_count: r.profile_count,
      section_count: r.section_count,
      total_rows: r.total_rows,
      has_ai_narrative: r.has_ai_narrative,
      generated_at: r.generated_at,
      created_at: r.created_at,
    })),
  });
});

reportsRouter.get('/saved/:reportId', requireAuth, async (req, res) => {
  const report = await db('saved_reports')
    .where({ id: req.params.reportId, account_id: req.account!.id })
    .first();
  if (!report) {
    res.status(404).json({ error: 'Report not found', code: 'NOT_FOUND' });
    return;
  }
  res.json(report);
});

reportsRouter.post('/saved', requireAuth, async (req, res) => {
  const { name, config, result } = req.body;
  if (!name || !result) {
    res.status(400).json({ error: 'Name and result are required', code: 'VALIDATION' });
    return;
  }
  const totalRows = Array.isArray(result.sections)
    ? result.sections.reduce((sum: number, s: { rows?: unknown[] }) => sum + (s.rows?.length ?? 0), 0)
    : 0;
  const [saved] = await db('saved_reports')
    .insert({
      account_id: req.account!.id,
      name,
      config: JSON.stringify(config ?? {}),
      result: JSON.stringify(result),
      profile_count: result.profileCount ?? 0,
      section_count: Array.isArray(result.sections) ? result.sections.length : 0,
      total_rows: totalRows,
      has_ai_narrative: !!result.aiNarrative,
      generated_at: result.generatedAt ?? new Date().toISOString(),
    })
    .returning('*');
  res.status(201).json(saved);
});

reportsRouter.delete('/saved/:reportId', requireAuth, async (req, res) => {
  const deleted = await db('saved_reports')
    .where({ id: req.params.reportId, account_id: req.account!.id })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Report not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ ok: true });
});
