import type { Knex } from 'knex';
import { z } from 'zod';
import { contactSummaries, resolveContactInput } from './professionals';
import { keepTask } from './keptTasks';
import { addDays } from './documentDates';
import { addressColumns, ADDRESS_PART_KEYS, hasAnyPart, type AddressParts } from './addresses';
import { changeCarePhase } from './journeys';
import { todayFor } from './medicationChanges';

type Conn = Knex | Knex.Transaction;

/**
 * A move into care: the care home, the day they moved in, the agreement and
 * its cooling-off, how the room is paid for and by when that is decided,
 * and notice dates. Saving a move makes the care home where they live, keeps
 * the home they left in the address book as their previous home, makes the
 * two tasks that cannot be missed, and moves their care journey on.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PAYMENT_CHOICES = ['lump_sum', 'daily', 'mix'] as const;
export const PAYMENT_LABELS: Record<(typeof PAYMENT_CHOICES)[number], string> = {
  lump_sum: 'Lump sum',
  daily: 'Daily payments',
  mix: 'Part lump sum and part daily',
};
/** Days of cooling-off after signing the agreement. */
export const COOLING_OFF_DAYS = 14;
/** Days after moving in to decide how the room is paid for. */
export const PAYMENT_DECISION_DAYS = 28;

export const moveInputSchema = z.object({
  facility_provider_id: z.string().uuid().optional().nullable(),
  facility_name: z.string().trim().max(255).optional().nullable(),
  facility_phone: z.string().trim().max(50).optional().nullable(),
  room_number: z.string().trim().max(50).optional().nullable(),
  entry_on: day.optional().nullable(),
  agreement_signed_on: day.optional().nullable(),
  cooling_off_ends_on: day.optional().nullable(),
  payment_choice: z.enum(PAYMENT_CHOICES).optional().nullable(),
  payment_choice_due_on: day.optional().nullable(),
  notice_given_on: day.optional().nullable(),
  leaving_on: day.optional().nullable(),
});
export type MoveInput = z.infer<typeof moveInputSchema>;

export class MoveProblem extends Error {}

/** "Lump sum" or "pay daily" in plain words, for Pare. */
export function paymentChoiceFrom(text: string | null | undefined): (typeof PAYMENT_CHOICES)[number] | null {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;
  if ((PAYMENT_CHOICES as readonly string[]).includes(t)) return t as (typeof PAYMENT_CHOICES)[number];
  if (/part|mix|combination|both/.test(t)) return 'mix';
  if (/lump|rad|refundable|deposit/.test(t)) return 'lump_sum';
  if (/daily|dap|per day|each day/.test(t)) return 'daily';
  return null;
}

const friendly = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Save the home they are leaving as their previous home, once. */
async function keepPreviousHome(conn: Conn, profileId: string): Promise<string | null> {
  const p = (await conn('care_profiles').where({ id: profileId }).first()) as Record<string, unknown> & { account_id: string; full_name: string; preferred_name: string | null };
  const parts = Object.fromEntries(ADDRESS_PART_KEYS.map((k) => [k, (p[k] as string | null) ?? null])) as AddressParts;
  if (!hasAnyPart(parts)) return null;
  const key = (r: AddressParts) => ADDRESS_PART_KEYS.map((k) => String(r[k] ?? '').trim().toLowerCase()).join('|');
  const candidates = (await conn('addresses').where({ account_id: p.account_id })) as Array<AddressParts & { id: string }>;
  let id = candidates.find((c) => key(c) === key(parts))?.id ?? null;
  if (!id) {
    const [row] = await conn('addresses').insert({ account_id: p.account_id, ...addressColumns(parts, `${p.preferred_name ?? p.full_name}'s previous home`) }).returning('id');
    id = (row as { id: string }).id;
  }
  await conn('care_profile_addresses')
    .insert({ care_profile_id: profileId, address_id: id, address_kind: 'previous_home' })
    .onConflict(['care_profile_id', 'address_id'])
    .merge({ address_kind: 'previous_home', updated_at: conn.fn.now() });
  return id;
}

export async function saveMove(
  conn: Knex.Transaction,
  opts: { profileId: string; actor: { id: string; role: string }; moveId?: string | null; input: Partial<MoveInput>; timeZone?: string | null }
): Promise<{ id: string; filed: Array<{ id: string; name: string }>; phase_changed: boolean }> {
  const { profileId, input } = opts;
  const before = opts.moveId
    ? ((await conn('care_moves').where({ id: opts.moveId, care_profile_id: profileId }).first()) as Record<string, unknown> | undefined)
    : undefined;
  if (opts.moveId && !before) throw new MoveProblem('That move was not found.');
  const filed: Array<{ id: string; name: string }> = [];
  const cols: Record<string, unknown> = {};
  if (input.facility_provider_id !== undefined || input.facility_name !== undefined) {
    const r = await resolveContactInput(conn, profileId, { id: input.facility_provider_id, name: input.facility_name, phone: input.facility_phone }, 'Aged care home', 'organisation');
    if ('error' in r) throw new MoveProblem(r.error);
    if (r.filed) filed.push(r.filed);
    cols['facility_provider_id'] = r.id;
  }
  for (const k of ['entry_on', 'agreement_signed_on', 'payment_choice', 'notice_given_on', 'leaving_on'] as const) {
    if (input[k] !== undefined) cols[k] = input[k];
  }
  const get = (k: string) => (k in cols ? cols[k] : before?.[k] ?? null) as string | null;
  // Worked out unless given: cooling-off 14 days after signing, the payment
  // decision 28 days after moving in. A worked-out day moves with its date.
  const workedOut = (k: string, from: string, plus: number) => {
    const oldFrom = before?.[from] as string | null | undefined;
    const oldVal = before?.[k] as string | null | undefined;
    return !oldVal || (!!oldFrom && oldVal === addDays(oldFrom, plus));
  };
  if (input.cooling_off_ends_on !== undefined && input.cooling_off_ends_on !== null) cols['cooling_off_ends_on'] = input.cooling_off_ends_on;
  else if (input.cooling_off_ends_on === null || workedOut('cooling_off_ends_on', 'agreement_signed_on', COOLING_OFF_DAYS)) {
    const signed = get('agreement_signed_on');
    cols['cooling_off_ends_on'] = signed ? addDays(signed, COOLING_OFF_DAYS) : null;
  }
  if (input.payment_choice_due_on !== undefined && input.payment_choice_due_on !== null) cols['payment_choice_due_on'] = input.payment_choice_due_on;
  else if (input.payment_choice_due_on === null || workedOut('payment_choice_due_on', 'entry_on', PAYMENT_DECISION_DAYS)) {
    const entry = get('entry_on');
    cols['payment_choice_due_on'] = entry ? addDays(entry, PAYMENT_DECISION_DAYS) : null;
  }

  let id: string;
  if (before) {
    id = String(before['id']);
    if (Object.keys(cols).length) await conn('care_moves').where({ id }).update({ ...cols, updated_at: conn.fn.now() });
  } else {
    if (!cols['facility_provider_id']) throw new MoveProblem('Say which care home they are moving into.');
    const previous = await keepPreviousHome(conn, profileId);
    const [row] = await conn('care_moves').insert({ care_profile_id: profileId, ...cols, previous_address_id: previous }).returning('id');
    id = (row as { id: string }).id;
    // The home they left is kept as their previous home, not as where they
    // live, so nothing reads it as their address any more.
    if (previous) {
      await conn('care_profiles')
        .where({ id: profileId })
        .update(Object.fromEntries(ADDRESS_PART_KEYS.map((k) => [k, null])));
    }
  }
  const move = (await conn('care_moves').where({ id }).first()) as Record<string, unknown>;

  // Where they live is the care home now, with their room.
  if (move['facility_provider_id'] && !move['leaving_on']) {
    const update: Record<string, unknown> = { residence_type: 'care_facility', residence_provider_id: move['facility_provider_id'], updated_at: conn.fn.now() };
    if (input.room_number !== undefined) update['room_number'] = input.room_number?.trim() || null;
    await conn('care_profiles').where({ id: profileId }).update(update);
  }

  // The two dates that cannot be missed, as tasks kept in step.
  const paymentDue = move['payment_choice_due_on'] as string | null;
  const coolingEnds = move['cooling_off_ends_on'] as string | null;
  const paymentTask = await keepTask(conn, {
    profileId,
    actorId: opts.actor.id,
    taskId: (move['payment_task_id'] as string | null) ?? null,
    timeZone: opts.timeZone,
    want: paymentDue && !move['payment_choice'] ? { title: 'Decide how to pay for the room', due_on: paymentDue } : null,
  });
  const today = await todayFor(conn, profileId);
  const coolingTask = await keepTask(conn, {
    profileId,
    actorId: opts.actor.id,
    taskId: (move['cooling_off_task_id'] as string | null) ?? null,
    timeZone: opts.timeZone,
    want: coolingEnds && coolingEnds >= today ? { title: `Cooling-off ends ${friendly(coolingEnds)}`, due_on: addDays(coolingEnds, -2) } : null,
  });
  await conn('care_moves').where({ id }).update({ payment_task_id: paymentTask, cooling_off_task_id: coolingTask });

  // Their care journey follows: moving in, or living there once they have.
  const entry = move['entry_on'] as string | null;
  const phase = entry && entry <= today ? 'residential_ongoing' : 'transition_to_residential';
  const changed = await changeCarePhase(conn, {
    profileId,
    phase,
    actorAccountId: opts.actor.id,
    actorIsSuperAdmin: opts.actor.role === 'super_admin',
    forwardOnly: true,
  });
  return { id, filed, phase_changed: changed.ok && changed.changed };
}

/**
 * Delete a move recorded by mistake: its open tasks go, and when the care
 * home is still where they live, their previous home is where they live again.
 */
export async function deleteMove(conn: Conn, profileId: string, moveId: string): Promise<boolean> {
  const move = (await conn('care_moves').where({ id: moveId, care_profile_id: profileId }).first()) as Record<string, unknown> | undefined;
  if (!move) return false;
  for (const k of ['payment_task_id', 'cooling_off_task_id']) {
    if (move[k]) await conn('reminders').where({ id: move[k] as string, completed: false }).delete();
  }
  const p = (await conn('care_profiles').where({ id: profileId }).first('residence_provider_id')) as { residence_provider_id: string | null };
  if (move['facility_provider_id'] && p.residence_provider_id === move['facility_provider_id'] && move['previous_address_id']) {
    const home = (await conn('addresses').where({ id: move['previous_address_id'] as string }).first()) as AddressParts | undefined;
    await conn('care_profiles')
      .where({ id: profileId })
      .update({
        residence_type: 'private_residence',
        residence_provider_id: null,
        room_number: null,
        room_area_name: null,
        room_area_type: null,
        ...(home ? Object.fromEntries(ADDRESS_PART_KEYS.map((k) => [k, home[k] ?? null])) : {}),
        updated_at: conn.fn.now(),
      });
    await conn('care_profile_addresses').where({ care_profile_id: profileId, address_id: move['previous_address_id'] as string }).update({ address_kind: 'residence' });
  }
  await conn('document_links').where({ entity_type: 'care-moves', entity_id: moveId }).delete();
  await conn('care_moves').where({ id: moveId }).delete();
  return true;
}

export async function movesOut(conn: Conn, profileId: string, rows: Array<Record<string, unknown> & { id: string }>) {
  if (rows.length === 0) return [];
  const contacts = await contactSummaries(conn, rows.map((r) => r['facility_provider_id'] as string | null), profileId);
  const addrIds = rows.map((r) => r['previous_address_id']).filter(Boolean) as string[];
  const addrs = addrIds.length ? ((await conn('addresses').whereIn('id', addrIds).select('id', 'formatted', ...ADDRESS_PART_KEYS)) as Array<Record<string, unknown> & { id: string }>) : [];
  const addrById = new Map(addrs.map((a) => [a.id, a]));
  return rows.map((r) => ({
    ...r,
    facility: (r['facility_provider_id'] && contacts.get(r['facility_provider_id'] as string)) || null,
    payment_label: r['payment_choice'] ? PAYMENT_LABELS[r['payment_choice'] as (typeof PAYMENT_CHOICES)[number]] ?? null : null,
    previous_address: r['previous_address_id'] ? addrById.get(r['previous_address_id'] as string) ?? null : null,
    cooling_off_worked_out: !!(r['agreement_signed_on'] && r['cooling_off_ends_on'] === addDays(r['agreement_signed_on'] as string, COOLING_OFF_DAYS)),
    payment_due_worked_out: !!(r['entry_on'] && r['payment_choice_due_on'] === addDays(r['entry_on'] as string, PAYMENT_DECISION_DAYS)),
  }));
}
