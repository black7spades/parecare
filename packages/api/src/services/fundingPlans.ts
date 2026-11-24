import type { Knex } from 'knex';
import { z } from 'zod';
import { contactSummaries, resolveContactInput } from './professionals';
import { keepTask } from './keptTasks';
import { addDays } from './documentDates';
import { ownerZone } from './tasks';
import { dateInZone } from '../lib/timezone';
import { FUNDING_KINDS, fundingScheme, type CountryCode } from '../lib/countries';
import { profileCountry } from './country';

type Conn = Knex | Knex.Transaction;

/**
 * A funding plan: disability funding such as an NDIS plan, or an aged care
 * package such as Support at Home, with its dates, how
 * it is managed, who manages it and coordinates it, and its budgets. Costs
 * can count against a budget, so what is spent and what is left show
 * beside each one. Before the review meeting, every therapist linked to the
 * person gets a task to ask for their progress report.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max).optional().nullable();

/**
 * The kinds of plan. The keys are kinds, named by the person's country
 * (lib/countries.ts): "ndis" is an NDIS plan in Australia and a personal
 * budget in the UK.
 */
export const SCHEMES = FUNDING_KINDS;
export const MANAGEMENT = ['agency', 'plan', 'self'] as const;

/** What a plan of this kind is called where the person lives. */
export const schemeLabel = (country: CountryCode, scheme: string): string => fundingScheme(country, scheme).label;
/** How it is managed, in the scheme's own words. */
export function managementLabel(country: CountryCode, scheme: string, management: string | null): string | null {
  if (!management) return null;
  const m = fundingScheme(country, scheme).management ?? fundingScheme('AU', 'other').management!;
  return m[management as (typeof MANAGEMENT)[number]] ?? null;
}

/** The kinds of contact asked for a progress report before a review. */
export const REPORT_TYPES = [
  'Occupational therapist', 'Speech pathologist', 'Physiotherapist', 'psychologist', 'Psychologist',
  'Behaviour support practitioner', 'Exercise physiologist', 'Dietitian', 'Counsellor',
];
const REPORT_TYPE_SET = new Set(REPORT_TYPES.map((t) => t.toLowerCase()));

/** Six weeks before the review, unless someone says otherwise. */
export const REPORTS_LEAD_DAYS = 42;

const contactRef = { id: z.string().uuid().optional().nullable(), name: text(255), phone: text(50) };

export const planInputSchema = z.object({
  scheme: z.enum(SCHEMES),
  starts_on: day.optional().nullable(),
  ends_on: day.optional().nullable(),
  review_on: day.optional().nullable(),
  reports_due_on: day.optional().nullable(),
  management: z.enum(MANAGEMENT).optional().nullable(),
  plan_manager: z.object(contactRef).optional().nullable(),
  support_coordinator: z.object(contactRef).optional().nullable(),
  local_area_coordinator: z.object(contactRef).optional().nullable(),
  budgets: z
    .array(z.object({ id: z.string().uuid().optional().nullable(), name: z.string().trim().min(1).max(120), amount: z.number().min(0).max(1e9) }))
    .max(40)
    .optional(),
});
export type PlanInput = z.infer<typeof planInputSchema>;

export class PlanProblem extends Error {}

const roleTypes = (country: CountryCode, scheme: string): Record<'plan_manager' | 'support_coordinator' | 'local_area_coordinator', string> => ({
  plan_manager: 'Plan manager',
  support_coordinator: 'Support coordinator',
  // The local coordinator is a Local Area Coordinator in Australia, a social worker in the UK.
  local_area_coordinator: fundingScheme(country, scheme).area_coordinator ?? 'Case manager',
});

export async function savePlan(
  conn: Conn,
  opts: { profileId: string; actorId: string | null; planId?: string | null; input: Partial<PlanInput>; timeZone?: string | null }
): Promise<{ id: string; filed: Array<{ id: string; name: string }>; report_tasks: number }> {
  const { profileId, input } = opts;
  const before = opts.planId
    ? ((await conn('funding_plans').where({ id: opts.planId, care_profile_id: profileId }).first()) as Record<string, unknown> | undefined)
    : undefined;
  if (opts.planId && !before) throw new PlanProblem('That plan was not found.');
  const filed: Array<{ id: string; name: string }> = [];
  const cols: Record<string, unknown> = {};
  for (const k of ['scheme', 'starts_on', 'ends_on', 'review_on', 'management'] as const) {
    if (input[k] !== undefined) cols[k] = input[k];
  }
  const country = await profileCountry(conn, profileId);
  const ROLE_TYPES = roleTypes(country, String(input.scheme ?? before?.['scheme'] ?? 'other'));
  for (const role of ['plan_manager', 'support_coordinator', 'local_area_coordinator'] as const) {
    const ref = input[role];
    if (ref === undefined) continue;
    const r = ref ? await resolveContactInput(conn, profileId, { id: ref.id, name: ref.name, phone: ref.phone }, ROLE_TYPES[role], 'person') : { id: null, filed: null };
    if ('error' in r) throw new PlanProblem(r.error);
    if (r.filed) filed.push(r.filed);
    cols[`${role}_provider_id`] = r.id;
  }
  // Reports are due six weeks before the review, unless a day is given.
  const review = (cols['review_on'] ?? before?.['review_on'] ?? null) as string | null;
  if (input.reports_due_on !== undefined) cols['reports_due_on'] = input.reports_due_on ?? (review ? addDays(review, -REPORTS_LEAD_DAYS) : null);
  else if (input.review_on !== undefined) {
    // The review moved: a due day that was worked out moves with it.
    const oldReview = before?.['review_on'] as string | null | undefined;
    const oldDue = before?.['reports_due_on'] as string | null | undefined;
    const wasWorkedOut = !oldDue || (oldReview && oldDue === addDays(oldReview, -REPORTS_LEAD_DAYS));
    if (wasWorkedOut) cols['reports_due_on'] = review ? addDays(review, -REPORTS_LEAD_DAYS) : null;
  }
  const starts = (cols['starts_on'] ?? before?.['starts_on'] ?? null) as string | null;
  const ends = (cols['ends_on'] ?? before?.['ends_on'] ?? null) as string | null;
  if (starts && ends && ends < starts) throw new PlanProblem('Plan ends is before Plan starts. Check the two dates.');

  let id: string;
  if (before) {
    id = String(before['id']);
    if (Object.keys(cols).length) await conn('funding_plans').where({ id }).update({ ...cols, updated_at: conn.fn.now() });
  } else {
    if (!input.scheme) throw new PlanProblem('Say what kind of plan it is.');
    const [row] = await conn('funding_plans').insert({ care_profile_id: profileId, ...cols }).returning('id');
    id = (row as { id: string }).id;
  }
  if (input.budgets) await saveBudgets(conn, id, input.budgets);
  const report_tasks = await keepReportTasks(conn, { profileId, planId: id, actorId: opts.actorId, timeZone: opts.timeZone });
  return { id, filed, report_tasks };
}

async function saveBudgets(conn: Conn, planId: string, budgets: NonNullable<PlanInput['budgets']>) {
  const existing = (await conn('funding_budget_categories').where({ funding_plan_id: planId }).pluck('id')) as string[];
  const keep = new Set<string>();
  for (const [i, b] of budgets.entries()) {
    if (b.id && existing.includes(b.id)) {
      keep.add(b.id);
      await conn('funding_budget_categories').where({ id: b.id }).update({ name: b.name.trim(), amount: b.amount, sort_order: i });
    } else {
      const [row] = await conn('funding_budget_categories').insert({ funding_plan_id: planId, name: b.name.trim(), amount: b.amount, sort_order: i }).returning('id');
      keep.add((row as { id: string }).id);
    }
  }
  const drop = existing.filter((x) => !keep.has(x));
  if (drop.length) await conn('funding_budget_categories').whereIn('id', drop).delete();
}

/** The therapists linked to the person and still seen, who write progress reports. */
export async function reportWriters(conn: Conn, profileId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = (await conn('care_profile_providers as cpp')
    .join('providers as p', 'p.id', 'cpp.provider_id')
    .where('cpp.care_profile_id', profileId)
    .whereNull('cpp.ended_on')
    .select('p.id', 'p.name', 'p.provider_type')
    .orderBy('p.name', 'asc')) as Array<{ id: string; name: string; provider_type: string | null }>;
  return rows.filter((r) => REPORT_TYPE_SET.has(String(r.provider_type ?? '').toLowerCase()));
}

/**
 * One task per therapist to ask for their report, due when reports are due,
 * kept in step when the dates move. With no review day, the open ones go.
 */
export async function keepReportTasks(conn: Conn, opts: { profileId: string; planId: string; actorId: string | null; timeZone?: string | null }): Promise<number> {
  const plan = (await conn('funding_plans').where({ id: opts.planId }).first()) as Record<string, unknown>;
  const due = (plan['reports_due_on'] as string | null) ?? null;
  const scheme = fundingScheme(await profileCountry(conn, opts.profileId), plan['scheme'] as string).review_word;
  const tasks = (await conn('reminders').where({ care_profile_id: opts.profileId, funding_plan_id: opts.planId }).select('id', 'provider_id', 'completed', 'next_due_at')) as Array<{
    id: string;
    provider_id: string | null;
    completed: boolean;
    next_due_at: Date;
  }>;
  const zone = await ownerZone(conn, opts.profileId, opts.timeZone);
  const today = dateInZone(new Date(), zone);
  const review = (plan['review_on'] as string | null) ?? null;
  // The review has been and gone: nothing more to ask for it, and nothing moves.
  if (review && review < today) return tasks.filter((t) => !t.completed).length;
  const writers = due ? await reportWriters(conn, opts.profileId) : [];
  // Already past six weeks before the review: a new ask is due today, never in the past.
  const late = !!due && due < today;
  const wanted = new Set(writers.map((w) => w.id));
  for (const t of tasks) {
    if (!t.completed && (!t.provider_id || !wanted.has(t.provider_id))) await conn('reminders').where({ id: t.id }).delete();
  }
  const dayOf = (t: { next_due_at: Date }) => dateInZone(new Date(t.next_due_at), zone);
  let n = 0;
  for (const w of writers) {
    const theirs = tasks.filter((t) => t.provider_id === w.id);
    const open = theirs.find((t) => !t.completed);
    // Their report for this review is already in: nothing more to ask.
    if (!open && theirs.some((t) => t.completed && dayOf(t) >= due!)) {
      n++;
      continue;
    }
    // Late and already asked: the task keeps its day, so it shows as overdue
    // until it is done.
    if (late && open && dayOf(open) >= due!) {
      n++;
      continue;
    }
    await keepTask(conn, {
      profileId: opts.profileId,
      actorId: opts.actorId,
      taskId: open?.id ?? null,
      timeZone: opts.timeZone,
      want: {
        title: `Ask ${w.name} for a progress report for the ${scheme} review`,
        due_on: late ? today : due!,
        provider_id: w.id,
        kind_key: 'report',
        links: { funding_plan_id: opts.planId },
      },
    });
    n++;
  }
  return n;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Plans with their contacts, budgets with spent and left, and their report tasks. */
export async function plansOut(conn: Conn, profileId: string, rows: Array<Record<string, unknown> & { id: string }>, timeZone?: string | null) {
  if (rows.length === 0) return [];
  const zone = await ownerZone(conn, profileId, timeZone);
  const today = dateInZone(new Date(), zone);
  const country = await profileCountry(conn, profileId);
  const ids = rows.map((r) => r.id);
  const [budgets, contacts, tasks] = await Promise.all([
    conn('funding_budget_categories').whereIn('funding_plan_id', ids).orderBy('sort_order', 'asc'),
    contactSummaries(
      conn,
      rows.flatMap((r) => [r['plan_manager_provider_id'], r['support_coordinator_provider_id'], r['local_area_coordinator_provider_id']] as Array<string | null>),
      profileId
    ),
    conn('reminders as r')
      .leftJoin('providers as p', 'p.id', 'r.provider_id')
      .whereIn('r.funding_plan_id', ids)
      .orderBy('r.next_due_at', 'asc')
      .select('r.id', 'r.title', 'r.next_due_at', 'r.all_day', 'r.completed', 'r.completed_at', 'r.funding_plan_id', 'p.name as provider_name', 'p.phone as provider_phone'),
  ]);
  const budgetIds = (budgets as Array<{ id: string }>).map((b) => b.id);
  const spentRows = budgetIds.length
    ? ((await conn('health_spend_entries as e')
        .join('funding_budget_categories as b', 'b.id', 'e.funding_budget_category_id')
        .join('funding_plans as fp', 'fp.id', 'b.funding_plan_id')
        .whereIn('e.funding_budget_category_id', budgetIds)
        .where('e.status', 'confirmed')
        .whereRaw('(fp.starts_on IS NULL OR e.spent_on >= fp.starts_on) AND (fp.ends_on IS NULL OR e.spent_on <= fp.ends_on)')
        .groupBy('e.funding_budget_category_id')
        .select('e.funding_budget_category_id as id')
        .sum({ spent: 'e.amount' })) as Array<{ id: string; spent: string | number | null }>)
    : [];
  const spentById = new Map(spentRows.map((s) => [s.id, Number(s.spent ?? 0)]));
  return rows.map((r) => {
    const mine = (budgets as Array<Record<string, unknown> & { id: string; funding_plan_id: string }>)
      .filter((b) => b.funding_plan_id === r.id)
      .map((b) => {
        const amount = num(b['amount']) ?? 0;
        const spent = Math.round((spentById.get(b.id) ?? 0) * 100) / 100;
        return { id: b.id, name: b['name'], amount, spent, left: Math.round((amount - spent) * 100) / 100, sort_order: b['sort_order'] };
      });
    const c = (k: string) => (r[k] && contacts.get(r[k] as string)) || null;
    return {
      ...r,
      scheme_label: schemeLabel(country, r['scheme'] as string),
      management_label: managementLabel(country, r['scheme'] as string, (r['management'] as string | null) ?? null),
      area_coordinator_label: fundingScheme(country, r['scheme'] as string).area_coordinator,
      progress_report: fundingScheme(country, r['scheme'] as string).progress_report,
      reports_due_worked_out: !!(r['review_on'] && r['reports_due_on'] === addDays(r['review_on'] as string, -REPORTS_LEAD_DAYS)),
      // Past the day reports were due, the review still to come, and some reports still to come.
      reports_overdue:
        !!r['reports_due_on'] &&
        (r['reports_due_on'] as string) < today &&
        !(r['review_on'] && (r['review_on'] as string) < today) &&
        (tasks as Array<Record<string, unknown>>).some((t) => t['funding_plan_id'] === r.id && !t['completed']),
      plan_manager: c('plan_manager_provider_id'),
      support_coordinator: c('support_coordinator_provider_id'),
      local_area_coordinator: c('local_area_coordinator_provider_id'),
      budgets: mine,
      // Each task's due day where they live, so "overdue" is judged on their day.
      report_tasks: (tasks as Array<Record<string, unknown>>)
        .filter((t) => t['funding_plan_id'] === r.id)
        .map((t) => ({ ...t, due_on: dateInZone(new Date(t['next_due_at'] as Date), zone), overdue: !t['completed'] && dateInZone(new Date(t['next_due_at'] as Date), zone) < today })),
    };
  });
}
