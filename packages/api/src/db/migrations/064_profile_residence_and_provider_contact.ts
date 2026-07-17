import type { Knex } from 'knex';

/**
 * Where a person or pet lives, and who to contact about them, captured as
 * discrete fields.
 *
 * 1. Contact can now be a provider: "to reach Viv, phone Regis aged care".
 *    contact_kind gains the value 'provider' and contact_provider_id points
 *    at the provider whose phone and email stand in for a personal one.
 *
 * 2. Residence is typed (private home, care facility, group home, and so
 *    on) so a person in care reads differently from one living at home.
 *
 * 3. A private address is segmented: line 1, line 2, suburb, state,
 *    postcode and country are each their own column, filled by the same
 *    address finder the providers use. Never one packed string.
 *
 * 4. A person in a facility has that facility as a provider
 *    (residence_provider_id) plus their spot within it: a room number and a
 *    named area of a chosen kind, e.g. room 42 of the "Carnak" wing.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    // 1. Contact via a provider.
    t.uuid('contact_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');

    // 2. What kind of place they live in.
    // private_residence | care_facility | retirement_village | group_home | hospital | other
    t.string('residence_type', 30).nullable();

    // 3. Segmented private address, one data point per column.
    t.string('address_line1', 255).nullable();
    t.string('address_line2', 255).nullable();
    t.string('address_suburb', 120).nullable();
    t.string('address_state', 120).nullable();
    t.string('address_postcode', 20).nullable();
    t.string('address_country', 120).nullable();

    // 4. A place within a facility.
    t.uuid('residence_provider_id').nullable().references('id').inTable('providers').onDelete('SET NULL');
    t.string('room_number', 50).nullable();
    // The named area and its kind are two data points: "Carnak" + "wing".
    t.string('room_area_name', 120).nullable();
    // wing | floor | unit | building | house | ward | block | other
    t.string('room_area_type', 30).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.dropColumn('contact_provider_id');
    t.dropColumn('residence_type');
    t.dropColumn('address_line1');
    t.dropColumn('address_line2');
    t.dropColumn('address_suburb');
    t.dropColumn('address_state');
    t.dropColumn('address_postcode');
    t.dropColumn('address_country');
    t.dropColumn('residence_provider_id');
    t.dropColumn('room_number');
    t.dropColumn('room_area_name');
    t.dropColumn('room_area_type');
  });
}
