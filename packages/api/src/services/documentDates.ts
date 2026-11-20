import type { Knex } from 'knex';
import { dateInZone, parseZonedTime } from '../lib/timezone';
import { isOrganisationType } from '../lib/providerTypes';
import { accountIdForProfile } from './documentCategories';
import { nextStepTypeIdByKey } from './nextStepTypes';
import { mainContact } from './professionals';
import { createTask, ownerZone } from './tasks';

type Conn = Knex | Knex.Transaction;

/**
 * A referral's dates, worked out so nobody has to know the rules. A GP's
 * referral to a specialist lasts 12 months, and a specialist's referral to
 * another specialist lasts 3, both counted from the first visit with the
 * specialist. Until a first visit is booked, the count starts on the date
 * the letter was written. A date a person or the letter gives always wins.
 *
 * Six weeks before it runs out, a "Get a new referral" task is waiting,
 * linked to the GP who writes the new one.
 */

/** Categories whose documents usually run out, so Valid until is asked for plainly. */
export const EXPIRING_CATEGORY_KEYS = ['referral', 'prescription', 'test_request', 'service_agreement', 'behaviour_support_plan'];

const RENEW_DAYS_BEFORE = 42;

export interface DocDates {
  id: string;
  care_profile_id: string;
  issued_on: string | Date | null;
  valid_from: string | Date | null;
  valid_from_appointment_id: string | null;
  valid_until: string | Date | null;
  no_expiry: boolean;
  valid_until_worked_out: boolean;
  from_provider_id: string | null;
  to_provider_id: string | null;
  renewal_task_id: string | null;
  category_key: string | null;
}

const ymd = (v: string | Date | null | undefined): string | null => {
  if (!v) return null;
  if (v instanceof Date) {
    // Date columns come back as local midnight; read the calendar day back.
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
};

/** The same day some months on, clamped to the end of a shorter month. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const t = new Date(`${day}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const formatDay = (day: string): string =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

async function loadDoc(conn: Conn, docId: string): Promise<DocDates | undefined> {
  return (await conn('documents as d')
    .leftJoin('document_categories as dc', 'dc.id', 'd.category_id')
    .where('d.id', docId)
    .first('d.*', 'dc.system_key as category_key')) as DocDates | undefined;
}

const isGpType = (type: string | null | undefined): boolean => {
  const t = String(type ?? '').trim().toLowerCase();
  return t === 'gp' || t === 'general practitioner' || t === 'doctor';
};

/** Who wrote a referral, and so how long it lasts: a GP, a practice or unknown is 12 months; another specialist 3. */
async function writer(conn: Conn, providerId: string | null): Promise<{ id: string; name: string; isGp: boolean; months: number } | null> {
  if (!providerId) return null;
  const p = (await conn('providers').where({ id: providerId }).first('id', 'name', 'provider_type')) as
    | { id: string; name: string; provider_type: string | null }
    | undefined;
  if (!p) return null;
  const type = String(p.provider_type ?? '').trim().toLowerCase();
  const gpLike = isGpType(type) || !type || type === 'other' || isOrganisationType(type);
  return { id: p.id, name: p.name, isGp: isGpType(type), months: gpLike ? 12 : 3 };
}

/** How long a referral lasts and where the count starts, in a sentence for the screen. */
export async function validityNote(conn: Conn, doc: DocDates): Promise<string | null> {
  if (doc.category_key !== 'referral' || doc.no_expiry) return null;
  if (!ymd(doc.issued_on) && !ymd(doc.valid_until)) return 'Add the date it was written, and the date it runs out is worked out for you.';
  if (!doc.valid_until_worked_out) return null;
  const w = await writer(conn, doc.from_provider_id);
  const rule = (w?.months ?? 12) === 12
    ? 'a GP referral lasts 12 months from the first visit'
    : 'a referral from a specialist lasts 3 months from the first visit';
  if (doc.valid_from_appointment_id) return `Worked out: ${rule}.`;
  return `Worked out: ${rule}. The first visit is not booked yet, so it counts from the date written for now.`;
}

/**
 * Work a referral's dates out, when a person has not set them: valid from
 * the first visit with whoever it is to (booked or been to), else the date
 * written, for 12 months or 3. Then keep its renewal task in step.
 */
export async function referralValidity(conn: Conn, docId: string, opts: { dateChanged?: boolean } = {}): Promise<void> {
  const doc = await loadDoc(conn, docId);
  if (!doc) return;
  const before = ymd(doc.valid_until);
  const issued = ymd(doc.issued_on);
  const ours = doc.category_key === 'referral' && !!issued && !doc.no_expiry && (!before || doc.valid_until_worked_out);
  if (ours) {
    const w = await writer(conn, doc.from_provider_id);
    const months = w?.months ?? 12;
    let fromDay = issued!;
    let fromAppt: string | null = null;
    if (doc.to_provider_id) {
      const zone = await ownerZone(conn, doc.care_profile_id);
      const visits = (await conn('appointments')
        .where({ care_profile_id: doc.care_profile_id, provider_id: doc.to_provider_id })
        .whereIn('status', ['scheduled', 'completed'])
        .whereNotNull('starts_at')
        .orderBy('starts_at', 'asc')
        .select('id', 'starts_at')) as Array<{ id: string; starts_at: Date }>;
      const first = visits.find((v) => dateInZone(new Date(v.starts_at), zone) >= issued!);
      if (first) {
        fromDay = dateInZone(new Date(first.starts_at), zone);
        fromAppt = first.id;
      }
    }
    const until = addDays(addMonths(fromDay, months), -1);
    await conn('documents').where({ id: doc.id }).update({
      valid_from: fromDay,
      valid_from_appointment_id: fromAppt,
      valid_until: until,
      valid_until_worked_out: true,
    });
    await syncRenewalTask(conn, doc.id, { dateChanged: opts.dateChanged || until !== before });
    return;
  }
  await syncRenewalTask(conn, doc.id, { dateChanged: !!opts.dateChanged });
}

/** Re-work every referral on a person whose dates were worked out, after a visit is booked, moved or cancelled. */
export async function refreshReferrals(conn: Conn, profileId: string): Promise<void> {
  const ids = (await conn('documents as d')
    .join('document_categories as dc', 'dc.id', 'd.category_id')
    .where({ 'd.care_profile_id': profileId, 'dc.system_key': 'referral', 'd.no_expiry': false })
    .whereNotNull('d.issued_on')
    .where((w) => w.whereNull('d.valid_until').orWhere('d.valid_until_worked_out', true))
    .pluck('d.id')) as string[];
  for (const id of ids) await referralValidity(conn, id);
}

/** 9am on the day, where they live; never in the past. */
function nineAm(day: string, zone: string | null): Date {
  const at = parseZonedTime(`${day}T09:00:00`, zone) ?? new Date(`${day}T09:00:00Z`);
  return at.getTime() < Date.now() ? new Date() : at;
}

/**
 * One "Get a new referral" task per referral that runs out: due six weeks
 * before, with the GP who writes the new one and the letter attached. It
 * moves with the date. Once done or deleted it is left alone, unless the
 * date itself changes, which earns a fresh one.
 */
export async function syncRenewalTask(conn: Conn, docId: string, opts: { dateChanged?: boolean } = {}): Promise<void> {
  const doc = await loadDoc(conn, docId);
  if (!doc) return;
  const until = ymd(doc.valid_until);
  const task = doc.renewal_task_id
    ? ((await conn('reminders').where({ id: doc.renewal_task_id }).first('id', 'completed')) as { id: string; completed: boolean } | undefined)
    : undefined;
  if (doc.category_key !== 'referral' || !until || doc.no_expiry) {
    // It no longer runs out: an open renewal task is not needed.
    if (task && !task.completed) {
      await conn('documents').where({ id: doc.id }).update({ renewal_task_id: null });
      await conn('reminders').where({ id: task.id }).delete();
    }
    return;
  }
  const zone = await ownerZone(conn, doc.care_profile_id);
  const w = await writer(conn, doc.from_provider_id);
  const gp = w?.isGp ? { id: w.id, name: w.name } : await mainContact(conn, doc.care_profile_id, 'gp').then((c) => (c?.id ? { id: c.id, name: c.name } : null));
  const to = doc.to_provider_id ? ((await conn('providers').where({ id: doc.to_provider_id }).first('name')) as { name: string } | undefined) : undefined;
  const title = to?.name ? `Get a new referral for ${to.name}` : 'Get a new referral';
  const from = w?.name ? `The referral from ${w.name}` : 'The referral';
  const body = `${from} runs out on ${formatDay(until)}. Book ${gp?.name ?? 'their GP'} before then for a new one.`;
  const due = nineAm(addDays(until, -RENEW_DAYS_BEFORE), zone);

  if (task && !task.completed) {
    await conn('reminders').where({ id: task.id }).update({
      title: title.slice(0, 255),
      body,
      next_due_at: due,
      all_day: false,
      ...(gp ? { provider_id: gp.id } : {}),
    });
    return;
  }
  if (!opts.dateChanged) return;

  const accountId = (await accountIdForProfile(doc.care_profile_id, conn))!;
  const created = await createTask(conn, {
    profileId: doc.care_profile_id,
    actorId: null,
    input: {
      title: title.slice(0, 255),
      body,
      next_due_at: due.toISOString(),
      provider_id: gp?.id ?? null,
      next_step_type_id: await nextStepTypeIdByKey(accountId, 'referral', conn),
      document_ids: [doc.id],
      no_join: true,
      no_infer: true,
    },
  });
  await conn('documents').where({ id: doc.id }).update({ renewal_task_id: created.reminder.id });
}

