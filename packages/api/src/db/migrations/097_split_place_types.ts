import type { Knex } from 'knex';

/**
 * One type per thing. "Clinic or practice" was one provider type naming two
 * kinds of place; it becomes Practice and Clinic, and Medical centre and
 * Health centre join the shared list as kinds of their own.
 *
 * Places already filed under the old type are given the kind their name
 * says ("Brain Clinic" is a clinic, "Caboolture Hospital" a hospital);
 * anything else stays a practice, which is what most of them are.
 */

const RULES: Array<[RegExp, string]> = [
  [/\bclinic\b/i, 'clinic'],
  [/\bhospital\b/i, 'Hospital'],
  [/\b(pharmacy|chemist)\b/i, 'pharmacy'],
  [/\bmedical cent(re|er)\b/i, 'Medical centre'],
  [/\bhealth cent(re|er)\b/i, 'Health centre'],
  [/\b(pathology|path lab)\b/i, 'Pathology'],
  [/\b(radiology|imaging|x-ray)\b/i, 'Radiology'],
];

export async function up(knex: Knex): Promise<void> {
  for (const name of ['Medical centre', 'Health centre']) {
    const exists = await knex('option_catalogue').where({ category: 'provider_type' }).whereRaw('lower(name) = lower(?)', [name]).first();
    if (!exists) await knex('option_catalogue').insert({ category: 'provider_type', name });
  }

  const places = (await knex('providers').where({ provider_type: 'practice' }).select('id', 'name')) as Array<{ id: string; name: string }>;
  for (const p of places) {
    const hit = RULES.find(([re]) => re.test(p.name));
    if (hit) await knex('providers').where({ id: p.id }).update({ provider_type: hit[1] });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Clinic is the only new built-in kind; the others were already valid types.
  await knex('providers').where({ provider_type: 'clinic' }).update({ provider_type: 'practice' });
}
