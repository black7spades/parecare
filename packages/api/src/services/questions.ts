import type { Knex } from 'knex';
import { z } from 'zod';
import { contactSummaries, resolveContactInput, type ContactSummary } from './professionals';
import { inferTaskIntent } from './tasks';

type Conn = Knex | Knex.Transaction;

/**
 * Questions to ask: who to ask and the visit to ask at. A question that
 * names someone in Contacts, or is put to them, goes on the next visit with
 * them, and says it was worked out so it can be changed. The screens and
 * Pare both write through here.
 */

export const questionInputSchema = z.object({
  title: z.string().trim().min(1).max(255),
  body: z.string().max(4000).optional().nullable(),
  // Who to ask: someone in Contacts, or a new name filed there.
  provider_id: z.string().uuid().optional().nullable(),
  provider_name: z.string().trim().max(255).optional().nullable(),
  provider_type: z.string().trim().max(100).optional().nullable(),
  provider_phone: z.string().trim().max(50).optional().nullable(),
  // The visit to ask at.
  appointment_id: z.string().uuid().optional().nullable(),
  // Take who and when as given, with nothing worked out.
  no_infer: z.boolean().optional(),
});
export type QuestionInput = z.infer<typeof questionInputSchema>;

export class QuestionProblem extends Error {}

/** The next visit with this contact that has a date and has not happened yet. */
export async function nextVisitWith(conn: Conn, profileId: string, providerId: string): Promise<{ id: string; title: string; starts_at: Date } | null> {
  const row = (await conn('appointments')
    .where({ care_profile_id: profileId, provider_id: providerId, status: 'scheduled' })
    .whereNotNull('starts_at')
    .where('starts_at', '>=', conn.raw("now() - interval '2 hours'"))
    .orderBy('starts_at', 'asc')
    .first('id', 'title', 'starts_at')) as { id: string; title: string; starts_at: Date } | undefined;
  return row ?? null;
}

async function appointmentOnProfile(conn: Conn, profileId: string, id: string) {
  return (await conn('appointments').where({ id, care_profile_id: profileId }).first('id', 'provider_id')) as
    | { id: string; provider_id: string | null }
    | undefined;
}

/**
 * Add a question, or change one. Who to ask and when come from what was
 * given; anything left out on a new question is worked out from its words
 * and the visits already booked, and listed in `inferred_fields`.
 */
export async function saveQuestion(
  trx: Knex.Transaction,
  opts: {
    profileId: string;
    actorId: string;
    actorMemberId?: string | null;
    input: Partial<QuestionInput>;
    questionId?: string;
  }
): Promise<{ id: string; filed: { id: string; name: string } | null }> {
  const { profileId, input } = opts;
  const before = opts.questionId
    ? ((await trx('open_questions').where({ id: opts.questionId, care_profile_id: profileId }).first()) as
        | { id: string; title: string; body: string | null; provider_id: string | null; appointment_id: string | null; inferred_fields: string[] | null }
        | undefined)
    : undefined;
  if (opts.questionId && !before) throw new QuestionProblem('That question is not on this profile.');

  const fields: Record<string, unknown> = {};
  let inferred = new Set(before?.inferred_fields ?? []);
  let filed: { id: string; name: string } | null = null;

  if (input.title !== undefined) fields['title'] = input.title.trim();
  if (input.body !== undefined) fields['body'] = input.body?.trim() || null;

  // Who to ask, as chosen.
  const whoGiven = input.provider_id !== undefined || !!input.provider_name?.trim();
  if (whoGiven) {
    const who = await resolveContactInput(
      trx,
      profileId,
      { id: input.provider_id ?? null, name: input.provider_name ?? null, type: input.provider_type ?? null, phone: input.provider_phone ?? null },
      'other'
    );
    if ('error' in who) throw new QuestionProblem(who.error);
    fields['provider_id'] = who.id;
    filed = who.filed;
    inferred.delete('provider_id');
  }

  // The visit to ask at, as chosen.
  if (input.appointment_id !== undefined) {
    if (input.appointment_id) {
      const appt = await appointmentOnProfile(trx, profileId, input.appointment_id);
      if (!appt) throw new QuestionProblem('That appointment is not on this profile. Pick one from the list.');
      fields['appointment_id'] = appt.id;
      // Asked at a visit with someone, it is for them too, unless someone was named.
      if (!whoGiven && appt.provider_id && !(before?.provider_id && !inferred.has('provider_id'))) {
        fields['provider_id'] = appt.provider_id;
        inferred.add('provider_id');
      }
    } else {
      fields['appointment_id'] = null;
    }
    inferred.delete('appointment_id');
  }

  // A new question works out who and when from its words.
  if (!before && !input.no_infer) {
    if (!whoGiven && fields['provider_id'] === undefined) {
      const accountId = ((await trx('care_profiles').where({ id: profileId }).first('account_id')) as { account_id: string }).account_id;
      const guess = await inferTaskIntent(trx, profileId, accountId, { title: String(fields['title'] ?? ''), body: (fields['body'] as string | null) ?? null });
      if (guess.providerId) {
        fields['provider_id'] = guess.providerId;
        inferred.add('provider_id');
      }
    }
    const providerId = (fields['provider_id'] as string | null | undefined) ?? null;
    if (input.appointment_id === undefined && providerId) {
      const visit = await nextVisitWith(trx, profileId, providerId);
      if (visit) {
        fields['appointment_id'] = visit.id;
        inferred.add('appointment_id');
      }
    }
  }
  // Someone else to ask, on a question whose visit was worked out: it moves
  // to the next visit with them.
  if (before && whoGiven && input.appointment_id === undefined && (!before.appointment_id || inferred.has('appointment_id'))) {
    const providerId = (fields['provider_id'] as string | null) ?? null;
    const visit = providerId ? await nextVisitWith(trx, profileId, providerId) : null;
    fields['appointment_id'] = visit?.id ?? null;
    if (visit) inferred.add('appointment_id');
    else inferred.delete('appointment_id');
  }
  if (input.no_infer) inferred = new Set();
  fields['inferred_fields'] = [...inferred];

  if (before) {
    await trx('open_questions').where({ id: before.id }).update(fields);
    return { id: before.id, filed };
  }
  const [row] = await trx('open_questions')
    .insert({
      care_profile_id: profileId,
      status: 'open',
      raised_by_account_id: opts.actorId,
      raised_by: opts.actorMemberId ?? null,
      ...fields,
    })
    .returning('id');
  return { id: (row as { id: string }).id, filed };
}

export interface QuestionOut extends Record<string, unknown> {
  id: string;
  title: string;
  status: string;
  provider_id: string | null;
  appointment_id: string | null;
  inferred_fields: string[];
  /** Who to ask, as someone to call. */
  ask: ContactSummary | null;
  /** The visit to ask at. */
  ask_at: { id: string; title: string; starts_at: string | null; status: string } | null;
  raised_by_name: string | null;
}

/** Questions as every screen reads them: who to ask, the visit, who raised it. */
export async function questionsOut(conn: Conn, profileId: string, where?: (q: Knex.QueryBuilder) => void): Promise<QuestionOut[]> {
  const rows = (await conn('open_questions as q')
    .leftJoin('appointments as ap', 'ap.id', 'q.appointment_id')
    .leftJoin('accounts as acc', 'acc.id', 'q.raised_by_account_id')
    .leftJoin('care_circle_members as m', 'm.id', 'q.raised_by')
    .where('q.care_profile_id', profileId)
    .modify((q) => where?.(q))
    .orderBy('q.created_at', 'desc')
    .select(
      'q.*',
      'ap.title as ask_at_title',
      'ap.starts_at as ask_at_starts_at',
      'ap.status as ask_at_status',
      conn.raw('coalesce(acc.display_name, m.display_name) as raised_by_name')
    )) as Array<Record<string, unknown> & { id: string; provider_id: string | null; appointment_id: string | null }>;
  const contacts = await contactSummaries(conn, rows.map((r) => r.provider_id), profileId);
  return rows.map((r) => {
    const { ask_at_title, ask_at_starts_at, ask_at_status, ...rest } = r;
    return {
      ...rest,
      inferred_fields: (r['inferred_fields'] as string[] | null) ?? [],
      ask: r.provider_id ? contacts.get(r.provider_id) ?? null : null,
      ask_at: r.appointment_id
        ? { id: r.appointment_id, title: String(ask_at_title ?? ''), starts_at: ask_at_starts_at ? new Date(ask_at_starts_at as string).toISOString() : null, status: String(ask_at_status ?? '') }
        : null,
    } as unknown as QuestionOut;
  });
}

/**
 * The questions to ask at each appointment: those asked for that visit, and,
 * at the next visit with a contact, the open ones for that contact with no
 * visit chosen yet.
 */
export async function questionsForAppointments(
  conn: Conn,
  profileId: string,
  appointments: Array<{ id: string; provider_id?: string | null; status?: string | null; starts_at?: Date | string | null }>
): Promise<Map<string, QuestionOut[]>> {
  const out = new Map<string, QuestionOut[]>();
  if (appointments.length === 0) return out;
  const ids = appointments.map((a) => a.id);
  const now = Date.now() - 2 * 3600 * 1000;
  // The next visit with each contact, among these.
  const nextByProvider = new Map<string, { id: string; at: number }>();
  for (const a of appointments) {
    if (!a.provider_id || a.status !== 'scheduled' || !a.starts_at) continue;
    const at = new Date(a.starts_at).getTime();
    if (at < now) continue;
    const seen = nextByProvider.get(a.provider_id);
    if (!seen || at < seen.at) nextByProvider.set(a.provider_id, { id: a.id, at });
  }
  const providerIds = [...nextByProvider.keys()];
  const rows = await questionsOut(conn, profileId, (q) => {
    void q.where((w) => {
      void w.whereIn('q.appointment_id', ids);
      if (providerIds.length) void w.orWhere((x) => void x.whereNull('q.appointment_id').where('q.status', 'open').whereIn('q.provider_id', providerIds));
    });
  });
  for (const q of rows) {
    const target = q.appointment_id ?? (q.provider_id ? nextByProvider.get(q.provider_id)?.id : undefined);
    if (!target) continue;
    const list = out.get(target) ?? [];
    list.push(q);
    out.set(target, list);
  }
  // Oldest first reads as the list was written.
  for (const list of out.values()) list.reverse();
  return out;
}

/**
 * What the doctor said, from the visit: each answer resolves its question
 * and ties it to the visit it was answered at.
 */
export async function answerQuestions(
  trx: Knex.Transaction,
  opts: { profileId: string; appointmentId: string | null; actorMemberId?: string | null; answers: Array<{ question_id: string; answer: string }> }
): Promise<number> {
  let n = 0;
  for (const a of opts.answers) {
    const answer = a.answer.trim();
    if (!answer) continue;
    const row = (await trx('open_questions').where({ id: a.question_id, care_profile_id: opts.profileId }).first('id', 'appointment_id')) as
      | { id: string; appointment_id: string | null }
      | undefined;
    if (!row) continue;
    await trx('open_questions')
      .where({ id: row.id })
      .update({
        status: 'resolved',
        resolution: answer,
        resolved_at: trx.fn.now(),
        resolved_by: opts.actorMemberId ?? null,
        ...(row.appointment_id || !opts.appointmentId ? {} : { appointment_id: opts.appointmentId }),
      });
    n++;
  }
  return n;
}
