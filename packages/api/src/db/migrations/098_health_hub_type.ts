import type { Knex } from 'knex';

/**
 * A health hub is a kind of place of its own: one building with many
 * services, practices and clinics inside it. It joins the shared list of
 * provider types, and any place filed as a practice whose name says it is a
 * health hub ("Health Hub Morayfield") becomes one.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex('option_catalogue').where({ category: 'provider_type' }).whereRaw('lower(name) = lower(?)', ['Health hub']).first();
  if (!exists) await knex('option_catalogue').insert({ category: 'provider_type', name: 'Health hub' });
  await knex('providers').where({ provider_type: 'practice' }).whereRaw('name ~* ?', ['\\mhealth ?hub\\M']).update({ provider_type: 'Health hub' });
}

export async function down(knex: Knex): Promise<void> {
  await knex('providers').where({ provider_type: 'Health hub' }).update({ provider_type: 'practice' });
}
