import type { Knex } from 'knex';

/**
 * Turn the health spend ledger into something an accountant can reconcile and
 * claim against, and give assets a depreciation basis.
 *
 * On each spend entry: the tax (GST/VAT) component split out from the total, a
 * funding source, how much is claimable and its claim status, how much has been
 * reimbursed, and an account code for accounting-software mapping. Every figure
 * is its own column; the amount stays the gross total and ex-tax is derived.
 *
 * Receipts are attached to an entry as evidence, stored the same way documents
 * are. Assets gain a useful-life so a straight-line depreciation and current
 * book value can be worked out from the price and purchase date already held.
 */
export async function up(knex: Knex): Promise<void> {
  const cols: Array<[string, (t: Knex.AlterTableBuilder) => void]> = [
    ['tax_amount', (t) => t.decimal('tax_amount', 12, 2).nullable()],
    ['funding_source', (t) => t.string('funding_source', 30).nullable()],
    ['claimable_amount', (t) => t.decimal('claimable_amount', 12, 2).nullable()],
    ['claim_status', (t) => t.string('claim_status', 20).notNullable().defaultTo('none')],
    ['reimbursed_amount', (t) => t.decimal('reimbursed_amount', 12, 2).nullable()],
    ['account_code', (t) => t.string('account_code', 50).nullable()],
  ];
  for (const [name, add] of cols) {
    if (!(await knex.schema.hasColumn('health_spend_entries', name))) {
      await knex.schema.alterTable('health_spend_entries', add);
    }
  }

  if (!(await knex.schema.hasTable('health_spend_receipts'))) {
    await knex.schema.createTable('health_spend_receipts', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('entry_id').notNullable().references('id').inTable('health_spend_entries').onDelete('CASCADE');
      t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
      t.string('filename', 400).notNullable();
      // The storage key/url, the same shape documents use.
      t.text('file_url').notNullable();
      t.string('content_type', 200).nullable();
      t.integer('size_bytes').nullable();
      t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['entry_id']);
    });
  }

  if (!(await knex.schema.hasColumn('assets', 'useful_life_years'))) {
    await knex.schema.alterTable('assets', (t) => {
      // Years the equipment is written down over, for straight-line depreciation.
      t.integer('useful_life_years').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('health_spend_receipts');
  if (await knex.schema.hasColumn('assets', 'useful_life_years')) {
    await knex.schema.alterTable('assets', (t) => t.dropColumn('useful_life_years'));
  }
  for (const name of ['tax_amount', 'funding_source', 'claimable_amount', 'claim_status', 'reimbursed_amount', 'account_code']) {
    if (await knex.schema.hasColumn('health_spend_entries', name)) {
      await knex.schema.alterTable('health_spend_entries', (t) => t.dropColumn(name));
    }
  }
}
