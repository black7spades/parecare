import type { Knex } from 'knex';

/**
 * A symptom's severity changes as an illness runs its course. Each
 * change is kept as its own dated reading, so the course of an acute
 * illness can be seen over time rather than only its latest state.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('condition_symptom_readings', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('symptom_id').notNullable().references('id').inTable('condition_symptoms').onDelete('CASCADE');
    t.integer('severity').notNullable();
    t.timestamp('recorded_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable('condition_symptom_readings', (t) => {
    t.index(['symptom_id', 'recorded_at']);
  });

  // Every existing symptom's current severity becomes its first reading.
  await knex.raw(`
    INSERT INTO condition_symptom_readings (symptom_id, severity, recorded_at)
    SELECT id, severity, noted_at FROM condition_symptoms
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('condition_symptom_readings');
}
