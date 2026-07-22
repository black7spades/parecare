import type { Knex } from 'knex';

/**
 * Link a treatment to the asset it uses, so a piece of equipment that manages a
 * condition (a CPAP unit for sleep apnea) is the same record as the one in the
 * asset register, not a loose duplicate. A device treatment carries the asset
 * it represents; through the treatment's condition, the equipment is tied to
 * the condition it treats. Nullable: most treatments are not a device.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('treatments', 'asset_id'))) {
    await knex.schema.alterTable('treatments', (t) => {
      t.uuid('asset_id').nullable().references('id').inTable('assets').onDelete('SET NULL');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('treatments', 'asset_id')) {
    await knex.schema.alterTable('treatments', (t) => t.dropColumn('asset_id'));
  }
}
