import type { Knex } from 'knex';
import { db } from '../config/database';
import { createTask, updateTask } from './tasks';
import { mainContact } from './professionals';
import { addDays } from './documentDates';
import { todayFor } from './medicationChanges';
import type { RepeatChoice } from '../lib/repeat';

type Conn = Knex | Knex.Transaction;

/**
 * Suggested reminders: the yearly and six-monthly checks people forget, by
 * age and conditions. Each one is offered until it is added as a repeating
 * task, or a repeating task like it is already open, or it is dismissed.
 */

export interface RecallRule {
  key: string;
  /** What the card says. */
  line: string;
  /** The task it adds. */
  title: string;
  repeat: RepeatChoice;
  /** Who it is booked with. */
  with_gp: boolean;
  /** A task already open with words like these covers it. */
  covers: RegExp;
  applies: (p: { age: number | null; chronic: boolean }) => boolean;
  /** When the first one is due, from today. */
  firstDue: (today: string) => string;
}

/** Flu shots are given from April: in season, within the week; otherwise next April. */
const fluDue = (today: string): string => {
  const [y, m] = today.split('-').map(Number) as [number, number];
  if (m >= 4 && m <= 6) return addDays(today, 7);
  return `${m < 4 ? y : y + 1}-04-01`;
};

export const RECALL_RULES: RecallRule[] = [
  {
    key: 'flu',
    line: 'Flu shot, every year from April',
    title: 'Book flu shot',
    repeat: 'yearly',
    with_gp: true,
    covers: /\bflu\b|influenza/i,
    applies: (p) => (p.age != null && p.age >= 65) || p.chronic,
    firstDue: fluDue,
  },
  {
    key: 'health_check_75',
    line: 'Health check for people 75 and over, every year',
    title: 'Book the 75+ health check',
    repeat: 'yearly',
    with_gp: true,
    covers: /health (check|assessment)|75\s*\+/i,
    applies: (p) => p.age != null && p.age >= 75,
    firstDue: (t) => addDays(t, 14),
  },
  {
    key: 'gp_management_plan',
    line: 'GP management plan review, every 6 months',
    title: 'Book a GP management plan review',
    repeat: 'six_monthly',
    with_gp: true,
    covers: /management plan|\bgpmp\b|chronic (disease|condition) (plan|review)/i,
    applies: (p) => p.chronic,
    firstDue: (t) => addDays(t, 14),
  },
  {
    key: 'dental',
    line: 'Dental check, every year',
    title: 'Book a dental check',
    repeat: 'yearly',
    with_gp: false,
    covers: /\bdental\b|\bdentist\b/i,
    applies: () => true,
    firstDue: (t) => addDays(t, 30),
  },
  {
    key: 'eye_test',
    line: 'Eye test, every year',
    title: 'Book an eye test',
    repeat: 'yearly',
    with_gp: false,
    covers: /\beye (test|check|exam)|optometrist|ophthalmologist/i,
    applies: (p) => p.age != null && p.age >= 65,
    firstDue: (t) => addDays(t, 30),
  },
  {
    key: 'licence_medical',
    line: "Driver's licence medical, every year if their licence needs one",
    title: "Book the driver's licence medical",
    repeat: 'yearly',
    with_gp: true,
    covers: /licen[cs]e/i,
    applies: (p) => p.age != null && p.age >= 75,
    firstDue: (t) => addDays(t, 30),
  },
];

export const recallKey = (profileId: string, rule: string) => `recall:${profileId}:${rule}`;

function ageOn(dob: string | null, today: string): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

async function personFacts(conn: Conn, profileId: string) {
  const p = (await conn('care_profiles').where({ id: profileId }).first('id', 'kind', 'date_of_birth', 'died_on')) as
    | { id: string; kind: string; date_of_birth: string | null; died_on: string | null }
    | undefined;
  if (!p) return null;
  const today = await todayFor(conn, profileId);
  // A long-term condition still being treated; a neurotype is not one.
  const chronic = !!(await conn('medical_conditions')
    .where({ care_profile_id: profileId })
    .whereIn('status', ['active', 'managed'])
    .where((w) => w.whereNull('category').orWhereNot('category', 'neurotype'))
    .first('id'));
  return { ...p, today, age: ageOn(p.date_of_birth, today), chronic };
}

export interface RecallSuggestion {
  rule: string;
  line: string;
  title: string;
  repeat: RepeatChoice;
  due_on: string;
  key: string;
}

/** What to suggest for this person, for this viewer. */
export async function recallsFor(conn: Conn, profileId: string, accountId: string): Promise<RecallSuggestion[]> {
  const p = await personFacts(conn, profileId);
  if (!p || p.kind === 'pet' || p.died_on) return [];
  const repeating = (await conn('reminders')
    .where({ care_profile_id: profileId, completed: false })
    .whereNull('merged_into_id')
    .where((w) => w.whereNotNull('rrule').orWhereNot('reminder_type', 'once'))
    .pluck('title')) as string[];
  const dismissed = new Set(
    (await conn('attention_dismissals').where({ account_id: accountId }).where('item_key', 'like', `recall:${profileId}:%`).pluck('item_key')) as string[]
  );
  return RECALL_RULES.filter((r) => r.applies(p))
    .filter((r) => !repeating.some((t) => r.covers.test(t)))
    .filter((r) => !dismissed.has(recallKey(profileId, r.key)))
    .map((r) => ({ rule: r.key, line: r.line, title: r.title, repeat: r.repeat, due_on: r.firstDue(p.today), key: recallKey(profileId, r.key) }));
}

/**
 * Add a suggestion as a repeating task. An open one-off task for the same
 * check ("Book flu shot") becomes the repeating one, so there is one task.
 */
export async function addRecall(
  conn: Conn,
  opts: { profileId: string; actorId: string; rule: string; timeZone?: string | null }
): Promise<{ id: string; title: string; repeat: RepeatChoice; joined: boolean } | null> {
  const rule = RECALL_RULES.find((r) => r.key === opts.rule);
  if (!rule) return null;
  const p = await personFacts(conn, opts.profileId);
  if (!p) return null;
  const open = (await conn('reminders')
    .where({ care_profile_id: opts.profileId, completed: false })
    .whereNull('merged_into_id')
    .orderBy('next_due_at', 'asc')
    .select('id', 'title')) as Array<{ id: string; title: string }>;
  const same = open.find((t) => rule.covers.test(t.title));
  if (same) {
    await updateTask(conn, { profileId: opts.profileId, taskId: same.id, input: { repeat: rule.repeat }, timeZone: opts.timeZone });
    await linkJourneyStep(conn, opts.profileId, rule, same.id);
    return { id: same.id, title: same.title, repeat: rule.repeat, joined: true };
  }
  const gp = rule.with_gp ? await mainContact(conn, opts.profileId, 'gp') : null;
  const made = await createTask(conn, {
    profileId: opts.profileId,
    actorId: opts.actorId,
    timeZone: opts.timeZone,
    input: {
      title: rule.title,
      due_on: rule.firstDue(p.today),
      repeat: rule.repeat,
      provider_id: gp?.id ?? null,
      kind: rule.key === 'flu' ? 'Vaccination' : null,
      no_infer: true,
      no_join: true,
    },
  });
  await linkJourneyStep(conn, opts.profileId, rule, made.reminder.id);
  return { id: made.reminder.id, title: made.reminder.title, repeat: rule.repeat, joined: false };
}

/**
 * A journey step for the same check ("Book the over seventy five health
 * assessment") is carried out by the repeating task, so the step shows its
 * due date and repeat, and ticking one ticks the other.
 */
async function linkJourneyStep(conn: Conn, profileId: string, rule: RecallRule, taskId: string): Promise<void> {
  const task = (await conn('reminders').where({ id: taskId }).first('checklist_item_id')) as { checklist_item_id: string | null } | undefined;
  if (!task || task.checklist_item_id) return;
  const steps = (await conn('checklist_items as ci')
    .join('care_journey_phases as p', 'ci.care_journey_phase_id', 'p.id')
    .join('care_journeys as j', 'p.care_journey_id', 'j.id')
    .where({ 'ci.care_profile_id': profileId, 'ci.completed': false })
    .whereIn('j.status', ['active', 'paused'])
    .whereNotNull('p.entered_at')
    .whereNull('p.locked_at')
    .whereNotExists((q) => q.select(1).from('reminders as r').whereRaw('r.checklist_item_id = ci.id'))
    .select('ci.id', 'ci.title')) as Array<{ id: string; title: string }>;
  const step = steps.find((s) => rule.covers.test(s.title));
  if (step) await conn('reminders').where({ id: taskId }).update({ checklist_item_id: step.id });
}

export async function dismissRecall(accountId: string, profileId: string, rule: string): Promise<void> {
  await db('attention_dismissals').insert({ account_id: accountId, item_key: recallKey(profileId, rule) }).onConflict(['account_id', 'item_key']).ignore();
}
