import type { Knex } from 'knex';
import { ruleFor } from '../lib/repeat';
import { dateInZone, hmInZone } from '../lib/timezone';
import { ownerZone } from './tasks';
import { addDays, addMonths } from './documentDates';

type Conn = Knex | Knex.Transaction;

/**
 * The roster: who does which repeating task on each day of a week. Worked
 * out from the repeating tasks themselves, so assigning a repeating task to
 * someone puts them on the roster, and changing it changes the roster.
 */

export interface RosterItem {
  task_id: string;
  title: string;
  date: string;
  /** HH:MM, or null for any time that day. */
  time: string | null;
}

export interface RosterPerson {
  key: string;
  name: string;
  /** Someone added by name, a member with a login, the account holder, or nobody yet. */
  who: 'circle' | 'account' | 'anyone';
  items: RosterItem[];
}

function parse(rule: string): { freq: string; interval: number } | null {
  const parts = Object.fromEntries(rule.split(';').map((p) => p.split('=').map((s) => s.trim().toUpperCase()) as [string, string]));
  const freq = parts['FREQ'];
  if (!freq) return null;
  return { freq, interval: Math.max(1, Number(parts['INTERVAL'] ?? 1) || 1) };
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);

/** The days in [from, from + 7) a task falls on, by its rule, from the day it is next due. */
export function occurrencesInWeek(anchorDay: string, rule: string, from: string, notBefore: string): string[] {
  const r = parse(rule);
  if (!r) return [];
  const to = addDays(from, 7);
  const out: string[] = [];
  if (r.freq === 'DAILY' || r.freq === 'WEEKLY') {
    const step = r.interval * (r.freq === 'WEEKLY' ? 7 : 1);
    const k = Math.ceil(dayDiff(from, anchorDay) / step);
    for (let d = addDays(anchorDay, k * step); d < to; d = addDays(d, step)) {
      if (d >= from && d >= notBefore) out.push(d);
    }
    return out;
  }
  const months = r.interval * (r.freq === 'YEARLY' ? 12 : 1);
  // Step a whole number of periods from the anchor to land near the week.
  const [ay, am] = anchorDay.split('-').map(Number) as [number, number];
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const gap = (fy - ay) * 12 + (fm - am);
  const k = Math.floor(gap / months);
  for (const n of [k - 1, k, k + 1]) {
    const d = addMonths(anchorDay, n * months);
    if (d >= from && d < to && d >= notBefore && !out.includes(d)) out.push(d);
  }
  return out.sort();
}

/** Monday of the week a day falls in. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

export async function rosterFor(conn: Conn, profileId: string, week: string | null) {
  const zone = await ownerZone(conn, profileId);
  const from = weekStart(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : dateInZone(new Date(), zone));
  const tasks = (await conn('reminders as r')
    .leftJoin('care_circle_members as m', 'm.id', 'r.assigned_to')
    .leftJoin('accounts as acc', 'acc.id', 'r.assigned_account_id')
    .where({ 'r.care_profile_id': profileId, 'r.completed': false })
    .whereNull('r.merged_into_id')
    .where((w) => w.whereNotNull('r.rrule').orWhereNot('r.reminder_type', 'once'))
    .select('r.id', 'r.title', 'r.next_due_at', 'r.all_day', 'r.rrule', 'r.reminder_type', 'r.created_at', 'r.assigned_to', 'r.assigned_account_id', 'm.display_name as member_name', 'acc.display_name as account_name')
    .orderBy('r.title', 'asc')) as Array<{
    id: string;
    title: string;
    next_due_at: Date;
    all_day: boolean;
    rrule: string | null;
    reminder_type: string;
    created_at: Date;
    assigned_to: string | null;
    assigned_account_id: string | null;
    member_name: string | null;
    account_name: string | null;
  }>;
  const people = new Map<string, RosterPerson>();
  for (const t of tasks) {
    const rule = ruleFor(t);
    if (!rule) continue;
    const due = new Date(t.next_due_at);
    const anchor = dateInZone(due, zone);
    const days = occurrencesInWeek(anchor, rule, from, dateInZone(new Date(t.created_at), zone));
    if (days.length === 0) continue;
    const key = t.assigned_to ? `m:${t.assigned_to}` : t.assigned_account_id ? `a:${t.assigned_account_id}` : 'anyone';
    const person = people.get(key) ?? {
      key,
      name: t.member_name ?? t.account_name ?? 'Anyone',
      who: t.assigned_to ? 'circle' : t.assigned_account_id ? 'account' : 'anyone',
      items: [],
    };
    for (const d of days) person.items.push({ task_id: t.id, title: t.title, date: d, time: t.all_day ? null : hmInZone(due, zone) });
    people.set(key, person);
  }
  const list = [...people.values()].sort((a, b) => (a.who === 'anyone' ? 1 : b.who === 'anyone' ? -1 : a.name.localeCompare(b.name)));
  return {
    week_start: from,
    days: Array.from({ length: 7 }, (_, i) => addDays(from, i)),
    people: list,
    // Someone is on it only once a repeating task is assigned to them.
    anyone_assigned: list.some((p) => p.who !== 'anyone'),
  };
}
