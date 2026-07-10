import { db } from '../config/database';
import type { Account, CareProfile } from '../types';

/**
 * Builds Pare's dashboard-level knowledge: a short summary of every care
 * profile the account can reach (owned plus accepted circle membership),
 * so the assistant can say what needs attention across everyone and route
 * the user to the right profile. Deliberately shallow: full records live
 * in the per-profile context, which takes over once the user navigates.
 */

interface ProfileSummaryData {
  profile: CareProfile & { relationship: string | null };
  journeys: Array<{ name: string; phase_name: string | null }>;
  overdueReminders: Array<{ title: string; next_due_at: Date }>;
  overdueMedications: string[];
  staleQuestionCount: number;
  nextEvent: { title: string; next_due_at: Date } | null;
  lastLog: { entry_type: string; title: string | null; body: string; occurred_at: Date } | null;
}

export interface DashboardData {
  profiles: ProfileSummaryData[];
  attentionCount: number;
}

const STALE_QUESTION_DAYS = 7;

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return 'unknown time';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'unknown time' : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

async function accessibleProfiles(accountId: string): Promise<Array<CareProfile & { relationship: string | null }>> {
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
  return [
    ...owned.map((p) => ({ ...p, relationship: p.owner_relationship })),
    ...shared.map((p) => ({
      ...p,
      relationship: (p as CareProfile & { viewer_relationship: string | null }).viewer_relationship,
    })),
  ];
}

/**
 * A medication is overdue today when it has scheduled times that have
 * already passed and fewer administrations have been recorded today than
 * slots that have passed.
 */
function overdueMedNames(
  meds: Array<{ care_profile_id: string; id: string; name: string; schedule_times: unknown }>,
  adminCounts: Map<string, number>,
  now: Date
): Map<string, string[]> {
  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const byProfile = new Map<string, string[]>();
  for (const med of meds) {
    const times = Array.isArray(med.schedule_times) ? (med.schedule_times as string[]) : [];
    const passed = times.filter((t) => typeof t === 'string' && t <= nowHm).length;
    if (passed === 0) continue;
    const recorded = adminCounts.get(med.id) ?? 0;
    if (recorded < passed) {
      const arr = byProfile.get(med.care_profile_id) ?? [];
      arr.push(med.name);
      byProfile.set(med.care_profile_id, arr);
    }
  }
  return byProfile;
}

export async function gatherDashboardData(accountId: string): Promise<DashboardData> {
  const profiles = await accessibleProfiles(accountId);
  if (profiles.length === 0) return { profiles: [], attentionCount: 0 };

  const ids = profiles.map((p) => p.id);
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const soon = new Date(now.getTime() + 48 * 3600 * 1000);
  const staleBefore = new Date(now.getTime() - STALE_QUESTION_DAYS * 24 * 3600 * 1000);

  const [journeyRows, overdueRows, nextEventRows, lastLogRows, meds, adminRows, questionRows] = await Promise.all([
    db.raw(
      `SELECT j.care_profile_id, j.name, p.name AS phase_name
       FROM care_journeys j
       LEFT JOIN care_journey_phases p
         ON p.care_journey_id = j.id AND p.entered_at IS NOT NULL AND p.locked_at IS NULL
       WHERE j.care_profile_id = ANY(?) AND j.status = 'active'
       ORDER BY j.started_at ASC`,
      [ids]
    ),
    db('reminders')
      .whereIn('care_profile_id', ids)
      .where({ completed: false })
      .where('next_due_at', '<', now)
      .orderBy('next_due_at', 'asc')
      .select('care_profile_id', 'title', 'next_due_at'),
    db.raw(
      `SELECT DISTINCT ON (care_profile_id) care_profile_id, title, next_due_at
       FROM reminders WHERE care_profile_id = ANY(?) AND completed = false AND next_due_at >= ? AND next_due_at <= ?
       ORDER BY care_profile_id, next_due_at ASC`,
      [ids, now, soon]
    ),
    db.raw(
      `SELECT DISTINCT ON (care_profile_id) care_profile_id, entry_type, title, body, occurred_at
       FROM care_log_entries WHERE care_profile_id = ANY(?)
       ORDER BY care_profile_id, occurred_at DESC`,
      [ids]
    ),
    db('medications as m')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .whereIn('m.care_profile_id', ids)
      .where('m.active', true)
      .whereNotNull('m.schedule_times')
      .select('m.care_profile_id', 'm.id', 'c.name as name', 'm.schedule_times'),
    db('medication_administrations')
      .whereIn('care_profile_id', ids)
      .where('administered_at', '>=', startOfDay)
      .groupBy('medication_id')
      .select('medication_id')
      .count('id as count'),
    // Open questions where nothing has been said (question or response) for
    // 7 or more days.
    db.raw(
      `SELECT q.care_profile_id, count(*)::int AS count
       FROM open_questions q
       WHERE q.care_profile_id = ANY(?) AND q.status = 'open'
         AND q.created_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM open_question_responses r
           WHERE r.question_id = q.id AND r.created_at >= ?
         )
       GROUP BY q.care_profile_id`,
      [ids, staleBefore, staleBefore]
    ),
  ]);

  const journeyMap = new Map<string, Array<{ name: string; phase_name: string | null }>>();
  for (const j of journeyRows.rows as Array<{ care_profile_id: string; name: string; phase_name: string | null }>) {
    const arr = journeyMap.get(j.care_profile_id) ?? [];
    arr.push({ name: j.name, phase_name: j.phase_name });
    journeyMap.set(j.care_profile_id, arr);
  }

  const overdueMap = new Map<string, Array<{ title: string; next_due_at: Date }>>();
  for (const r of overdueRows as Array<{ care_profile_id: string; title: string; next_due_at: Date }>) {
    const arr = overdueMap.get(r.care_profile_id) ?? [];
    arr.push({ title: r.title, next_due_at: r.next_due_at });
    overdueMap.set(r.care_profile_id, arr);
  }

  const adminCounts = new Map<string, number>(
    (adminRows as Array<{ medication_id: string; count: string | number }>).map((r) => [r.medication_id, Number(r.count)])
  );
  const overdueMedMap = overdueMedNames(
    meds as Array<{ care_profile_id: string; id: string; name: string; schedule_times: unknown }>,
    adminCounts,
    now
  );

  const staleMap = new Map<string, number>(
    (questionRows.rows as Array<{ care_profile_id: string; count: number }>).map((r) => [r.care_profile_id, r.count])
  );
  const eventMap = new Map(
    (nextEventRows.rows as Array<{ care_profile_id: string; title: string; next_due_at: Date }>).map((r) => [r.care_profile_id, r])
  );
  const logMap = new Map(
    (lastLogRows.rows as Array<{ care_profile_id: string; entry_type: string; title: string | null; body: string; occurred_at: Date }>).map(
      (r) => [r.care_profile_id, r]
    )
  );

  let attentionCount = 0;
  const summaries: ProfileSummaryData[] = profiles.map((p) => {
    const overdueReminders = overdueMap.get(p.id) ?? [];
    const overdueMedications = overdueMedMap.get(p.id) ?? [];
    const staleQuestionCount = staleMap.get(p.id) ?? 0;
    attentionCount += overdueReminders.length + overdueMedications.length + staleQuestionCount;
    const ev = eventMap.get(p.id);
    const lg = logMap.get(p.id);
    return {
      profile: p,
      journeys: journeyMap.get(p.id) ?? [],
      overdueReminders,
      overdueMedications,
      staleQuestionCount,
      nextEvent: ev ? { title: ev.title, next_due_at: ev.next_due_at } : null,
      lastLog: lg ? { entry_type: lg.entry_type, title: lg.title, body: lg.body, occurred_at: lg.occurred_at } : null,
    };
  });

  return { profiles: summaries, attentionCount };
}

function profileBlock(s: ProfileSummaryData): string {
  const p = s.profile;
  const lines: string[] = [];
  const who = [
    p.kind === 'pet' ? 'pet' : 'person',
    p.kind === 'pet' ? [p.species, p.breed].filter(Boolean).join(', ') || null : null,
    p.relationship ? `their ${p.relationship}` : null,
  ]
    .filter(Boolean)
    .join('; ');
  lines.push(`### ${p.full_name}${p.preferred_name ? ` (goes by ${p.preferred_name})` : ''}`);
  lines.push(`Profile id: ${p.id}`);
  lines.push(`Who: ${who}`);
  if (s.journeys.length > 0) {
    lines.push(
      `Journeys: ${s.journeys.map((j) => `${j.name}${j.phase_name ? ` (phase: ${j.phase_name})` : ''}`).join('; ')}`
    );
  } else {
    lines.push('Journeys: none started yet');
  }
  if (s.overdueReminders.length > 0) {
    const top = s.overdueReminders.slice(0, 3).map((r) => `"${r.title}" was due ${fmtDate(r.next_due_at)}`);
    lines.push(`Overdue tasks: ${s.overdueReminders.length} (${top.join('; ')})`);
  }
  if (s.overdueMedications.length > 0) {
    lines.push(`Medications with a dose not yet recorded today: ${s.overdueMedications.join(', ')}`);
  }
  if (s.staleQuestionCount > 0) {
    lines.push(`Open questions with no response in ${STALE_QUESTION_DAYS}+ days: ${s.staleQuestionCount}`);
  }
  if (s.nextEvent) {
    lines.push(`Next event within 48 hours: "${s.nextEvent.title}" at ${fmtDate(s.nextEvent.next_due_at)}`);
  }
  if (s.lastLog) {
    const summary = s.lastLog.title ?? s.lastLog.body.slice(0, 120);
    lines.push(`Last care log entry: [${s.lastLog.entry_type.replace(/_/g, ' ')}] ${summary} at ${fmtDate(s.lastLog.occurred_at)}`);
  }
  return lines.join('\n');
}

export async function buildDashboardContext(account: Account): Promise<{ context: string; profileCount: number; attentionCount: number }> {
  const data = await gatherDashboardData(account.id);
  const now = new Date();

  const people = data.profiles.filter((s) => s.profile.kind !== 'pet').length;
  const pets = data.profiles.filter((s) => s.profile.kind === 'pet').length;
  const noJourney = data.profiles.filter((s) => s.journeys.length === 0).map((s) => s.profile.full_name);

  const header = [
    `## Situation`,
    `User: ${account.display_name}`,
    `Current date and time: ${fmtDate(now)}`,
    `Profiles in their care: ${data.profiles.length} (${people} ${people === 1 ? 'person' : 'people'}, ${pets} ${pets === 1 ? 'pet' : 'pets'})`,
    noJourney.length > 0 ? `Profiles with no journey started yet: ${noJourney.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  if (data.profiles.length === 0) {
    return { context: header, profileCount: 0, attentionCount: 0 };
  }

  const context = [header, `## Everyone in their care`, ...data.profiles.map(profileBlock)].join('\n\n');
  return { context, profileCount: data.profiles.length, attentionCount: data.attentionCount };
}

/** Just the attention number, for the dashboard prompt line. */
export async function countAttentionItems(accountId: string): Promise<number> {
  const data = await gatherDashboardData(accountId);
  return data.attentionCount;
}
