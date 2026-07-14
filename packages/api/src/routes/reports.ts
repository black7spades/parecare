import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

export const reportsRouter = Router();

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
