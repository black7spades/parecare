import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { getCareAccess } from '../middleware/subscriptionGate';
import { requireAccountRight } from '../middleware/accountRights';
import { getRegistry, generateReport, toCsv, SYSTEM_PRESETS, type ReportPreset } from '../services/reportEngine';

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
  });

  const csv = toCsv(result.sections);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="parecare-report-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
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
