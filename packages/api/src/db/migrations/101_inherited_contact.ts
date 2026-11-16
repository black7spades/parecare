import type { Knex } from 'knex';

/**
 * Contact details shared down from an organisation.
 *
 * Everyone based at an organisation uses its phone, email, booking link and
 * directions unless they have their own, the same way they already share
 * its address. `inherited_fields` names the details a record takes from the
 * organisation it is based at, so a change there reaches them all.
 *
 * Existing records: a professional with no phone of their own, or the same
 * phone as their organisation, now uses the organisation's, and so on for
 * each detail. Parents are done before children, so a doctor in a clinic in
 * a health hub gets what the clinic got from the hub.
 */
const FIELDS = ['phone', 'email', 'booking_link', 'directions_link'] as const;

type Row = { id: string; practice_id: string | null } & Record<(typeof FIELDS)[number], string | null>;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('providers', (t) => {
    t.specificType('inherited_fields', 'text[]').notNullable().defaultTo('{}');
  });

  const rows = (await knex('providers').select('id', 'practice_id', ...FIELDS)) as Row[];
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
    const inherited: string[] = [];
    const update: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const own = (r[f] ?? '').trim();
      const theirs = parent[f] ?? null;
      if (!own || own === (theirs ?? '').trim()) {
        inherited.push(f);
        update[f] = theirs;
        r[f] = theirs;
      }
    }
    if (inherited.length > 0) {
      await knex('providers').where({ id: r.id }).update({ ...update, inherited_fields: inherited });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('providers', (t) => {
    t.dropColumn('inherited_fields');
  });
}
