import type { Knex } from 'knex';

/**
 * Assets are the equipment kept for someone's care: a wheelchair, a hoist, a
 * hospital bed, a pressure mattress, an oximeter. They are an account-level
 * register, shared across every care profile and mirroring the other directory
 * entities: a name and details, and the same link-to-profiles join so a piece
 * of equipment can be tied to the person or pet it belongs to.
 *
 * Every distinct fact is its own column: the unit name, its serial or unit
 * number, what it cost, when it was bought, its warranty and condition are each
 * captured, stored and exported separately.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('assets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    // The unit name, e.g. "Electric hospital bed".
    t.string('name', 255).notNullable();
    // What kind of equipment it is, e.g. mobility, bathroom, monitoring.
    t.string('category', 100).nullable();
    // The maker's serial number or an internal unit/asset number.
    t.string('serial_number', 120).nullable();
    // The maker or model, for identifying a replacement or a part.
    t.string('make_model', 255).nullable();
    // What it cost and when it was bought.
    t.decimal('price', 12, 2).nullable();
    t.date('purchase_date').nullable();
    // Where it was bought from.
    t.string('supplier', 255).nullable();
    // When the warranty runs out, so a claim is not missed.
    t.date('warranty_expiry').nullable();
    // new | good | fair | poor | retired
    t.string('condition', 30).nullable();
    // Where the equipment is kept.
    t.string('location', 255).nullable();
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // Link assets to care profiles, the same join providers and suppliers use.
  await knex.schema.createTable('care_profile_assets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    t.uuid('asset_id').notNullable().references('id').inTable('assets').onDelete('CASCADE');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['care_profile_id', 'asset_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('care_profile_assets');
  await knex.schema.dropTableIfExists('assets');
}
