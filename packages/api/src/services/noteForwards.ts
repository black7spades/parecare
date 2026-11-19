import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../config/database';

type Conn = Knex | Knex.Transaction;

export const FORWARD_PARTS = ['outcome', 'details', 'note'] as const;
export type ForwardPart = (typeof FORWARD_PARTS)[number];

/** One piece of a visit to pass on, as typed or trimmed by the person sending it. */
export const forwardItemSchema = z.object({
  part: z.enum(FORWARD_PARTS),
  note_id: z.string().uuid().optional().nullable(),
  body: z.string().trim().min(1).max(4000),
});
export type ForwardItem = z.infer<typeof forwardItemSchema>;

/** Who an appointment is with, or what it is, for "From Dr Smith" and "Forwarded to Dr Patel". */
export const appointmentLabel = (a: { provider_name?: string | null; title: string }): string =>
  (a.provider_name?.trim() || a.title).slice(0, 255);

async function appointmentWithProvider(conn: Conn, profileId: string, appointmentId: string) {
  return conn('appointments as a')
    .leftJoin('providers as p', 'a.provider_id', 'p.id')
    .where({ 'a.id': appointmentId, 'a.care_profile_id': profileId })
    .first('a.id', 'a.title', 'a.starts_at', 'p.name as provider_name') as Promise<
    { id: string; title: string; starts_at: Date | null; provider_name: string | null } | undefined
  >;
}

/** Land forwards on an appointment: each becomes a note there that says who it is from. */
async function landForwards(conn: Conn, profileId: string, forwardIds: string[], appointmentId: string): Promise<number> {
  if (forwardIds.length === 0) return 0;
  const target = await appointmentWithProvider(conn, profileId, appointmentId);
  if (!target) return 0;
  const rows = (await conn('note_forwards')
    .where({ care_profile_id: profileId })
    .whereIn('id', forwardIds)
    .orderBy('created_at', 'asc')) as Array<{ id: string; body: string; forwarded_by_account_id: string | null }>;
  for (const f of rows) {
    await conn('record_notes').insert({
      care_profile_id: profileId,
      entity_type: 'appointments',
      entity_id: target.id,
      body: f.body,
      author_account_id: f.forwarded_by_account_id,
      forward_id: f.id,
    });
  }
  await conn('note_forwards').whereIn('id', rows.map((f) => f.id)).update({
    target_appointment_id: target.id,
    to_label: appointmentLabel(target),
    delivered_at: conn.fn.now(),
    updated_at: conn.fn.now(),
  });
  return rows.length;
}

/**
 * Put every forward still waiting on a next step onto the appointment booked
 * to carry it out. Called whenever an appointment is booked from a next step,
 * by the form or by Pare, so nothing waiting is left behind.
 */
export async function deliverForwards(
  conn: Conn,
  opts: { profileId: string; reminderId: string; appointmentId: string }
): Promise<number> {
  const waiting = (await conn('note_forwards')
    .where({ care_profile_id: opts.profileId, target_reminder_id: opts.reminderId })
    .whereNull('target_appointment_id')
    .pluck('id')) as string[];
  return landForwards(conn, opts.profileId, waiting, opts.appointmentId);
}

/**
 * Forward pieces of one appointment to another appointment, or to a next step
 * not booked yet. Sent to a booked appointment, the notes land at once; sent
 * to a next step, they wait and land when it is booked. Returns how many were
 * sent, or a plain reason it could not be done.
 */
export async function createForwards(
  conn: Conn,
  opts: {
    profileId: string;
    sourceAppointmentId: string;
    actorId: string;
    items: ForwardItem[];
    to: { appointment_id?: string | null; reminder_id?: string | null };
  }
): Promise<{ sent: number; landed: boolean } | { error: string }> {
  const source = await appointmentWithProvider(conn, opts.profileId, opts.sourceAppointmentId);
  if (!source) return { error: 'That appointment could not be found.' };
  if (opts.items.length === 0) return { error: 'Pick at least one note to forward.' };

  // A note forwarded must belong to this appointment.
  const noteIds = opts.items.filter((i) => i.part === 'note').map((i) => i.note_id).filter((x): x is string => !!x);
  if (noteIds.length) {
    const own = await conn('record_notes')
      .where({ care_profile_id: opts.profileId, entity_type: 'appointments', entity_id: source.id })
      .whereIn('id', noteIds)
      .pluck('id');
    if (own.length !== new Set(noteIds).size) return { error: 'One of those notes is not on this appointment.' };
  }

  let targetAppointmentId: string | null = null;
  let reminderId: string | null = null;
  let toLabel = '';
  if (opts.to.appointment_id) {
    if (opts.to.appointment_id === source.id) return { error: 'Pick a different appointment to forward to.' };
    const target = await appointmentWithProvider(conn, opts.profileId, opts.to.appointment_id);
    if (!target) return { error: 'The appointment to forward to could not be found.' };
    targetAppointmentId = target.id;
    toLabel = appointmentLabel(target);
  } else if (opts.to.reminder_id) {
    const step = (await conn('reminders')
      .where({ id: opts.to.reminder_id, care_profile_id: opts.profileId })
      .first('id', 'title')) as { id: string; title: string } | undefined;
    if (!step) return { error: 'That next step could not be found.' };
    reminderId = step.id;
    toLabel = step.title.slice(0, 255);
    // Already booked: the notes go straight to that appointment.
    const booked = (await conn('appointments')
      .where({ from_reminder_id: step.id, care_profile_id: opts.profileId })
      .orderBy('created_at', 'desc')
      .first('id')) as { id: string } | undefined;
    if (booked) targetAppointmentId = booked.id;
  } else {
    return { error: 'Pick where to forward the notes.' };
  }

  const created: string[] = [];
  for (const item of opts.items) {
    const [row] = await conn('note_forwards')
      .insert({
        care_profile_id: opts.profileId,
        source_appointment_id: source.id,
        source_part: item.part,
        source_note_id: item.part === 'note' ? item.note_id ?? null : null,
        body: item.body,
        from_label: appointmentLabel(source),
        // Not booked yet: dated the day it was sent.
        from_on: source.starts_at ?? new Date(),
        target_reminder_id: reminderId,
        to_label: toLabel,
        forwarded_by_account_id: opts.actorId,
      })
      .returning('id');
    created.push((row as { id: string }).id);
  }
  if (targetAppointmentId) await landForwards(conn, opts.profileId, created, targetAppointmentId);
  return { sent: opts.items.length, landed: !!targetAppointmentId };
}

export interface SentForward {
  id: string;
  part: ForwardPart;
  source_note_id: string | null;
  to_label: string;
  to_appointment_id: string | null;
  to_reminder_id: string | null;
  /** Waiting on a next step that is not booked yet. */
  waiting: boolean;
  forwarded_at: string;
}

const toSent = (f: Record<string, unknown>): SentForward => ({
  id: f['id'] as string,
  part: f['source_part'] as ForwardPart,
  source_note_id: (f['source_note_id'] as string | null) ?? null,
  to_label: f['to_label'] as string,
  to_appointment_id: (f['target_appointment_id'] as string | null) ?? null,
  to_reminder_id: (f['target_reminder_id'] as string | null) ?? null,
  waiting: !f['target_appointment_id'] && !!f['target_reminder_id'],
  forwarded_at: new Date(f['created_at'] as string).toISOString(),
});

/** What each appointment has passed on, so the source can show it greyed with where it went. */
export async function forwardsSentFor(appointmentIds: string[]): Promise<Map<string, SentForward[]>> {
  const out = new Map<string, SentForward[]>();
  if (appointmentIds.length === 0) return out;
  const rows = (await db('note_forwards')
    .whereIn('source_appointment_id', appointmentIds)
    .orderBy('created_at', 'asc')) as Array<Record<string, unknown>>;
  for (const r of rows) {
    const id = r['source_appointment_id'] as string;
    const list = out.get(id) ?? [];
    list.push(toSent(r));
    out.set(id, list);
  }
  return out;
}

/** For each note: where it was forwarded to, and where it came from if it is a forwarded copy. */
export async function forwardInfoForNotes(notes: Array<{ id: string; forward_id: string | null }>) {
  const ids = notes.map((n) => n.id);
  const sent = ids.length
    ? ((await db('note_forwards').whereIn('source_note_id', ids).orderBy('created_at', 'asc')) as Array<Record<string, unknown>>)
    : [];
  const fromIds = notes.map((n) => n.forward_id).filter((x): x is string => !!x);
  const received = fromIds.length
    ? ((await db('note_forwards').whereIn('id', fromIds)) as Array<Record<string, unknown>>)
    : [];
  const receivedById = new Map(received.map((f) => [f['id'] as string, f]));
  return (noteId: string, forwardId: string | null) => {
    const from = forwardId ? receivedById.get(forwardId) : undefined;
    return {
      forwarded_to: sent.filter((f) => f['source_note_id'] === noteId).map(toSent),
      forwarded_from: from
        ? {
            label: from['from_label'] as string,
            on: new Date(from['from_on'] as string).toISOString(),
            appointment_id: (from['source_appointment_id'] as string | null) ?? null,
          }
        : null,
    };
  };
}

/**
 * Take a forward back: the copy it put on the other appointment goes, and the
 * original stops showing as forwarded.
 */
export async function takeBackForward(conn: Conn, profileId: string, forwardId: string): Promise<boolean> {
  const f = await conn('note_forwards').where({ id: forwardId, care_profile_id: profileId }).first('id');
  if (!f) return false;
  await conn('record_notes').where({ care_profile_id: profileId, forward_id: forwardId }).delete();
  await conn('note_forwards').where({ id: forwardId }).delete();
  return true;
}
