import type { Knex } from 'knex';

/**
 * Central medication catalogue. A drug (name + form) is stored once and shared
 * across everyone prescribed it, so there is no duplicate "Paracetamol" per
 * person. Each per-person medication now references a catalogue entry and only
 * carries the variables that differ (dose, route, schedule, prescriber...).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('medication_catalogue', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 255).notNullable();
    t.string('form', 100).nullable();
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
  });
  // One shared entry per drug name + form (case-insensitive).
  await knex.raw(
    "CREATE UNIQUE INDEX medication_catalogue_name_form_uniq ON medication_catalogue (lower(name), lower(coalesce(form, '')))"
  );

  // Link per-person medications to the catalogue. RESTRICT so a drug still in
  // use cannot be deleted out from under someone's prescription.
  await knex.schema.alterTable('medications', (t) => {
    t.uuid('medication_catalogue_id').nullable().references('id').inTable('medication_catalogue').onDelete('RESTRICT');
  });

  // Backfill: fold existing per-person name/form into shared catalogue entries.
  const meds = await knex('medications').select('id', 'name', 'form');
  const seen = new Map<string, string>();
  for (const m of meds) {
    const name = String(m.name ?? '').trim();
    if (!name) continue;
    const form = String(m.form ?? '').trim() || null;
    const key = `${name.toLowerCase()}|${(form ?? '').toLowerCase()}`;
    let catId = seen.get(key);
    if (!catId) {
      const [row] = await knex('medication_catalogue').insert({ name, form }).returning('id');
      catId = (row as { id: string }).id;
      seen.set(key, catId);
    }
    await knex('medications').where({ id: m.id }).update({ medication_catalogue_id: catId });
  }

  // Now every medication is linked; make it required and drop the duplicated
  // name/form columns from the per-person table.
  await knex.schema.alterTable('medications', (t) => {
    t.uuid('medication_catalogue_id').notNullable().alter();
  });
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('name');
    t.dropColumn('form');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medications', (t) => {
    t.string('name', 255).nullable();
    t.string('form', 100).nullable();
  });
  // Restore denormalised name/form from the catalogue.
  const rows = await knex('medications as m')
    .join('medication_catalogue as c', 'm.medication_catalogue_id', 'c.id')
    .select('m.id', 'c.name', 'c.form');
  for (const r of rows) {
    await knex('medications').where({ id: r.id }).update({ name: r.name, form: r.form });
  }
  await knex.schema.alterTable('medications', (t) => {
    t.dropColumn('medication_catalogue_id');
  });
  await knex.schema.dropTable('medication_catalogue');
}
