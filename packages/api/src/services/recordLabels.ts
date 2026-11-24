import type { Knex } from 'knex';

type Conn = Knex | Knex.Transaction;

/**
 * What a document is attached to, in words: each link between a document
 * and a record becomes the record's name and the page that opens it. One
 * registry, so every kind of record is named the same way everywhere.
 */
export interface AttachedTo {
  kind: string;
  id: string;
  /** What the record is called, e.g. "Book a neurologist". */
  label: string;
  /** What kind of record it is, e.g. "Task". */
  kind_label: string;
  /** The page inside PareCare that opens it. */
  path: string;
}

interface KindSpec {
  kind_label: string;
  /** The page under /app/:profileId that lists it; '' is the overview. */
  page: string | null;
  /** Each record's name by id, for records belonging to this person. */
  names: (conn: Conn, profileId: string, ids: string[]) => Promise<Array<{ id: string; label: string | null }>>;
}

const simple = (table: string, column: string, profileColumn = 'care_profile_id') =>
  (conn: Conn, profileId: string, ids: string[]) =>
    conn(table).where(profileColumn, profileId).whereIn('id', ids).select('id', `${column} as label`) as Promise<Array<{ id: string; label: string | null }>>;

const KINDS: Record<string, KindSpec> = {
  reminders: { kind_label: 'Task', page: 'tasks', names: simple('reminders', 'title') },
  appointments: { kind_label: 'Appointment', page: 'appointments', names: simple('appointments', 'title') },
  medications: {
    kind_label: 'Medication',
    page: 'medications',
    names: (conn, profileId, ids) =>
      conn('medications as m')
        .join('medication_catalogue as c', 'c.id', 'm.medication_catalogue_id')
        .where('m.care_profile_id', profileId)
        .whereIn('m.id', ids)
        .select('m.id', 'c.name as label'),
  },
  conditions: { kind_label: 'Condition', page: 'conditions', names: simple('medical_conditions', 'name') },
  treatments: { kind_label: 'Treatment', page: 'treatments', names: simple('treatments', 'name') },
  allergies: { kind_label: 'Allergy', page: 'allergies', names: simple('allergies', 'substance') },
  questions: { kind_label: 'Question', page: 'questions', names: simple('open_questions', 'title') },
  log: { kind_label: 'Care log entry', page: '', names: simple('care_log_entries', 'title') },
  providers: {
    kind_label: 'Contact',
    page: 'providers',
    names: (conn, profileId, ids) =>
      conn('providers as p')
        .join('care_profile_providers as cpp', 'cpp.provider_id', 'p.id')
        .where('cpp.care_profile_id', profileId)
        .whereIn('p.id', ids)
        .select('p.id', 'p.name as label'),
  },
  'hospital-stays': {
    kind_label: 'Hospital stay',
    page: 'where-they-live',
    names: (conn, profileId, ids) =>
      conn('hospital_stays as s')
        .leftJoin('providers as p', 'p.id', 's.hospital_provider_id')
        .where('s.care_profile_id', profileId)
        .whereIn('s.id', ids)
        .select('s.id', conn.raw("concat_ws(', ', coalesce(p.name, 'Hospital'), to_char(s.admitted_on, 'DD Mon YYYY')) as label")),
  },
  results: { kind_label: 'Test result', page: 'test-results', names: simple('test_results', 'test_name') },
  'funding-plans': {
    kind_label: 'Funding plan',
    page: 'funding',
    names: (conn, profileId, ids) =>
      conn('funding_plans')
        .where('care_profile_id', profileId)
        .whereIn('id', ids)
        .select(
          'id',
          conn.raw(
            "concat_ws(', ', CASE scheme WHEN 'ndis' THEN 'NDIS plan' WHEN 'support_at_home' THEN 'Support at Home' WHEN 'home_care_package' THEN 'Home Care Package' ELSE 'Other funding' END, to_char(starts_on, 'DD Mon YYYY')) as label"
          )
        ),
  },
  'care-moves': {
    kind_label: 'Move into care',
    page: 'where-they-live',
    names: (conn, profileId, ids) =>
      conn('care_moves as m')
        .leftJoin('providers as p', 'p.id', 'm.facility_provider_id')
        .where('m.care_profile_id', profileId)
        .whereIn('m.id', ids)
        .select('m.id', conn.raw("coalesce(p.name, 'Care home') as label")),
  },
  assets: {
    kind_label: 'Equipment',
    page: 'equipment',
    names: (conn, profileId, ids) =>
      conn('assets as a')
        .join('care_profile_assets as cpa', 'cpa.asset_id', 'a.id')
        .where('cpa.care_profile_id', profileId)
        .whereIn('a.id', ids)
        .select('a.id', 'a.name as label'),
  },
};

/** The path that opens a record of this kind. */
export function recordPath(profileId: string, kind: string, id: string): string {
  const page = KINDS[kind]?.page;
  return page ? `/app/${profileId}/${page}?record=${id}` : `/app/${profileId}?record=${id}`;
}

/** Everything each document is attached to, named, by document id. */
export async function attachedTo(conn: Conn, profileId: string, docIds: string[]): Promise<Map<string, AttachedTo[]>> {
  const out = new Map<string, AttachedTo[]>();
  if (docIds.length === 0) return out;
  const links = (await conn('document_links').whereIn('document_id', docIds).select('document_id', 'entity_type', 'entity_id')) as Array<{
    document_id: string;
    entity_type: string;
    entity_id: string;
  }>;
  const byKind = new Map<string, Set<string>>();
  for (const l of links) {
    if (!KINDS[l.entity_type]) continue;
    if (!byKind.has(l.entity_type)) byKind.set(l.entity_type, new Set());
    byKind.get(l.entity_type)!.add(l.entity_id);
  }
  const names = new Map<string, string>();
  for (const [kind, ids] of byKind) {
    const rows = await KINDS[kind]!.names(conn, profileId, [...ids]);
    for (const r of rows) names.set(`${kind}:${r.id}`, (r.label ?? '').trim() || KINDS[kind]!.kind_label);
  }
  for (const l of links) {
    const label = names.get(`${l.entity_type}:${l.entity_id}`);
    // A link to a record that has gone, or belongs to someone else, is not shown.
    if (!label) continue;
    const list = out.get(l.document_id) ?? [];
    list.push({ kind: l.entity_type, id: l.entity_id, label, kind_label: KINDS[l.entity_type]!.kind_label, path: recordPath(profileId, l.entity_type, l.entity_id) });
    out.set(l.document_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.kind_label.localeCompare(b.kind_label) || a.label.localeCompare(b.label));
  return out;
}
