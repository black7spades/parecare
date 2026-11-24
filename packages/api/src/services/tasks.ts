import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../config/database';
import { accountIdForProfile, withCategory } from './documentCategories';
import { nextStepTypeIdByKey, resolveNextStepTypeByName, stepBooks } from './nextStepTypes';
import { contactSummaries, ensureProfessional, linkContact, type ContactSummary } from './professionals';
import { parseZonedTime, isValidTimeZone } from '../lib/timezone';
import { REPEAT_CHOICE_VALUES, advance, nextAfter, repeatChoice, repeatColumns, ruleFor, withMonthDay } from '../lib/repeat';
import { findPhones, phoneDigits, typeWordIn } from '../lib/phoneText';
import { providerTypeLabel } from '../lib/providerTypes';

type Conn = Knex | Knex.Transaction;

/**
 * Tasks are written in one place. The task form, the outcome form's next
 * steps, the to-do an unbooked appointment waits on, Pare and the document
 * reader all come through here, so a task made anywhere knows who it is with,
 * what it is for and whether it books, and two tasks for one booking become
 * one.
 */

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(255),
  body: z.string().max(5000).optional().nullable(),
  // A set time, or a day with any time on it.
  next_due_at: z.string().datetime().optional().nullable(),
  due_on: dateOnly.optional().nullable(),
  all_day: z.boolean().optional(),
  tz: z.string().max(64).optional().nullable(),
  repeat: z.enum(REPEAT_CHOICE_VALUES).optional(),
  // Older callers still send these.
  reminder_type: z.enum(['once', 'daily', 'weekly', 'monthly', 'yearly']).optional(),
  rrule: z.string().max(255).optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  assigned_account_id: z.string().uuid().optional().nullable(),
  desired_outcome: z.string().max(2000).optional().nullable(),
  // Who it is with: someone linked to this person, or a new name filed in Contacts.
  provider_id: z.string().uuid().optional().nullable(),
  provider_name: z.string().trim().max(255).optional().nullable(),
  provider_type: z.string().trim().max(100).optional().nullable(),
  provider_phone: z.string().trim().max(50).optional().nullable(),
  // What kind of task: a next step kind by id, or by name.
  next_step_type_id: z.string().uuid().optional().nullable(),
  kind: z.string().trim().max(100).optional().nullable(),
  medical_condition_id: z.string().uuid().optional().nullable(),
  appointment_id: z.string().uuid().optional().nullable(),
  document_ids: z.array(z.string().uuid()).max(50).optional(),
  // The journey item this task carries out.
  checklist_item_id: z.string().uuid().optional().nullable(),
  no_infer: z.boolean().optional(),
  no_join: z.boolean().optional(),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export class TaskProblem extends Error {
  constructor(message: string, public code = 'VALIDATION_ERROR') {
    super(message);
  }
}

const BOOKING_TITLE = /^\s*(book|see|make an appointment)\b/i;

/** Whether a task is done by booking an appointment. */
export const taskBooks = (title: string, kindKey: string | null | undefined): boolean =>
  stepBooks(kindKey ?? null) || BOOKING_TITLE.test(title);

/** Words for a test or a shot, and the kind of task each is. */
const KIND_WORDS: Array<{ re: RegExp; key: string }> = [
  { re: /\bblood tests?\b|\bbloods\b|\bpathology\b/i, key: 'blood_test' },
  { re: /\bx-?rays?\b/i, key: 'xray' },
  { re: /\bultrasound\b/i, key: 'ultrasound' },
  { re: /\bct( scan)?\b/i, key: 'ct_scan' },
  { re: /\bmri\b/i, key: 'mri_scan' },
  { re: /\becg\b|\bholter\b|\bheart (rhythm )?test\b/i, key: 'heart_test' },
  { re: /\bbiopsy\b/i, key: 'biopsy' },
  { re: /\bhearing test\b|\baudiolog/i, key: 'hearing_test' },
  { re: /\beye test\b/i, key: 'eye_test' },
  { re: /\bflu shot\b|\bvaccin|\bimmunis|\bimmuniz|\bjab\b|\bbooster\b/i, key: 'vaccination' },
];

const SPECIALIST_TYPES = /ologist$|iatrist$|iatrician$|^surgeon$|^specialist$/i;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A name or word appears whole, never as part of another word ("Ann" is not in "annual"). */
const hasWords = (text: string, words: string) => !!words && new RegExp(`(^|[^a-z0-9])${escapeRe(words)}($|[^a-z0-9])`, 'i').test(text);
const TITLE_WORD = /^(dr|prof|professor|mr|mrs|ms|miss|mx|sister)\.?\s+/i;

interface LinkedContact { id: string; name: string; provider_type: string | null; phone: string | null; also_known_as: string[] | null }

async function linkedContacts(conn: Conn, profileId: string): Promise<LinkedContact[]> {
  return (await conn('care_profile_providers as cpp')
    .join('providers as p', 'cpp.provider_id', 'p.id')
    .where('cpp.care_profile_id', profileId)
    .select('p.id', 'p.name', 'p.provider_type', 'p.phone', 'p.also_known_as')) as LinkedContact[];
}

const typeMatches = (stored: string | null, word: string) => {
  const label = (providerTypeLabel(stored) ?? '').toLowerCase();
  const w = word.toLowerCase();
  return label === w || (w === 'pharmacy' && /pharm|chemist/.test(label));
};

/**
 * Work out who and what a task is about from its words. A contact named in
 * the title or notes, a contact whose number the notes hold, or the only
 * contact of a kind the title names ("OT" for an occupational therapist)
 * sets who. A test or a shot, or booking a specialist, sets the kind. Never
 * links someone of a different kind from the one the title names.
 */
export async function inferTaskIntent(
  conn: Conn,
  profileId: string,
  accountId: string,
  text: { title: string; body?: string | null }
): Promise<{ providerId: string | null; kindTypeId: string | null; kindKey: string | null }> {
  const title = text.title ?? '';
  const all = `${title}\n${text.body ?? ''}`;
  const lower = norm(all);
  const titleType = typeWordIn(title);
  const contacts = await linkedContacts(conn, profileId);
  const fits = (c: LinkedContact) => !titleType || typeMatches(c.provider_type, titleType) || !c.provider_type || c.provider_type === 'other';

  const unique = (list: LinkedContact[]) => (list.length === 1 ? list[0]! : null);
  const byName = unique(
    contacts.filter((c) => {
      if (!fits(c)) return false;
      const names = [c.name, ...(c.also_known_as ?? [])].map(norm);
      return names.some((n) => {
        const bare = n.replace(TITLE_WORD, '');
        if (hasWords(lower, n) || (bare.split(' ').length > 1 && hasWords(lower, bare))) return true;
        // "Dr Chen" names Dr Anna Chen.
        const t = n.match(TITLE_WORD);
        const last = bare.split(' ').pop();
        return !!t && !!last && last.length > 1 && new RegExp(`\\b${escapeRe(t[1]!)}\\.?\\s+${escapeRe(last)}($|[^a-z0-9])`, 'i').test(all);
      });
    })
  );
  const phonesInText = new Set(findPhones(all).map((p) => phoneDigits(p.text)));
  const byPhone = byName ? null : unique(contacts.filter((c) => fits(c) && c.phone && phonesInText.has(phoneDigits(c.phone))));
  const byType = byName || byPhone || !titleType ? null : unique(contacts.filter((c) => typeMatches(c.provider_type, titleType)));
  const who = byName ?? byPhone ?? byType;

  let kindKey: string | null = KIND_WORDS.find((k) => k.re.test(title))?.key ?? null;
  if (!kindKey && BOOKING_TITLE.test(title)) {
    const whoType = who ? providerTypeLabel(who.provider_type) : null;
    const t = titleType ?? whoType;
    if (t && SPECIALIST_TYPES.test(t)) kindKey = 'referral';
  }
  const kindTypeId = kindKey ? await nextStepTypeIdByKey(accountId, kindKey, conn) : null;
  return { providerId: who?.id ?? null, kindTypeId, kindKey };
}

/**
 * The open task on this person that is the same booking job, oldest first.
 * Same contact; or no contact and its words name the contact or what they
 * do; or the same kind of booking with no contact on either.
 */
export async function findSameBookingTask(
  conn: Conn,
  profileId: string,
  c: { providerId?: string | null; providerName?: string | null; providerType?: string | null; kindKey?: string | null; title: string; excludeIds?: string[] }
): Promise<{ id: string; title: string } | null> {
  const rows = (await conn('reminders as r')
    .leftJoin('next_step_types as t', 'r.next_step_type_id', 't.id')
    .where({ 'r.care_profile_id': profileId, 'r.completed': false })
    .whereNull('r.merged_into_id')
    .whereNull('r.stopped_by_death_at')
    .where('r.created_at', '>', new Date(Date.now() - 365 * 24 * 3600 * 1000))
    // A "Get a new referral" reminder is its own job, never joined by a booking with the GP.
    .whereNotExists((q) => q.select(1).from('documents').whereRaw('documents.renewal_task_id = r.id'))
    .modify((q) => { if (c.excludeIds?.length) void q.whereNotIn('r.id', c.excludeIds); })
    .orderBy('r.created_at', 'asc')
    .select('r.id', 'r.title', 'r.body', 'r.provider_id', 't.system_key')) as Array<{
    id: string; title: string; body: string | null; provider_id: string | null; system_key: string | null;
  }>;
  const name = c.providerName ? norm(c.providerName) : '';
  const bareName = name.replace(TITLE_WORD, '');
  const typeWord = c.providerType ? (providerTypeLabel(c.providerType) ?? '').toLowerCase() : '';
  for (const r of rows) {
    if (!taskBooks(r.title, r.system_key)) continue;
    if (c.providerId && r.provider_id === c.providerId) return r;
    if (r.provider_id) continue;
    const words = norm(`${r.title} ${r.body ?? ''}`);
    if (name && (hasWords(words, name) || (bareName.includes(' ') && hasWords(words, bareName)))) return r;
    if (typeWord && typeWord !== 'other' && new RegExp(`\\b${typeWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(words)) return r;
    if (!c.providerId && c.kindKey && r.system_key === c.kindKey) return r;
  }
  return null;
}

export interface JoinResult {
  id: string;
  title: string;
  /** What the existing task had before, so "Keep them separate" can put it back. */
  previous: Record<string, unknown>;
  note_id: string | null;
  document_ids: string[];
}

const JOIN_FILLS = ['provider_id', 'next_step_type_id', 'medical_condition_id', 'appointment_id'] as const;

/**
 * Join a new booking into the open task already doing it: empty details are
 * filled, the earlier due date is kept, anything new is noted, and documents
 * are linked.
 */
export async function joinTask(
  conn: Conn,
  opts: {
    profileId: string;
    intoId: string;
    actorId: string | null;
    fields: Partial<Record<(typeof JOIN_FILLS)[number], string | null>> & { next_due_at?: Date | null; all_day?: boolean };
    note?: string | null;
    documentIds?: string[];
  }
): Promise<JoinResult> {
  const existing = (await conn('reminders').where({ id: opts.intoId, care_profile_id: opts.profileId }).first()) as Record<string, unknown> & { id: string; title: string };
  const update: Record<string, unknown> = {};
  const previous: Record<string, unknown> = {};
  for (const f of JOIN_FILLS) {
    const v = opts.fields[f];
    if (v && !existing[f]) {
      update[f] = v;
      previous[f] = null;
    }
  }
  if (opts.fields.next_due_at && new Date(opts.fields.next_due_at) < new Date(existing['next_due_at'] as string)) {
    update['next_due_at'] = opts.fields.next_due_at;
    previous['next_due_at'] = existing['next_due_at'];
    update['all_day'] = !!opts.fields.all_day;
    previous['all_day'] = existing['all_day'];
  }
  if (Object.keys(update).length) await conn('reminders').where({ id: existing.id }).update(update);
  let noteId: string | null = null;
  if (opts.note?.trim()) {
    const [n] = await conn('record_notes')
      .insert({ care_profile_id: opts.profileId, entity_type: 'reminders', entity_id: existing.id, body: opts.note.trim().slice(0, 4000), author_account_id: opts.actorId })
      .returning('id');
    noteId = (n as { id: string }).id;
  }
  const linked = await linkDocuments(conn, opts.profileId, existing.id, opts.documentIds ?? []);
  return { id: existing.id, title: existing.title, previous, note_id: noteId, document_ids: linked };
}

/** Link documents on file to a task; returns the ones newly linked. */
export async function linkDocuments(conn: Conn, profileId: string, taskId: string, documentIds: string[]): Promise<string[]> {
  if (documentIds.length === 0) return [];
  const docs = (await conn('documents').where({ care_profile_id: profileId }).whereIn('id', documentIds).pluck('id')) as string[];
  const have = new Set((await conn('document_links').where({ entity_type: 'reminders', entity_id: taskId }).pluck('document_id')) as string[]);
  const fresh = docs.filter((d) => !have.has(d));
  if (fresh.length) {
    await conn('document_links')
      .insert(fresh.map((d) => ({ document_id: d, entity_type: 'reminders', entity_id: taskId })))
      .onConflict(['document_id', 'entity_type', 'entity_id'])
      .ignore();
  }
  return fresh;
}

/** When a task is due, from a set time or a day, with whether any time that day will do. */
export function resolveDue(input: Pick<TaskInput, 'next_due_at' | 'due_on' | 'all_day' | 'tz'>, fallbackZone?: string | null): { next_due_at: Date; all_day: boolean } | null {
  const zone = isValidTimeZone(input.tz) ? input.tz : isValidTimeZone(fallbackZone) ? fallbackZone : null;
  if (input.due_on) {
    // Midnight that day where they live; with no zone known, midnight UTC,
    // never the server's own clock.
    const at = (zone ? parseZonedTime(`${input.due_on}T00:00:00`, zone) : null) ?? new Date(`${input.due_on}T00:00:00Z`);
    return { next_due_at: at, all_day: true };
  }
  if (input.next_due_at) return { next_due_at: new Date(input.next_due_at), all_day: input.all_day ?? false };
  return null;
}

function repeatFrom(input: Pick<TaskInput, 'repeat' | 'reminder_type' | 'rrule'>): { reminder_type: string; rrule: string | null } | null {
  if (input.repeat) return repeatColumns(input.repeat);
  if (input.reminder_type) {
    const cols = repeatColumns(input.reminder_type);
    return { reminder_type: cols.reminder_type, rrule: input.rrule ?? cols.rrule };
  }
  return null;
}

/** Where the person's account holder lives, for whole-day dates. */
export async function ownerZone(conn: Conn, profileId: string, given?: string | null): Promise<string | null> {
  if (isValidTimeZone(given)) return given;
  const row = (await conn('care_profiles as cp').join('accounts as a', 'cp.account_id', 'a.id').where('cp.id', profileId).first('a.timezone')) as { timezone: string | null } | undefined;
  return isValidTimeZone(row?.timezone) ? row!.timezone : null;
}

/** A contact named on a task must be linked to this person. */
export async function contactProblem(conn: Conn, profileId: string, providerId: string | null | undefined): Promise<string | null> {
  if (!providerId) return null;
  const link = await conn('care_profile_providers').where({ care_profile_id: profileId, provider_id: providerId }).first();
  if (link) return null;
  // Picked from the account's directory: linked to this person now.
  return (await linkContact(conn, profileId, providerId)) ? null : "That contact is not in this person's contacts. Add them to Contacts first, then pick them here.";
}

async function assigneeProblem(conn: Conn, profileId: string, input: Pick<TaskInput, 'assigned_to' | 'assigned_account_id'>): Promise<string | null> {
  if (input.assigned_to) {
    const m = await conn('care_circle_members').where({ id: input.assigned_to, care_profile_id: profileId }).first('id');
    if (!m) return 'That person is not in the care circle. Pick someone from the list.';
  }
  if (input.assigned_account_id) {
    const p = await conn('care_profiles').where({ id: profileId, account_id: input.assigned_account_id }).first('id');
    const m = p ? true : await conn('care_circle_members').where({ care_profile_id: profileId, account_id: input.assigned_account_id }).first('id');
    if (!m) return 'That person is not in the care circle. Pick someone from the list.';
  }
  return null;
}

/** Fill an empty phone on a contact already linked. */
async function fillPhone(conn: Conn, providerId: string, phone: string | null | undefined) {
  if (!phone?.trim()) return;
  await conn('providers')
    .where({ id: providerId })
    .where((w) => w.whereNull('phone').orWhereRaw("trim(phone) = ''"))
    .update({ phone: phone.trim().slice(0, 50) });
}

export interface CreateTaskResult {
  reminder: Record<string, unknown> & { id: string; title: string };
  joined_into?: JoinResult;
  filed: Array<{ id: string; name: string }>;
}

/**
 * Add a task. Works out who and what from the words unless told not to, and
 * joins an open task for the same booking unless told not to.
 */
export async function createTask(
  conn: Conn,
  opts: { profileId: string; actorId: string | null; source?: 'person' | 'pare'; input: TaskInput; timeZone?: string | null; joinNote?: string | null }
): Promise<CreateTaskResult> {
  const { profileId, input } = opts;
  const accountId = (await accountIdForProfile(profileId, conn))!;
  const zone = await ownerZone(conn, profileId, isValidTimeZone(input.tz) ? input.tz : opts.timeZone);
  const due = resolveDue(input, zone);
  if (!due) throw new TaskProblem('Pick the day it is due.');
  const problem = (await contactProblem(conn, profileId, input.provider_id)) ?? (await assigneeProblem(conn, profileId, input));
  if (problem) throw new TaskProblem(problem, 'PROVIDER_NOT_LINKED');
  // A journey item of this person's with no task yet.
  let itemId: string | null = null;
  if (input.checklist_item_id) {
    const item = await conn('checklist_items').where({ id: input.checklist_item_id, care_profile_id: profileId }).first('id');
    const taken = item ? await conn('reminders').where({ checklist_item_id: input.checklist_item_id }).first('id') : null;
    if (item && !taken) itemId = input.checklist_item_id;
  }

  const filed: Array<{ id: string; name: string }> = [];
  let providerId = input.provider_id ?? null;
  if (providerId) await fillPhone(conn, providerId, input.provider_phone);
  else if (input.provider_name?.trim()) {
    const pro = await ensureProfessional(conn, { profileId, name: input.provider_name, providerType: input.provider_type, phone: input.provider_phone });
    if (pro) {
      providerId = pro.id;
      if (pro.created) filed.push({ id: pro.id, name: pro.name });
    }
  }
  let typeId = input.next_step_type_id ?? (input.kind?.trim() ? await resolveNextStepTypeByName(accountId, input.kind, conn) : null);
  const inferred: string[] = [];
  if (!input.no_infer && (!providerId || !typeId)) {
    const guess = await inferTaskIntent(conn, profileId, accountId, { title: input.title, body: input.body });
    if (!providerId && guess.providerId) {
      providerId = guess.providerId;
      inferred.push('provider_id');
    }
    if (!typeId && guess.kindTypeId) {
      typeId = guess.kindTypeId;
      inferred.push('next_step_type_id');
    }
  }
  const kindKey = typeId ? ((await conn('next_step_types').where({ id: typeId }).first('system_key')) as { system_key: string | null } | undefined)?.system_key ?? null : null;

  // One task per booking.
  if (!input.no_join && taskBooks(input.title, kindKey)) {
    const pro = providerId ? ((await conn('providers').where({ id: providerId }).first('name', 'provider_type')) as { name: string; provider_type: string } | undefined) : undefined;
    const same = await findSameBookingTask(conn, profileId, {
      providerId, providerName: pro?.name ?? null, providerType: pro?.provider_type ?? null, kindKey, title: input.title,
    });
    if (same) {
      const joined = await joinTask(conn, {
        profileId,
        intoId: same.id,
        actorId: opts.actorId,
        fields: {
          provider_id: providerId, next_step_type_id: typeId, medical_condition_id: input.medical_condition_id ?? null,
          appointment_id: input.appointment_id ?? null, next_due_at: due.next_due_at, all_day: due.all_day,
        },
        note: opts.joinNote ?? `Added again as “${input.title}”${input.body?.trim() ? `: ${input.body.trim()}` : ''}`,
        documentIds: input.document_ids,
      });
      if (itemId) await conn('reminders').where({ id: same.id }).whereNull('checklist_item_id').update({ checklist_item_id: itemId });
      const reminder = (await conn('reminders').where({ id: same.id }).first()) as CreateTaskResult['reminder'];
      return { reminder, joined_into: joined, filed };
    }
  }

  const repeat = repeatFrom(input) ?? { reminder_type: 'once', rrule: null };
  const [row] = await conn('reminders')
    .insert({
      care_profile_id: profileId,
      title: input.title.slice(0, 255),
      body: input.body?.trim() || null,
      next_due_at: due.next_due_at,
      all_day: due.all_day,
      reminder_type: repeat.reminder_type,
      rrule: withMonthDay(repeat.rrule, due.next_due_at, zone),
      assigned_to: input.assigned_account_id ? null : input.assigned_to ?? null,
      assigned_account_id: input.assigned_account_id ?? null,
      desired_outcome: input.desired_outcome?.trim() || null,
      provider_id: providerId,
      next_step_type_id: typeId,
      medical_condition_id: input.medical_condition_id ?? null,
      appointment_id: input.appointment_id ?? null,
      checklist_item_id: itemId,
      inferred_fields: inferred,
    })
    .returning('*');
  const reminder = row as CreateTaskResult['reminder'];
  await linkDocuments(conn, profileId, reminder.id, input.document_ids ?? []);
  return { reminder, filed };
}

/**
 * Change a task. Whatever a person changes is theirs now, so it stops
 * being shown as worked out. A full documents list replaces what is linked.
 */
export async function updateTask(
  conn: Conn,
  opts: { profileId: string; taskId: string; input: Partial<TaskInput>; timeZone?: string | null }
): Promise<{ reminder: Record<string, unknown> | null; filed: Array<{ id: string; name: string }> }> {
  const { profileId, taskId, input } = opts;
  const before = (await conn('reminders').where({ id: taskId, care_profile_id: profileId }).first()) as Record<string, unknown> | undefined;
  if (!before) return { reminder: null, filed: [] };
  const problem = (await contactProblem(conn, profileId, input.provider_id)) ?? (await assigneeProblem(conn, profileId, input));
  if (problem) throw new TaskProblem(problem, 'PROVIDER_NOT_LINKED');
  const accountId = (await accountIdForProfile(profileId, conn))!;
  const update: Record<string, unknown> = {};
  const filed: Array<{ id: string; name: string }> = [];
  const inferred = new Set<string>((before['inferred_fields'] as string[] | null) ?? []);

  if (input.title !== undefined) update['title'] = input.title.slice(0, 255);
  if (input.body !== undefined) update['body'] = input.body?.trim() || null;
  if (input.desired_outcome !== undefined) update['desired_outcome'] = input.desired_outcome?.trim() || null;
  const zone = await ownerZone(conn, profileId, isValidTimeZone(input.tz) ? input.tz : opts.timeZone);
  if (input.due_on !== undefined || input.next_due_at !== undefined) {
    const due = resolveDue(input, zone);
    if (due) Object.assign(update, due);
  } else if (input.all_day !== undefined) update['all_day'] = input.all_day;
  const repeat = repeatFrom(input);
  if (repeat) Object.assign(update, repeat);
  // The day a monthly or yearly repeat comes back on follows the due date.
  if (repeat || update['next_due_at']) {
    const rule = repeat ? repeat.rrule : (before['rrule'] as string | null);
    update['rrule'] = withMonthDay(rule, new Date((update['next_due_at'] ?? before['next_due_at']) as string), zone);
  }
  if (input.assigned_to !== undefined || input.assigned_account_id !== undefined) {
    update['assigned_account_id'] = input.assigned_account_id ?? null;
    update['assigned_to'] = input.assigned_account_id ? null : input.assigned_to ?? null;
  }
  if (input.provider_id !== undefined || input.provider_name !== undefined) {
    let providerId = input.provider_id ?? null;
    if (providerId) await fillPhone(conn, providerId, input.provider_phone);
    else if (input.provider_name?.trim()) {
      const pro = await ensureProfessional(conn, { profileId, name: input.provider_name, providerType: input.provider_type, phone: input.provider_phone });
      if (pro) {
        providerId = pro.id;
        if (pro.created) filed.push({ id: pro.id, name: pro.name });
      }
    }
    if (providerId !== before['provider_id']) inferred.delete('provider_id');
    update['provider_id'] = providerId;
  }
  if (input.next_step_type_id !== undefined || input.kind !== undefined) {
    const typeId = input.next_step_type_id ?? (input.kind?.trim() ? await resolveNextStepTypeByName(accountId, input.kind, conn) : null);
    if (typeId !== before['next_step_type_id']) inferred.delete('next_step_type_id');
    update['next_step_type_id'] = typeId;
  }
  if (input.medical_condition_id !== undefined) update['medical_condition_id'] = input.medical_condition_id;
  update['inferred_fields'] = [...inferred];
  const [row] = await conn('reminders').where({ id: taskId }).update(update).returning('*');

  if (input.document_ids) {
    const keep = new Set(input.document_ids);
    const linked = (await conn('document_links').where({ entity_type: 'reminders', entity_id: taskId }).pluck('document_id')) as string[];
    const drop = linked.filter((d) => !keep.has(d));
    if (drop.length) await conn('document_links').where({ entity_type: 'reminders', entity_id: taskId }).whereIn('document_id', drop).delete();
    await linkDocuments(conn, profileId, taskId, input.document_ids);
  }
  return { reminder: row as Record<string, unknown>, filed };
}

/**
 * Put a task back as it was before something joined it, for "Keep them
 * separate". Only the details a join can fill are restored.
 */
export async function undoJoin(conn: Conn, profileId: string, join: { id: string; previous: Record<string, unknown>; note_id?: string | null; document_ids?: string[] }) {
  const allowed = new Set<string>([...JOIN_FILLS, 'next_due_at', 'all_day']);
  const restore = Object.fromEntries(Object.entries(join.previous).filter(([k]) => allowed.has(k)));
  if (Object.keys(restore).length) await conn('reminders').where({ id: join.id, care_profile_id: profileId }).update(restore);
  if (join.note_id) await conn('record_notes').where({ id: join.note_id, care_profile_id: profileId, entity_id: join.id }).delete();
  if (join.document_ids?.length) {
    await conn('document_links').where({ entity_type: 'reminders', entity_id: join.id }).whereIn('document_id', join.document_ids).delete();
  }
}

/**
 * Join one open task into another already doing the same booking. The newer
 * one is closed as joined; its notes and documents move across.
 */
export async function mergeTasks(conn: Conn, opts: { profileId: string; fromId: string; intoId: string; actorId: string }) {
  const from = (await conn('reminders').where({ id: opts.fromId, care_profile_id: opts.profileId }).first()) as Record<string, unknown> | undefined;
  const into = (await conn('reminders').where({ id: opts.intoId, care_profile_id: opts.profileId }).first()) as Record<string, unknown> | undefined;
  if (!from || !into || from['id'] === into['id']) return null;
  await joinTask(conn, {
    profileId: opts.profileId,
    intoId: String(into['id']),
    actorId: opts.actorId,
    fields: {
      provider_id: from['provider_id'] as string | null, next_step_type_id: from['next_step_type_id'] as string | null,
      medical_condition_id: from['medical_condition_id'] as string | null, appointment_id: from['appointment_id'] as string | null,
      next_due_at: from['next_due_at'] as Date, all_day: !!from['all_day'],
    },
    note: `Joined from “${String(from['title'])}”${from['body'] ? `: ${String(from['body'])}` : ''}`,
  });
  await conn('record_notes').where({ care_profile_id: opts.profileId, entity_type: 'reminders', entity_id: opts.fromId }).update({ entity_id: opts.intoId });
  await conn.raw(
    `INSERT INTO document_links (document_id, entity_type, entity_id, bring, created_at)
     SELECT document_id, entity_type, ?, bring, created_at FROM document_links WHERE entity_type = 'reminders' AND entity_id = ?
     ON CONFLICT DO NOTHING`,
    [opts.intoId, opts.fromId]
  );
  await conn('document_links').where({ entity_type: 'reminders', entity_id: opts.fromId }).delete();
  // A journey item the newer one carried out is carried out by the one that stays.
  if (from['checklist_item_id'] && !into['checklist_item_id']) {
    await conn('reminders').where({ id: opts.fromId }).update({ checklist_item_id: null });
    await conn('reminders').where({ id: opts.intoId }).update({ checklist_item_id: from['checklist_item_id'] });
  }
  // Anything waiting on the newer one now waits on the one that stays.
  await conn('appointments').where({ care_profile_id: opts.profileId, from_reminder_id: opts.fromId }).update({ from_reminder_id: opts.intoId });
  await conn('note_forwards').where({ care_profile_id: opts.profileId, target_reminder_id: opts.fromId }).update({ target_reminder_id: opts.intoId });
  await conn('reminders').where({ id: opts.fromId }).update({
    merged_into_id: opts.intoId, completed: true, completed_at: conn.fn.now(), completed_by_account_id: opts.actorId,
  });
  return { into: String(into['id']) };
}

/**
 * Done, from something else: a booking with a date, a journey step ticked.
 * A repeating task is done for this time and comes round again on its rule,
 * so a yearly check keeps reminding next year; any other task is ticked off.
 * Returns whether the task was ticked off.
 */
export async function finishTask(conn: Conn, opts: { profileId: string; taskId: string; actorId: string | null }): Promise<boolean> {
  const done = await markTaskDone(conn, opts);
  return !!done && !done.round;
}

export interface TaskRound {
  id: string;
  task_id: string;
  title: string;
  /** When this round was due, and when the task is due next. */
  was_due_at: Date;
  next_due_at: Date;
}

/**
 * Tick a task off, the one way every screen and Pare does it. A repeating
 * task is done for this round: the round is kept as a record of who did it
 * and when, the task moves on to its next date and stays open, and its
 * journey step reads done. Any other task is ticked off for good. Returns
 * the round for a repeating task, so the screen can offer Undo.
 */
export async function markTaskDone(
  conn: Conn,
  opts: {
    profileId: string;
    taskId: string;
    actorId: string | null;
    sentiment?: number | null;
    completion_reason?: string | null;
    completion_note?: string | null;
    /** The journey step that was ticked to do this, so unticking it undoes the round. */
    fromItemId?: string | null;
  },
): Promise<{ round: TaskRound | null } | null> {
  const t = (await conn('reminders')
    .where({ id: opts.taskId, care_profile_id: opts.profileId, completed: false })
    .first('id', 'title', 'next_due_at', 'rrule', 'reminder_type', 'checklist_item_id', 'last_notified_at')) as
    | { id: string; title: string; next_due_at: Date; rrule: string | null; reminder_type: string | null; checklist_item_id: string | null; last_notified_at: Date | null }
    | undefined;
  if (!t) return null;
  // "No longer needed" ends a repeating task rather than bringing it round again.
  const rule = opts.completion_reason === 'no_longer_needed' ? null : ruleFor(t);
  if (!rule) {
    await conn('reminders').where({ id: t.id }).update({
      completed: true,
      completed_at: conn.fn.now(),
      completed_by_account_id: opts.actorId,
      stopped_by_death_at: null,
      ...(opts.sentiment !== undefined ? { sentiment: opts.sentiment } : {}),
      ...(opts.completion_reason !== undefined ? { completion_reason: opts.completion_reason } : {}),
      ...(opts.completion_note !== undefined ? { completion_note: opts.completion_note } : {}),
    });
    return { round: null };
  }
  const zone = await ownerZone(conn, opts.profileId);
  const next = nextAfter(advance(new Date(t.next_due_at), rule, zone), rule, new Date(), zone);
  // The step this task carries out reads done for this round.
  let tickedItem: string | null = null;
  if (t.checklist_item_id) {
    const member = opts.actorId
      ? ((await conn('care_circle_members').where({ care_profile_id: opts.profileId, account_id: opts.actorId, invite_accepted: true }).first('id')) as { id: string } | undefined)
      : undefined;
    const n = await conn('checklist_items').where({ id: t.checklist_item_id, care_profile_id: opts.profileId, completed: false }).update({
      completed: true,
      completed_at: conn.fn.now(),
      achieved_on: new Date().toISOString().slice(0, 10),
      completed_by: member?.id ?? null,
    });
    if (n) tickedItem = t.checklist_item_id;
  }
  if (opts.fromItemId) tickedItem = opts.fromItemId;
  const [round] = await conn('reminder_rounds')
    .insert({
      reminder_id: t.id,
      care_profile_id: opts.profileId,
      due_at: t.next_due_at,
      done_by_account_id: opts.actorId,
      sentiment: opts.sentiment ?? null,
      completion_reason: opts.completion_reason ?? null,
      completion_note: opts.completion_note ?? null,
      ticked_item_id: tickedItem,
      last_notified_at: t.last_notified_at,
    })
    .returning('id');
  await conn('reminders').where({ id: t.id }).update({ next_due_at: next, last_notified_at: null });
  return { round: { id: (round as { id: string }).id, task_id: t.id, title: t.title, was_due_at: t.next_due_at, next_due_at: next } };
}

/** Undo a round: the task is due when it was, and the step it ticked opens again. */
export async function undoRound(conn: Conn, opts: { profileId: string; taskId: string; roundId: string }): Promise<boolean> {
  const newest = (await conn('reminder_rounds').where({ reminder_id: opts.taskId, care_profile_id: opts.profileId }).orderBy('done_at', 'desc').first()) as
    | { id: string; due_at: Date; ticked_item_id: string | null; last_notified_at: Date | null }
    | undefined;
  // Only the latest round can be undone, so the task never winds back past a later one.
  if (!newest || newest.id !== opts.roundId) return false;
  const r = newest;
  await conn('reminders').where({ id: opts.taskId, care_profile_id: opts.profileId }).update({ next_due_at: r.due_at, last_notified_at: r.last_notified_at });
  if (r.ticked_item_id) {
    await conn('checklist_items').where({ id: r.ticked_item_id, care_profile_id: opts.profileId }).update({ completed: false, completed_at: null, completed_by: null, achieved_on: null });
  }
  await conn('reminder_rounds').where({ id: r.id }).delete();
  return true;
}

export interface TaskListRow extends Record<string, unknown> {
  id: string;
}

/**
 * Everything a task list shows beyond the task row: who it is with, its
 * kind, what it is for, documents, the appointment it was booked as, and an
 * open task that looks like the same booking.
 */
export async function enrichTasks(conn: Conn, profileId: string, rows: TaskListRow[]): Promise<Array<TaskListRow & Record<string, unknown>>> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [contacts, kinds, conditions, docs, booked, members, accounts] = await Promise.all([
    contactSummaries(conn, rows.map((r) => r['provider_id'] as string | null), profileId),
    conn('next_step_types').whereIn('id', rows.map((r) => r['next_step_type_id']).filter(Boolean) as string[]).select('id', 'name', 'system_key'),
    conn('medical_conditions').whereIn('id', rows.map((r) => r['medical_condition_id']).filter(Boolean) as string[]).select('id', 'name'),
    withCategory(conn('documents'))
      .join('document_links as l', 'l.document_id', 'documents.id')
      .where({ 'documents.care_profile_id': profileId, 'l.entity_type': 'reminders' })
      .whereIn('l.entity_id', ids)
      .select('l.entity_id'),
    conn('appointments').where({ care_profile_id: profileId }).whereIn('from_reminder_id', ids).whereNotNull('starts_at').select('id', 'title', 'starts_at', 'status', 'from_reminder_id'),
    conn('care_circle_members').where({ care_profile_id: profileId }).select('id', 'display_name'),
    conn('accounts').whereIn('id', rows.map((r) => r['assigned_account_id']).filter(Boolean) as string[]).select('id', 'display_name'),
  ]);
  const kindById = new Map((kinds as Array<{ id: string; name: string; system_key: string | null }>).map((k) => [k.id, k]));
  const condById = new Map((conditions as Array<{ id: string; name: string }>).map((c) => [c.id, c]));
  const docsByTask = new Map<string, Array<{ id: string; label: string; category_name: string | null }>>();
  for (const d of docs as Array<{ id: string; label: string; category_name: string | null; entity_id: string }>) {
    const list = docsByTask.get(d.entity_id) ?? [];
    list.push({ id: d.id, label: d.label, category_name: d.category_name ?? null });
    docsByTask.set(d.entity_id, list);
  }
  const bookedByTask = new Map((booked as Array<{ id: string; title: string; starts_at: Date; status: string; from_reminder_id: string }>).map((a) => [a.from_reminder_id, a]));
  const memberName = new Map((members as Array<{ id: string; display_name: string }>).map((m) => [m.id, m.display_name]));
  const accountName = new Map((accounts as Array<{ id: string; display_name: string }>).map((m) => [m.id, m.display_name]));
  const mergedTitles = new Map(rows.map((r) => [r.id, r['title'] as string]));
  // Rounds of a repeating task already done, newest first: the record of each time.
  const roundRows = (await conn('reminder_rounds as rr')
    .leftJoin('accounts as a', 'rr.done_by_account_id', 'a.id')
    .where('rr.care_profile_id', profileId)
    .whereIn('rr.reminder_id', ids)
    .orderBy('rr.done_at', 'desc')
    .select('rr.id', 'rr.reminder_id', 'rr.due_at', 'rr.done_at', 'rr.sentiment', 'rr.completion_reason', 'rr.completion_note', 'a.display_name as done_by_name')) as Array<{
    id: string; reminder_id: string; due_at: Date; done_at: Date; done_by_name: string | null;
    sentiment: number | null; completion_reason: string | null; completion_note: string | null;
  }>;
  type RoundOut = Omit<(typeof roundRows)[number], 'reminder_id'>;
  const roundsByTask = new Map<string, RoundOut[]>();
  for (const r of roundRows) {
    const list = roundsByTask.get(r.reminder_id) ?? [];
    const { reminder_id: _r, ...rest } = r;
    void _r;
    if (list.length < 10) list.push(rest);
    roundsByTask.set(r.reminder_id, list);
  }

  type Enriched = TaskListRow & { provider: ContactSummary | null; kind: { id: string; name: string; system_key: string | null; books: boolean } | null; books: boolean; possible_duplicate_of: { id: string; title: string } | null };
  const out = rows.map((r): Enriched => {
    const kind = r['next_step_type_id'] ? kindById.get(r['next_step_type_id'] as string) : undefined;
    const books = taskBooks(String(r['title']), kind?.system_key);
    const a = bookedByTask.get(r.id);
    return {
      ...r,
      provider: r['provider_id'] ? (contacts.get(r['provider_id'] as string) ?? null) as ContactSummary | null : null,
      kind: kind ? { id: kind.id, name: kind.name, system_key: kind.system_key, books: stepBooks(kind.system_key) } : null,
      books,
      condition: r['medical_condition_id'] ? condById.get(r['medical_condition_id'] as string) ?? null : null,
      documents: docsByTask.get(r.id) ?? [],
      repeat: repeatChoice(r as { rrule?: string | null; reminder_type?: string | null }),
      booked_appointment: a ? { id: a.id, title: a.title, starts_at: a.starts_at, status: a.status } : null,
      assigned_name: r['assigned_account_id']
        ? accountName.get(r['assigned_account_id'] as string) ?? null
        : r['assigned_to']
          ? memberName.get(r['assigned_to'] as string) ?? null
          : null,
      merged_into_title: r['merged_into_id'] ? (r['merged_into_title'] as string | undefined) ?? mergedTitles.get(r['merged_into_id'] as string) ?? null : null,
      possible_duplicate_of: null as { id: string; title: string } | null,
      rounds_done: roundsByTask.get(r.id) ?? [],
    };
  });

  // An open booking task that matches an older open one looks like the same
  // job. A "Get a new referral" reminder is its own job.
  const renewals = new Set(
    (await conn('documents').where({ care_profile_id: profileId }).whereIn('renewal_task_id', ids).pluck('renewal_task_id')) as string[]
  );
  const open = out.filter((t) => !t['completed'] && !t['merged_into_id'] && t.books && !renewals.has(t.id));
  for (const t of open) {
    const prov = t.provider;
    const older = open.filter((o) => o.id !== t.id && new Date(o['created_at'] as string) < new Date(t['created_at'] as string));
    const hit = older.find((o) => {
      if (t['provider_id'] && o['provider_id'] === t['provider_id']) return true;
      if (o['provider_id']) return false;
      const words = norm(`${o['title']} ${o['body'] ?? ''}`);
      if (prov && (words.includes(norm(prov.name)) || (prov.role_label && words.includes(prov.role_label.toLowerCase())))) return true;
      return !t['provider_id'] && !!t.kind?.system_key && t.kind.system_key === o.kind?.system_key;
    });
    if (hit) t.possible_duplicate_of = { id: hit.id, title: String(hit['title']) };
  }
  return out;
}
