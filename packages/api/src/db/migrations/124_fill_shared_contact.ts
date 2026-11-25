import type { Knex } from 'knex';

/**
 * Fill contact details left empty under an organisation.
 *
 * Someone based at an organisation uses its phone, email and the rest when
 * they have none of their own. A record that joined before the organisation
 * had a phone, or was filed some other way, could keep an empty phone that
 * never followed it. Every empty detail now takes the organisation's and
 * follows it from then on. Parents are done before children, so a doctor in
 * a clinic in a health hub gets what the clinic got from the hub.
 */
const FIELDS = ['phone', 'email', 'booking_link', 'directions_link', 'fax', 'after_hours_phone'] as const;

type Row = { id: string; practice_id: string | null; inherited_fields: string[] | null; opening_hours: unknown } & Record<(typeof FIELDS)[number], string | null>;

const hasHours = (v: unknown) => Array.isArray(v) ? v.length > 0 : !!v && v !== 'null' && v !== '[]';

export async function up(knex: Knex): Promise<void> {
  const rows = (await knex('providers').select('id', 'practice_id', 'inherited_fields', 'opening_hours', ...FIELDS)) as Row[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depth = (r: Row): number => {
    let d = 0;
    let cursor = r.practice_id;
    while (cursor && d < 20) {
      d += 1;
      cursor = byId.get(cursor)?.practice_id ?? null;
    }
    return d;
  };
  const ordered = rows.filter((r) => r.practice_id).sort((a, b) => depth(a) - depth(b));
  for (const r of ordered) {
    const parent = byId.get(r.practice_id!);
    if (!parent) continue;
    const inherited = new Set(r.inherited_fields ?? []);
    const update: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const theirs = (parent[f] ?? '').trim();
      if (!theirs || (r[f] ?? '').trim()) continue;
      update[f] = theirs;
      r[f] = theirs;
      inherited.add(f);
    }
    if (hasHours(parent.opening_hours) && !hasHours(r.opening_hours)) {
      update['opening_hours'] = typeof parent.opening_hours === 'string' ? parent.opening_hours : JSON.stringify(parent.opening_hours);
      r.opening_hours = parent.opening_hours;
      inherited.add('opening_hours');
    }
    if (Object.keys(update).length > 0) {
      await knex('providers').where({ id: r.id }).update({ ...update, inherited_fields: [...inherited] });
    }
  }
}

export async function down(): Promise<void> {
  // Filled details stay: they are the organisation's, and editing one makes it their own.
}
