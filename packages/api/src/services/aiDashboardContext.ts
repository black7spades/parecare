import { db } from '../config/database';
import { formatInZone, hmInZone, startOfDayInZone } from '../lib/timezone';
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
  /** Every active medication, so "all my meds" can be resolved to real names. */
  medications: Array<{ name: string; dose: string | null; schedule_times: string[] }>;
  overdueMedications: string[];
  /** Active medications whose remaining supply has reached zero. */
  outOfStockMedications: Array<{ id: string; name: string }>;
  staleQuestionCount: number;
  nextEvent: { title: string; next_due_at: Date } | null;
  lastLog: { entry_type: string; title: string | null; body: string; occurred_at: Date } | null;
}

export interface DashboardData {
  profiles: ProfileSummaryData[];
  attentionCount: number;
}

const STALE_QUESTION_DAYS = 7;

function fmtDate(v: string | Date | null | undefined, timeZone?: string | null): string {
  if (!v) return 'unknown time';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'unknown time' : formatInZone(d, timeZone);
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
  nowHm: string
): Map<string, string[]> {
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

export async function gatherDashboardData(accountId: string, timeZone?: string | null): Promise<DashboardData> {
  const profiles = await accessibleProfiles(accountId);
  if (profiles.length === 0) return { profiles: [], attentionCount: 0 };

  const ids = profiles.map((p) => p.id);
  const now = new Date();
  // "Today" runs on the user's clock, not the server's, so a dose logged
  // this morning in Melbourne counts against today even on a UTC server.
  const startOfDay = startOfDayInZone(now, timeZone);
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
      .select('m.care_profile_id', 'm.id', 'c.name as name', 'm.dose', 'm.schedule_times', 'm.supply', 'm.supply_remaining', 'm.packs_on_hand')
      .orderBy('c.name', 'asc'),
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
    hmInZone(now, timeZone)
  );

  const medsMap = new Map<string, Array<{ name: string; dose: string | null; schedule_times: string[] }>>();
  const outOfStockMap = new Map<string, Array<{ id: string; name: string }>>();
  for (const m of meds as Array<{ care_profile_id: string; id: string; name: string; dose: string | null; schedule_times: unknown; supply: string | number | null; supply_remaining: string | number | null; packs_on_hand: string | number | null }>) {
    const arr = medsMap.get(m.care_profile_id) ?? [];
    arr.push({
      name: m.name,
      dose: m.dose,
      schedule_times: Array.isArray(m.schedule_times) ? (m.schedule_times as string[]) : [],
    });
    medsMap.set(m.care_profile_id, arr);
    // Supply is tracked only when a number is set; zero or below, counting
    // unopened packs, means a repeat is needed before the next dose.
    const packUnits =
      m.packs_on_hand != null && m.supply != null ? Number(m.packs_on_hand) * Number(m.supply) : 0;
    if (m.supply_remaining !== null && m.supply_remaining !== undefined && Number(m.supply_remaining) + packUnits <= 0) {
      const out = outOfStockMap.get(m.care_profile_id) ?? [];
      out.push({ id: m.id, name: m.name });
      outOfStockMap.set(m.care_profile_id, out);
    }
  }

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
    const outOfStockMedications = outOfStockMap.get(p.id) ?? [];
    const staleQuestionCount = staleMap.get(p.id) ?? 0;
    attentionCount += overdueReminders.length + overdueMedications.length + outOfStockMedications.length + staleQuestionCount;
    const ev = eventMap.get(p.id);
    const lg = logMap.get(p.id);
    return {
      profile: p,
      journeys: journeyMap.get(p.id) ?? [],
      overdueReminders,
      medications: medsMap.get(p.id) ?? [],
      overdueMedications,
      outOfStockMedications,
      staleQuestionCount,
      nextEvent: ev ? { title: ev.title, next_due_at: ev.next_due_at } : null,
      lastLog: lg ? { entry_type: lg.entry_type, title: lg.title, body: lg.body, occurred_at: lg.occurred_at } : null,
    };
  });

  return { profiles: summaries, attentionCount };
}

function profileBlock(s: ProfileSummaryData, timeZone?: string | null): string {
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
    const top = s.overdueReminders.slice(0, 3).map((r) => `"${r.title}" was due ${fmtDate(r.next_due_at, timeZone)}`);
    lines.push(`Overdue tasks: ${s.overdueReminders.length} (${top.join('; ')})`);
  }
  if (s.medications.length > 0) {
    lines.push(
      `Active medications: ${s.medications
        .map(
          (m) =>
            `${m.name}${m.dose ? ` (dose ${m.dose}${m.schedule_times.length ? `, scheduled at ${m.schedule_times.join(', ')}` : ''})` : m.schedule_times.length ? ` (scheduled at ${m.schedule_times.join(', ')})` : ''}`
        )
        .join('; ')}`
    );
  }
  if (s.overdueMedications.length > 0) {
    lines.push(`Medications with a dose not yet recorded today: ${s.overdueMedications.join(', ')}`);
  }
  if (s.outOfStockMedications.length > 0) {
    lines.push(`Medications out of stock (a repeat is needed): ${s.outOfStockMedications.map((m) => m.name).join(', ')}`);
  }
  if (s.staleQuestionCount > 0) {
    lines.push(`Open questions with no response in ${STALE_QUESTION_DAYS}+ days: ${s.staleQuestionCount}`);
  }
  if (s.nextEvent) {
    lines.push(`Next event within 48 hours: "${s.nextEvent.title}" at ${fmtDate(s.nextEvent.next_due_at, timeZone)}`);
  }
  if (s.lastLog) {
    const summary = s.lastLog.title ?? s.lastLog.body.slice(0, 120);
    lines.push(`Last care log entry: [${s.lastLog.entry_type.replace(/_/g, ' ')}] ${summary} at ${fmtDate(s.lastLog.occurred_at, timeZone)}`);
  }
  return lines.join('\n');
}

export async function buildDashboardContext(
  account: Account,
  timeZone?: string | null
): Promise<{ context: string; profileCount: number; attentionCount: number }> {
  const data = await gatherDashboardData(account.id, timeZone);
  const now = new Date();

  const people = data.profiles.filter((s) => s.profile.kind !== 'pet').length;
  const pets = data.profiles.filter((s) => s.profile.kind === 'pet').length;
  const noJourney = data.profiles.filter((s) => s.journeys.length === 0).map((s) => s.profile.full_name);

  const header = [
    `## Situation`,
    `User: ${account.display_name}`,
    `Current date and time: ${fmtDate(now, timeZone)}`,
    `Profiles in their care: ${data.profiles.length} (${people} ${people === 1 ? 'person' : 'people'}, ${pets} ${pets === 1 ? 'pet' : 'pets'})`,
    noJourney.length > 0 ? `Profiles with no journey started yet: ${noJourney.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  if (data.profiles.length === 0) {
    return { context: header, profileCount: 0, attentionCount: 0 };
  }

  const context = [header, `## Everyone in their care`, ...data.profiles.map((p) => profileBlock(p, timeZone))].join('\n\n');
  return { context, profileCount: data.profiles.length, attentionCount: data.attentionCount };
}

/** Just the attention number, for the dashboard prompt line. */
export async function countAttentionItems(accountId: string): Promise<number> {
  const data = await gatherDashboardData(accountId);
  return data.attentionCount;
}

/** One pressing thing, tied to the profile and section where it can be dealt with. */
export interface AttentionItem {
  profile_id: string;
  profile_name: string;
  kind: 'overdue_task' | 'unrecorded_dose' | 'stale_question' | 'out_of_stock' | 'unresolved_outcome';
  label: string;
  detail: string | null;
  section: 'tasks' | 'medications' | 'questions';
  /** A stable identifier for this item, for React keys and for dismissal. */
  key: string;
  /** Pressing enough to lead the list and stand out. */
  urgent: boolean;
  /** Can be acknowledged and set aside (behind an "are you sure?" confirm). */
  dismissible: boolean;
}

/** Item keys an account has acknowledged and set aside. */
async function getDismissedKeys(accountId: string): Promise<Set<string>> {
  const rows = await db('attention_dismissals').where({ account_id: accountId }).select('item_key');
  return new Set(rows.map((r) => (r as { item_key: string }).item_key));
}

/**
 * The actual things needing attention across everyone, so the Homeboard can
 * list them itself instead of sending the user to the assistant to find out.
 * Urgent items (an out-of-stock medication) lead the list; anything the
 * account has dismissed is left out.
 */
export async function gatherAttentionItems(accountId: string, timeZone?: string | null): Promise<AttentionItem[]> {
  const [data, dismissed, poorOutcomes] = await Promise.all([
    gatherDashboardData(accountId, timeZone),
    getDismissedKeys(accountId),
    db('reminders')
      .whereIn('care_profile_id', (await accessibleProfiles(accountId)).map((p) => p.id))
      .where('completed', true)
      .whereNotNull('sentiment')
      .where('sentiment', '<=', 3)
      .where('completed_at', '>=', db.raw("now() - interval '7 days'"))
      .select('care_profile_id', 'id', 'title', 'sentiment'),
  ]);
  const poorByProfile = new Map<string, Array<{ id: string; title: string; sentiment: number }>>();
  for (const r of poorOutcomes) {
    const arr = poorByProfile.get(r.care_profile_id) ?? [];
    arr.push({ id: r.id, title: r.title, sentiment: r.sentiment });
    poorByProfile.set(r.care_profile_id, arr);
  }
  const items: AttentionItem[] = [];
  for (const s of data.profiles) {
    const name = s.profile.preferred_name ?? s.profile.full_name;
    // An out-of-stock medication is urgent: without a repeat the next dose
    // cannot be given. Each medication is its own item so it can be set aside
    // on its own once a repeat is arranged.
    for (const m of s.outOfStockMedications) {
      items.push({
        profile_id: s.profile.id,
        profile_name: name,
        kind: 'out_of_stock',
        label: 'Out of stock',
        detail: m.name,
        section: 'medications',
        key: `out_of_stock:${m.id}`,
        urgent: true,
        dismissible: true,
      });
    }
    for (const r of s.overdueReminders) {
      items.push({
        profile_id: s.profile.id,
        profile_name: name,
        kind: 'overdue_task',
        label: r.title,
        detail: `was due ${fmtDate(r.next_due_at, timeZone)}`,
        section: 'tasks',
        key: `overdue_task:${s.profile.id}:${new Date(r.next_due_at).toISOString()}:${r.title}`,
        urgent: false,
        dismissible: false,
      });
    }
    if (s.overdueMedications.length > 0) {
      items.push({
        profile_id: s.profile.id,
        profile_name: name,
        kind: 'unrecorded_dose',
        label: s.overdueMedications.length === 1 ? 'A dose is not yet recorded today' : 'Doses are not yet recorded today',
        detail: s.overdueMedications.join(', '),
        section: 'medications',
        key: `unrecorded_dose:${s.profile.id}`,
        urgent: false,
        dismissible: false,
      });
    }
    if (s.staleQuestionCount > 0) {
      items.push({
        profile_id: s.profile.id,
        profile_name: name,
        kind: 'stale_question',
        label:
          s.staleQuestionCount === 1
            ? 'An open question has had no reply'
            : `${s.staleQuestionCount} open questions have had no reply`,
        detail: `nothing said for ${STALE_QUESTION_DAYS}+ days`,
        section: 'questions',
        key: `stale_question:${s.profile.id}`,
        urgent: false,
        dismissible: false,
      });
    }
    const poor = poorByProfile.get(s.profile.id) ?? [];
    for (const r of poor) {
      items.push({
        profile_id: s.profile.id,
        profile_name: name,
        kind: 'unresolved_outcome',
        label: `Task completed with a poor outcome`,
        detail: r.title,
        section: 'tasks',
        key: `unresolved_outcome:${r.id}`,
        urgent: false,
        dismissible: true,
      });
    }
  }
  // Drop anything already acknowledged, then lead with the urgent items.
  // Array sort is stable, so the per-profile order is otherwise preserved.
  return items.filter((i) => !dismissed.has(i.key)).sort((a, b) => Number(b.urgent) - Number(a.urgent));
}
