import type { Knex } from 'knex';

/**
 * Structured name fields on care profiles. Each name part is its own column
 * (title, first, middle, last, suffix) and full_name becomes the composed
 * display name derived from the parts. Existing full names are split so
 * nothing is re-entered: first word to first_name, last word to last_name,
 * anything between to middle_name.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.string('title', 50).nullable();
    t.string('first_name', 100).nullable();
    t.string('middle_name', 100).nullable();
    t.string('last_name', 100).nullable();
    t.string('suffix', 50).nullable();
  });

  const profiles = await knex('care_profiles').select('id', 'full_name');
  for (const p of profiles) {
    const words = String(p.full_name ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const first_name = words[0];
    const last_name = words.length > 1 ? words[words.length - 1] : null;
    const middle_name = words.length > 2 ? words.slice(1, -1).join(' ') : null;
    await knex('care_profiles').where({ id: p.id }).update({ first_name, middle_name, last_name });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.dropColumn('title');
    t.dropColumn('first_name');
    t.dropColumn('middle_name');
    t.dropColumn('last_name');
    t.dropColumn('suffix');
  });
}
