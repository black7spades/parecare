import type { Knex } from 'knex';

/**
 * The care plan becomes a data-surfacing page, so every free-text box on it
 * needs an established source database behind a dropdown instead. This
 * migration provides that and relocates the data entry that had no business
 * living on the plan:
 *
 * 1. option_catalogue: one shared, instance-wide list of selectable values,
 *    categorised (allergens, allergy reactions, dietary requirements,
 *    mobility aids, communication needs, directive locations). Seeded with
 *    common values; anything a user adds that is not in it yet joins the
 *    catalogue and is offered to everyone from then on, the same way the
 *    medication and condition catalogues work. Existing recorded values are
 *    backfilled so nothing already typed is lost as a suggestion.
 *
 * 2. care_plans.communication_needs: the prose communication_preferences
 *    box becomes a list of discrete needs (one multi-valued field of values
 *    of the same kind). Existing prose is carried over as a single item so
 *    nothing is lost, then the old column is dropped.
 *
 * 3. The GP's name, practice and phone move to the providers table, where
 *    every other provider already lives. Plans that named a GP get a
 *    provider row (unless the profile already has a GP provider), then the
 *    three plan columns are dropped.
 *
 * The legacy conditions and medications jsonb columns on care_plans stay
 * put: both were superseded by first-class tables (032 and 022) and are
 * simply no longer written.
 */

const SEEDS: Record<string, string[]> = {
  allergen: [
    'Penicillin',
    'Amoxicillin',
    'Aspirin',
    'Ibuprofen',
    'Codeine',
    'Morphine',
    'Sulfa drugs',
    'Contrast dye',
    'Latex',
    'Adhesive tape',
    'Peanuts',
    'Tree nuts',
    'Eggs',
    'Milk',
    'Soy',
    'Wheat',
    'Fish',
    'Shellfish',
    'Sesame',
    'Bee stings',
    'Dust mites',
    'Pollen',
    'Pet dander',
  ],
  allergy_reaction: [
    'Anaphylaxis',
    'Rash',
    'Hives',
    'Swelling of the face or throat',
    'Difficulty breathing',
    'Wheezing',
    'Vomiting',
    'Diarrhoea',
    'Stomach pain',
    'Itching',
    'Runny nose and sneezing',
    'Dizziness',
  ],
  dietary_requirement: [
    'Low salt',
    'Low sugar',
    'Diabetic diet',
    'Gluten free',
    'Dairy free',
    'Nut free',
    'Vegetarian',
    'Vegan',
    'Halal',
    'Kosher',
    'Pureed food',
    'Soft food',
    'Thickened fluids',
    'Small frequent meals',
    'High protein',
    'High fibre',
    'Low fat',
    'Fluid restriction',
    'No caffeine',
    'No alcohol',
  ],
  mobility_aid: [
    'Walking stick',
    'Walking frame',
    'Wheeled walker',
    'Wheelchair',
    'Powered wheelchair',
    'Mobility scooter',
    'Crutches',
    'Hoist',
    'Transfer board',
    'Grab rails',
    'Shower chair',
    'Bed rail',
    'Prosthetic limb',
    'Orthotic brace',
    'Stairlift',
  ],
  communication_need: [
    'Hard of hearing in the left ear',
    'Hard of hearing in the right ear',
    'Wears hearing aids',
    'Speak slowly and clearly',
    'Speak face to face',
    'Needs glasses to read',
    'Large print needed',
    'Non-verbal',
    'Uses a communication device',
    'Uses sign language',
    'Needs an interpreter',
    'Limited English',
    'Written instructions help',
    'Extra time to respond',
    'Prefers yes or no questions',
  ],
  directive_location: [
    'With the GP',
    'Uploaded in Documents',
    'With the family at home',
    'With the lawyer',
    'At the care facility',
    'With the hospital',
  ],
};

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('option_catalogue', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('category', 50).notNullable();
    t.string('name', 255).notNullable();
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index('category');
  });
  // One shared entry per category + name (case-insensitive).
  await knex.raw('CREATE UNIQUE INDEX option_catalogue_category_name_uniq ON option_catalogue (category, lower(name))');

  const rows = Object.entries(SEEDS).flatMap(([category, names]) => names.map((name) => ({ category, name })));
  await knex('option_catalogue').insert(rows);

  // Backfill the catalogue from what people already recorded, so their own
  // values are suggested from day one.
  const insertMissing = async (category: string, values: Array<string | null | undefined>) => {
    const unique = [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))];
    for (const name of unique) {
      const existing = await knex('option_catalogue')
        .where({ category })
        .whereRaw('lower(name) = lower(?)', [name])
        .first();
      if (!existing) await knex('option_catalogue').insert({ category, name });
    }
  };

  const plans = await knex('care_plans').select(
    'id',
    'care_profile_id',
    'dietary_requirements',
    'mobility_aids',
    'communication_preferences',
    'advance_care_directive_location',
    'gp_name',
    'gp_practice',
    'gp_phone'
  );
  const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  await insertMissing('dietary_requirement', plans.flatMap((p) => asArray(p.dietary_requirements)));
  await insertMissing('mobility_aid', plans.flatMap((p) => asArray(p.mobility_aids)));
  await insertMissing('directive_location', plans.map((p) => p.advance_care_directive_location));

  const allergies = await knex('allergies').select('substance', 'reaction');
  await insertMissing('allergen', allergies.map((a) => a.substance));
  await insertMissing('allergy_reaction', allergies.map((a) => a.reaction));

  // Communication becomes a list of discrete needs. Existing prose carries
  // over as a single item (and a catalogue entry) so nothing is lost.
  await knex.schema.alterTable('care_plans', (t) => {
    t.jsonb('communication_needs').notNullable().defaultTo('[]');
  });
  for (const plan of plans) {
    const prose = String((plan as { communication_preferences?: string | null }).communication_preferences ?? '').trim();
    if (!prose) continue;
    await knex('care_plans')
      .where({ id: plan.id })
      .update({ communication_needs: JSON.stringify([prose]) });
    await insertMissing('communication_need', [prose]);
  }
  await knex.schema.alterTable('care_plans', (t) => {
    t.dropColumn('communication_preferences');
  });

  // The GP joins the providers table, where entry now happens.
  for (const plan of plans) {
    const gpName = String(plan.gp_name ?? '').trim();
    if (!gpName) continue;
    const existingGp = await knex('providers')
      .where({ care_profile_id: plan.care_profile_id, provider_type: 'gp' })
      .first();
    if (existingGp) continue;
    await knex('providers').insert({
      care_profile_id: plan.care_profile_id,
      provider_type: 'gp',
      name: gpName,
      organisation: String(plan.gp_practice ?? '').trim() || null,
      phone: String(plan.gp_phone ?? '').trim() || null,
    });
  }
  await knex.schema.alterTable('care_plans', (t) => {
    t.dropColumn('gp_name');
    t.dropColumn('gp_practice');
    t.dropColumn('gp_phone');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_plans', (t) => {
    t.string('gp_name', 255).nullable();
    t.string('gp_practice', 255).nullable();
    t.string('gp_phone', 50).nullable();
    t.text('communication_preferences').nullable();
  });
  // Restore the prose column from the first listed need.
  const plans = await knex('care_plans').select('id', 'communication_needs');
  for (const plan of plans) {
    const needs: string[] = Array.isArray(plan.communication_needs) ? plan.communication_needs : [];
    if (needs.length > 0) {
      await knex('care_plans').where({ id: plan.id }).update({ communication_preferences: needs.join('. ') });
    }
  }
  await knex.schema.alterTable('care_plans', (t) => {
    t.dropColumn('communication_needs');
  });
  await knex.schema.dropTable('option_catalogue');
}
