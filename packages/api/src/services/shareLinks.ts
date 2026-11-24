import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../config/database';
import { env } from '../config/env';
import { newLinkToken } from '../lib/tokens';
import { enrichAppointments } from './booking';
import { composeEmergencySheet, sheetDocumentIds, type EmergencySheet } from './emergencySheet';
import { appointmentEvent, appointmentPlace, calendarText, type IcsAppointment } from './ics';
import { personSummary, type ContactSummary } from './professionals';

type Conn = Knex | Knex.Transaction;

/**
 * Links that open with no login: an emergency sheet for a paramedic, one
 * appointment for whoever is driving, a report for a specialist's rooms.
 * The token is the credential. An emergency sheet link works until it is
 * turned off; appointment and report links last 30 days. Each open is
 * counted, and documents shared only with some roles never go.
 */
export type ShareKind = 'emergency_sheet' | 'appointment' | 'report';

export interface ShareLinkRow {
  id: string;
  token: string;
  care_profile_id: string;
  kind: ShareKind;
  entity_id: string | null;
  provider_id: string | null;
  circle_member_id: string | null;
  recipient_email: string | null;
  document_ids: string[];
  created_by_account_id: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  last_opened_at: Date | null;
  open_count: number;
  created_at: Date;
}

const THIRTY_DAYS = 30 * 24 * 3600 * 1000;

export const shareUrl = (token: string): string => `${env.APP_URL}/shared/${token}`;

export async function createShareLink(
  conn: Conn,
  input: {
    profileId: string;
    kind: ShareKind;
    entityId?: string | null;
    providerId?: string | null;
    circleMemberId?: string | null;
    recipientEmail?: string | null;
    documentIds?: string[];
    createdBy: string | null;
  }
): Promise<ShareLinkRow> {
  const [row] = await conn('share_links')
    .insert({
      token: newLinkToken(),
      care_profile_id: input.profileId,
      kind: input.kind,
      entity_id: input.entityId ?? null,
      provider_id: input.providerId ?? null,
      circle_member_id: input.circleMemberId ?? null,
      recipient_email: input.recipientEmail ?? null,
      document_ids: input.documentIds ?? [],
      created_by_account_id: input.createdBy,
      expires_at: input.kind === 'emergency_sheet' ? null : new Date(Date.now() + THIRTY_DAYS),
    })
    .returning('*');
  return row as ShareLinkRow;
}

/** The emergency sheet link that is still on, if there is one. */
export async function activeEmergencyLink(profileId: string, conn: Conn = db): Promise<ShareLinkRow | null> {
  const row = await conn('share_links')
    .where({ care_profile_id: profileId, kind: 'emergency_sheet' })
    .whereNull('revoked_at')
    .orderBy('created_at', 'desc')
    .first();
  return (row as ShareLinkRow | undefined) ?? null;
}

/** A link as the screen shows it: where it goes and how often it has been opened. */
export const linkOut = (l: ShareLinkRow) => ({
  id: l.id,
  kind: l.kind,
  url: shareUrl(l.token),
  entity_id: l.entity_id,
  recipient_email: l.recipient_email,
  expires_at: l.expires_at,
  revoked_at: l.revoked_at,
  last_opened_at: l.last_opened_at,
  open_count: l.open_count,
  created_at: l.created_at,
});

/**
 * Everything someone needs to get to an appointment, and nothing private:
 * the time, the place, who it is with and their phone, what to bring and how
 * to get ready. Notes never go.
 */
export interface SharedAppointment {
  id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  place: string | null;
  directions_link: string | null;
  telehealth_link: string | null;
  preparation: string | null;
  provider: Pick<ContactSummary, 'name' | 'role_label' | 'phone' | 'address' | 'organisation'> | null;
  bring: string[];
  going: Array<{ name: string; is_driver: boolean }>;
  interpreter_language: string | null;
  status: string;
}

export async function appointmentForSending(
  profileId: string,
  appointmentId: string,
  conn: Conn = db
): Promise<{ shared: SharedAppointment; ics: IcsAppointment } | null> {
  const row = (await conn('appointments').where({ id: appointmentId, care_profile_id: profileId }).first()) as Record<string, unknown> & { id: string } | undefined;
  if (!row) return null;
  const [a] = (await enrichAppointments(conn, profileId, [row])) as unknown as Array<Record<string, unknown> & {
    provider: ContactSummary | null;
    bring_documents: Array<{ label: string }>;
    attendees: Array<{ name: string; is_driver: boolean }>;
  }>;
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  const ics: IcsAppointment = {
    id: row.id,
    care_profile_id: profileId,
    title: String(row['title']),
    starts_at: (row['starts_at'] as Date | null) ?? new Date(),
    ends_at: (row['ends_at'] as Date | null) ?? null,
    all_day: !!row['all_day'],
    location: (row['location'] as string | null) ?? null,
    telehealth_link: (row['telehealth_link'] as string | null) ?? null,
    preparation: (row['preparation'] as string | null) ?? null,
    provider: a!.provider ?? null,
    bring: (a!.bring_documents ?? []).map((d) => d.label),
  };
  const p = a!.provider;
  return {
    ics,
    shared: {
      id: row.id,
      title: ics.title,
      starts_at: iso(row['starts_at']),
      ends_at: iso(row['ends_at']),
      all_day: ics.all_day,
      place: appointmentPlace(ics),
      directions_link: (row['directions_link'] as string | null) ?? p?.directions_link ?? null,
      telehealth_link: ics.telehealth_link,
      preparation: ics.preparation,
      provider: p ? { name: p.name, role_label: p.role_label, phone: p.phone, address: p.address, organisation: p.organisation } : null,
      bring: ics.bring,
      going: (a!.attendees ?? []).map((g) => ({ name: g.name, is_driver: !!g.is_driver })),
      interpreter_language: row['interpreter_needed'] ? ((row['interpreter_language'] as string | null) ?? 'Needed') : null,
      status: String(row['status'] ?? 'scheduled'),
    },
  };
}

/** The owner's zone, for whole-day dates in a calendar file. */
export async function ownerZone(profileId: string, conn: Conn = db): Promise<string | null> {
  const row = (await conn('care_profiles as cp').join('accounts as a', 'a.id', 'cp.account_id').where('cp.id', profileId).first('a.timezone')) as
    | { timezone: string | null }
    | undefined;
  return row?.timezone ?? null;
}

/** One appointment as a calendar file. */
export async function appointmentIcs(profileId: string, appointmentId: string, conn: Conn = db): Promise<{ filename: string; body: string } | null> {
  const found = await appointmentForSending(profileId, appointmentId, conn);
  if (!found || !found.shared.starts_at || found.shared.status === 'cancelled') return null;
  const zone = await ownerZone(profileId, conn);
  const safe = found.shared.title.replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'appointment';
  return { filename: `${safe}.ics`, body: calendarText(found.shared.title, appointmentEvent(found.ics, zone)) };
}

/** Who something is sent to: a contact, a circle person, the account holder, or an email typed in. */
export type SendTo =
  | { provider_id: string; email?: string | null }
  | { circle_member_id: string; email?: string | null }
  | { account_id: string }
  | { email: string; name?: string | null };

export class SendProblem extends Error {}

/**
 * Find who to send to and their email. A picked contact or circle person
 * with no email on file takes the one typed for them, saved on their own
 * record so it is there next time.
 */
export async function resolveRecipient(
  profileId: string,
  to: SendTo,
  conn: Conn = db
): Promise<{ name: string; email: string; provider_id: string | null; circle_member_id: string | null }> {
  const typed = 'email' in to && to.email ? to.email.trim() : null;
  if ('provider_id' in to) {
    const linked = await conn('care_profile_providers').where({ care_profile_id: profileId, provider_id: to.provider_id }).first('id');
    const p = linked ? ((await conn('providers').where({ id: to.provider_id }).first('id', 'name', 'email')) as { id: string; name: string; email: string | null } | undefined) : undefined;
    if (!p) throw new SendProblem('That contact is not linked to this person any more. Pick someone else.');
    const email = p.email?.trim() || typed;
    if (!email) throw new SendProblem(`${p.name} has no email on file. Type their email to send it.`);
    if (!p.email?.trim() && typed) await conn('providers').where({ id: p.id }).update({ email: typed, updated_at: conn.fn.now() });
    return { name: p.name, email, provider_id: p.id, circle_member_id: null };
  }
  if ('circle_member_id' in to) {
    const m = (await conn('care_circle_members').where({ id: to.circle_member_id, care_profile_id: profileId }).first('id', 'account_id')) as
      | { id: string; account_id: string | null }
      | undefined;
    const person = m ? await personSummary(conn, { circle_member_id: m.id }) : null;
    if (!m || !person) throw new SendProblem('That person is not in the care circle any more. Pick someone else.');
    const email = person.email?.trim() || typed;
    if (!email) throw new SendProblem(`${person.name} has no email on file. Type their email to send it.`);
    if (!person.email?.trim() && typed && !m.account_id) await conn('care_circle_members').where({ id: m.id }).update({ email: typed });
    return { name: person.name, email, provider_id: null, circle_member_id: m.id };
  }
  if ('account_id' in to) {
    const tied = await conn('care_profiles as cp')
      .where('cp.id', profileId)
      .andWhere((w) =>
        w.where('cp.account_id', to.account_id).orWhereExists(
          conn('care_circle_members as m').whereRaw('m.care_profile_id = cp.id').where({ 'm.account_id': to.account_id, 'm.invite_accepted': true })
        )
      )
      .first('cp.id');
    if (!tied) throw new SendProblem('That person is not in the care circle. Pick someone from the list, or type their email.');
    const person = await personSummary(conn, { account_id: to.account_id });
    if (!person?.email) throw new SendProblem('That person could not be found. Pick someone else.');
    return { name: person.name, email: person.email, provider_id: null, circle_member_id: null };
  }
  const email = to.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SendProblem('That email does not look right. It needs an @ and a full address, such as reception@clinic.com.au.');
  return { name: to.name?.trim() || email, email, provider_id: null, circle_member_id: null };
}

export type SharedPage =
  | { kind: 'emergency_sheet'; shared_by: string; profile_name: string; sheet: EmergencySheet }
  | { kind: 'appointment'; shared_by: string; profile_name: string; appointment: SharedAppointment }
  | {
      kind: 'report';
      shared_by: string;
      profile_name: string;
      report: { name: string; generated_at: string; result: unknown };
      documents: Array<{ id: string; label: string; category_name: string | null }>;
    };

export type SharedOpen =
  | { ok: true; page: SharedPage; link: ShareLinkRow }
  | { ok: false; status: 404 | 410; shared_by: string | null };

async function sharedBy(link: ShareLinkRow, conn: Conn): Promise<string> {
  if (!link.created_by_account_id) return 'the person who sent it';
  const a = (await conn('accounts').where({ id: link.created_by_account_id }).first('display_name', 'email')) as { display_name: string | null; email: string } | undefined;
  return a?.display_name || a?.email || 'the person who sent it';
}

/** The documents a report link was sent with, leaving out any shared only with some roles. */
async function linkDocuments(link: ShareLinkRow, conn: Conn) {
  if (!link.document_ids?.length) return [];
  return (await conn('documents as d')
    .leftJoin('document_categories as dc', 'dc.id', 'd.category_id')
    .whereIn('d.id', link.document_ids)
    .where('d.care_profile_id', link.care_profile_id)
    .whereRaw("coalesce(array_length(d.visible_to_roles, 1), 0) = 0")
    .select('d.id', 'd.label', 'dc.name as category_name')) as Array<{ id: string; label: string; category_name: string | null }>;
}

/** Open a link: compose its page, and count the open unless told not to. */
export async function openShared(token: string, opts: { count?: boolean } = {}, conn: Conn = db): Promise<SharedOpen> {
  if (!/^[0-9a-f]{64}$/i.test(token)) return { ok: false, status: 404, shared_by: null };
  const link = (await conn('share_links').where({ token }).first()) as ShareLinkRow | undefined;
  if (!link) return { ok: false, status: 404, shared_by: null };
  const by = await sharedBy(link, conn);
  const profile = (await conn('care_profiles').where({ id: link.care_profile_id }).first('full_name', 'archived')) as { full_name: string; archived: boolean } | undefined;
  const expired = !!link.revoked_at || (link.expires_at && new Date(link.expires_at).getTime() < Date.now());
  if (!profile || profile.archived || expired) return { ok: false, status: 410, shared_by: by };

  let page: SharedPage | null = null;
  if (link.kind === 'emergency_sheet') {
    const sheet = await composeEmergencySheet(link.care_profile_id, null);
    if (sheet) page = { kind: 'emergency_sheet', shared_by: by, profile_name: profile.full_name, sheet };
  } else if (link.kind === 'appointment' && link.entity_id) {
    const found = await appointmentForSending(link.care_profile_id, link.entity_id, conn);
    if (found) page = { kind: 'appointment', shared_by: by, profile_name: profile.full_name, appointment: found.shared };
  } else if (link.kind === 'report' && link.entity_id) {
    const saved = (await conn('saved_reports').where({ id: link.entity_id }).first('name', 'generated_at', 'result')) as
      | { name: string; generated_at: Date; result: unknown }
      | undefined;
    if (saved) {
      page = {
        kind: 'report',
        shared_by: by,
        profile_name: profile.full_name,
        report: { name: saved.name, generated_at: new Date(saved.generated_at).toISOString(), result: saved.result },
        documents: await linkDocuments(link, conn),
      };
    }
  }
  if (!page) return { ok: false, status: 410, shared_by: by };
  if (opts.count !== false) await conn('share_links').where({ id: link.id }).update({ last_opened_at: conn.fn.now(), open_count: conn.raw('open_count + 1') });
  return { ok: true, page, link };
}

/** Which documents a link may open: the ones its page names. */
export async function linkMayOpenDocument(link: ShareLinkRow, documentId: string, page: SharedPage, conn: Conn = db): Promise<boolean> {
  if (page.kind === 'report') return (await linkDocuments(link, conn)).some((d) => d.id === documentId);
  if (page.kind === 'emergency_sheet') return sheetDocumentIds(page.sheet).includes(documentId);
  return false;
}

/** Who to send to, as the screens and Pare give it. */
export const sendToSchema = z.union([
  z.object({ provider_id: z.string().uuid(), email: z.string().trim().max(255).optional().nullable() }),
  z.object({ circle_member_id: z.string().uuid(), email: z.string().trim().max(255).optional().nullable() }),
  z.object({ account_id: z.string().uuid() }),
  z.object({ email: z.string().trim().min(1).max(255), name: z.string().trim().max(255).optional().nullable() }),
]);

/** A time as the person reads it where they live: "Thu 3 Dec 2026, 10:30", or the day alone. */
export function whenText(startsAt: string | null, allDay: boolean, zone: string | null): string {
  if (!startsAt) return 'Not booked yet';
  const d = new Date(startsAt);
  const timeZone = zone ?? 'UTC';
  const day = new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  if (allDay) return `${day}, any time that day`;
  const time = new Intl.DateTimeFormat('en-AU', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${day}, ${time}`;
}

/** The lines of an appointment email: time, place, phone, what to bring, how to get ready. */
export function appointmentEmailLines(profileName: string, a: SharedAppointment, zone: string | null): string[] {
  return [
    `${profileName} has an appointment: ${a.title}.`,
    '',
    `When: ${whenText(a.starts_at, a.all_day, zone)}`,
    ...(a.place ? [`Where: ${a.place}`] : []),
    ...(a.provider ? [`With: ${[a.provider.name, a.provider.role_label].filter(Boolean).join(', ')}`] : []),
    ...(a.provider?.phone ? [`Their phone: ${a.provider.phone}`] : []),
    ...(a.telehealth_link ? [`Video call: ${a.telehealth_link}`] : []),
    ...(a.bring.length ? [`Bring: ${a.bring.join(', ')}`] : []),
    ...(a.preparation ? [`How to get ready: ${a.preparation}`] : []),
    ...(a.interpreter_language ? [`Interpreter: ${a.interpreter_language}`] : []),
    '',
    'The calendar entry is attached, with a reminder the day before and two hours before.',
  ];
}
