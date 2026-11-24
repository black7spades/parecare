import { db } from '../config/database';
import { roleMaySee } from '../lib/circleRoles';
import { emergencyContactsFor, type EmergencyContact } from './emergencyContacts';
import { identifiersFor, type Identifiers } from './identifiers';
import { contactSummaries, mainContact, personSummary, type ContactSummary } from './professionals';

/**
 * One person's emergency sheet, composed on the server so the same sheet is
 * shown on their profile, printed in bulk for a wing, opened through a share
 * link with no login, and kept on a phone for no signal. Sections, in order:
 * who this is, where they are, ID numbers, allergies, conditions now,
 * medicines, eating, drinking and moving, the advance care directive, power
 * of attorney, who to call, and every professional and organisation.
 */
export interface SheetDocument {
  id: string;
  label: string;
}

export interface EmergencySheet {
  profile: {
    id: string;
    full_name: string;
    preferred_name: string | null;
    date_of_birth: string | null;
    primary_language: string | null;
    pronouns: string | null;
  };
  residence: {
    residence_type: string | null;
    facility: { name: string; phone: string | null } | null;
    room_number: string | null;
    room_area_name: string | null;
    room_area_type: string | null;
    address: string | null;
  };
  identifiers: Identifiers;
  allergies: Array<{ substance: string; reaction: string | null; severity: string | null }>;
  /** Checked: no known allergies, by whom and when. */
  no_known_allergies: { on: string; by_name: string | null } | null;
  /** Conditions still current; resolved ones are left out. */
  conditions: string[];
  medications: Array<{
    name: string;
    dose: string | null;
    as_needed: boolean;
    schedule_times: string[];
    frequency: string | null;
    critical: boolean;
    instructions: string | null;
  }>;
  eating_drinking_moving: { diet: string[]; swallowing: string[]; mobility: string[] };
  advance_care_directive: { in_place: boolean; location: string | null; documents: SheetDocument[] };
  poa_holders: Array<{
    name: string;
    poa_type: string | null;
    poa_activated: boolean;
    phone: string | null;
    email: string | null;
    documents: SheetDocument[];
  }>;
  emergency_contacts: EmergencyContact[];
  /** Every professional and organisation they still see, the main GP first. */
  professionals: ContactSummary[];
  communication_needs: string[];
}

/**
 * Who is reading, for documents shared only with some roles. Null is someone
 * with no login, such as a paramedic opening a share link: they see only
 * documents shared with the whole circle.
 */
export type SheetViewer = { owner: boolean; role: string | null } | null;

const dateOnly = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const asList = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);

const isGp = (c: ContactSummary, type: string | null) => (type ?? '').toLowerCase() === 'gp' || c.role_label === 'GP';

export async function composeEmergencySheet(profileId: string, viewer: SheetViewer = null): Promise<EmergencySheet | null> {
  const p = (await db('care_profiles').where({ id: profileId }).first()) as Record<string, unknown> | undefined;
  if (!p) return null;
  const [facility, allergies, contacts, members, linked, conditions, meds, plan, identifiers, docs, checkedBy] = await Promise.all([
    p['residence_provider_id'] ? db('providers').where({ id: p['residence_provider_id'] as string }).first('name', 'phone') : Promise.resolve(null),
    db('allergies').where({ care_profile_id: profileId }).orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'substance', order: 'asc' }]).select('substance', 'reaction', 'severity'),
    emergencyContactsFor(profileId),
    db('care_circle_members').where({ care_profile_id: profileId }).whereNotNull('poa_type').orderBy('created_at', 'asc').select('id', 'display_name', 'poa_type', 'poa_activated'),
    db('care_profile_providers as cpp')
      .join('providers as p', 'cpp.provider_id', 'p.id')
      .where('cpp.care_profile_id', profileId)
      .whereNull('cpp.ended_on')
      .orderBy([{ column: 'cpp.is_main', order: 'desc' }, { column: 'p.name', order: 'asc' }])
      .select('p.id', 'p.name', 'p.provider_type', 'cpp.poa_type', 'cpp.poa_activated', 'cpp.is_main'),
    db('medical_conditions').where({ care_profile_id: profileId }).whereRaw("coalesce(status, 'active') <> 'resolved'").whereNull('resolved_on').orderBy('created_at', 'asc').pluck('name'),
    db('medications as m')
      .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
      .where({ 'm.care_profile_id': profileId, 'm.active': true })
      .orderBy([{ column: 'm.critical', order: 'desc' }, { column: 'c.name', order: 'asc' }])
      .select('c.name', 'm.dose', 'm.as_needed', 'm.schedule_times', 'm.frequency', 'm.critical', 'm.instructions'),
    db('care_plans')
      .where({ care_profile_id: profileId })
      .first('advance_care_directive', 'advance_care_directive_location', 'communication_needs', 'dietary_requirements', 'mobility_aids', 'swallowing_needs'),
    identifiersFor(profileId),
    db('documents as d')
      .leftJoin('document_categories as dc', 'dc.id', 'd.category_id')
      .where('d.care_profile_id', profileId)
      .whereIn('dc.system_key', ['advance_care_directive', 'poa'])
      .orderBy('d.created_at', 'desc')
      .select('d.id', 'd.label', 'd.visible_to_roles', 'dc.system_key as category_key'),
    p['no_known_allergies_by'] ? db('accounts').where({ id: p['no_known_allergies_by'] as string }).first('display_name') : Promise.resolve(null),
  ]);

  // Documents shared only with some roles stay with those roles.
  const mayRead = (roles: unknown) => {
    const list = Array.isArray(roles) ? (roles as string[]) : [];
    if (list.length === 0) return true;
    if (!viewer) return false;
    return viewer.owner || roleMaySee(list, viewer.role);
  };
  const readable = (docs as Array<{ id: string; label: string; visible_to_roles: unknown; category_key: string }>).filter((d) => mayRead(d.visible_to_roles));
  const directiveDocs = readable.filter((d) => d.category_key === 'advance_care_directive').map((d) => ({ id: d.id, label: d.label }));
  const poaDocs = readable.filter((d) => d.category_key === 'poa');
  const poaLinks = poaDocs.length
    ? ((await db('document_links').whereIn('document_id', poaDocs.map((d) => d.id)).where({ entity_type: 'providers' }).select('document_id', 'entity_id')) as Array<{ document_id: string; entity_id: string }>)
    : [];
  // A holder's documents: those attached to their contact record, else every
  // power of attorney document on file.
  const poaDocsFor = (providerId: string | null): SheetDocument[] => {
    const mine = providerId ? poaDocs.filter((d) => poaLinks.some((l) => l.document_id === d.id && l.entity_id === providerId)) : [];
    const unattached = poaDocs.filter((d) => !poaLinks.some((l) => l.document_id === d.id));
    return (mine.length ? mine : unattached).map((d) => ({ id: d.id, label: d.label }));
  };

  const provs = linked as Array<{ id: string; name: string; provider_type: string | null; poa_type: string | null; poa_activated: boolean; is_main: boolean }>;
  const [summaries, gp] = await Promise.all([contactSummaries(db, provs.map((r) => r.id), profileId), mainContact(db, profileId, 'gp')]);
  const typeOf = new Map(provs.map((r) => [r.id, r.provider_type]));
  const rank = (c: ContactSummary) => (gp && c.id === gp.id ? 0 : isGp(c, typeOf.get(c.id ?? '') ?? null) ? 1 : 2);
  const professionals = provs
    .map((r) => summaries.get(r.id))
    .filter((c): c is ContactSummary => !!c)
    // Their GP first, then any other GP, then everyone else by name.
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map((c) => (gp && c.id === gp.id ? { ...c, is_main: true } : c));

  const memberHolders = await Promise.all(
    (members as Array<{ id: string; display_name: string; poa_type: string | null; poa_activated: boolean }>).map(async (m) => {
      const person = await personSummary(db, { circle_member_id: m.id });
      return {
        name: m.display_name,
        poa_type: m.poa_type,
        poa_activated: !!m.poa_activated,
        phone: person?.phone ?? null,
        email: person?.email ?? null,
        documents: poaDocsFor(null),
      };
    })
  );
  const providerHolders = provs
    .filter((r) => r.poa_type)
    .map((r) => {
      const c = summaries.get(r.id);
      return {
        name: r.name,
        poa_type: r.poa_type,
        poa_activated: !!r.poa_activated,
        phone: c?.phone ?? null,
        email: c?.email ?? null,
        documents: poaDocsFor(r.id),
      };
    });

  const address = [p['address_line1'], p['address_line2'], p['address_suburb'], p['address_state'], p['address_postcode']]
    .filter((v) => typeof v === 'string' && v.trim())
    .join(', ');
  const planRow = (plan ?? {}) as Record<string, unknown>;
  const allergyRows = allergies as Array<{ substance: string; reaction: string | null; severity: string | null }>;
  const noneOn = dateOnly(p['no_known_allergies_on']);
  return {
    profile: {
      id: profileId,
      full_name: String(p['full_name']),
      preferred_name: (p['preferred_name'] as string | null) ?? null,
      date_of_birth: dateOnly(p['date_of_birth']),
      primary_language: (p['primary_language'] as string | null) ?? null,
      pronouns: (p['pronouns'] as string | null) ?? null,
    },
    residence: {
      residence_type: (p['residence_type'] as string | null) ?? null,
      facility: facility ? { name: (facility as { name: string }).name, phone: (facility as { phone: string | null }).phone ?? null } : null,
      room_number: (p['room_number'] as string | null) ?? null,
      room_area_name: (p['room_area_name'] as string | null) ?? null,
      room_area_type: (p['room_area_type'] as string | null) ?? null,
      address: address || null,
    },
    identifiers: (({ updated_at: _u, ...rest }) => rest)(identifiers),
    allergies: allergyRows.map((a) => ({ substance: a.substance, reaction: a.reaction ?? null, severity: a.severity ?? null })),
    no_known_allergies: allergyRows.length === 0 && noneOn ? { on: noneOn, by_name: (checkedBy as { display_name?: string } | null)?.display_name ?? null } : null,
    conditions: conditions as string[],
    medications: (meds as Array<{ name: string; dose: string | null; as_needed: boolean; schedule_times: unknown; frequency: string | null; critical: boolean; instructions: string | null }>).map((m) => ({
      name: m.name,
      dose: m.dose,
      as_needed: !!m.as_needed,
      schedule_times: asList(m.schedule_times),
      frequency: m.frequency,
      critical: !!m.critical,
      instructions: m.instructions ?? null,
    })),
    eating_drinking_moving: {
      diet: asList(planRow['dietary_requirements']),
      swallowing: asList(planRow['swallowing_needs']),
      mobility: asList(planRow['mobility_aids']),
    },
    advance_care_directive: {
      in_place: !!planRow['advance_care_directive'] || directiveDocs.length > 0,
      location: (planRow['advance_care_directive_location'] as string | null | undefined) ?? null,
      documents: directiveDocs,
    },
    poa_holders: [...memberHolders, ...providerHolders],
    emergency_contacts: contacts,
    professionals,
    communication_needs: asList(planRow['communication_needs']),
  };
}

/** The document ids an emergency sheet names, which its share link may open. */
export function sheetDocumentIds(sheet: EmergencySheet): string[] {
  return [
    ...sheet.advance_care_directive.documents.map((d) => d.id),
    ...sheet.poa_holders.flatMap((h) => h.documents.map((d) => d.id)),
  ];
}
