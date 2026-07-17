import type { Knex } from 'knex';

/**
 * Symptom severity moves from a 1-5 scale to a finer 1-10 scale, tracked
 * with a slider alone. Existing values double so they keep their meaning:
 * a 3 (moderate of 5) becomes a 6 (moderate of 10), a 4 becomes an 8 and
 * still counts as above moderate for the GP health alerts.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('UPDATE condition_symptoms SET severity = severity * 2 WHERE severity <= 5');
  await knex.raw('UPDATE condition_symptom_readings SET severity = severity * 2 WHERE severity <= 5');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('UPDATE condition_symptoms SET severity = GREATEST(1, LEAST(5, ROUND(severity / 2.0)))');
  await knex.raw('UPDATE condition_symptom_readings SET severity = GREATEST(1, LEAST(5, ROUND(severity / 2.0)))');
}
