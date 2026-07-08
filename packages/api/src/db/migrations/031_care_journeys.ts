import type { Knex } from 'knex';
import { JOURNEY_TEMPLATES, LIFE_STAGES } from '../journeys/catalogue';

/**
 * Care Journeys: life stages and journey templates from conception to
 * death, replacing the single hard-coded ageing phase enum.
 *
 * Two layers. The template library (life_stages, journey_templates and
 * children) is what admins curate; journey instances (care_journeys,
 * care_journey_phases) are per-person copies made at enrolment, so
 * editing a template never rewrites anyone's history.
 *
 * Backfill: the six legacy current_phase values become the phases of the
 * "More help at home to residential care" system template; every
 * existing profile is enrolled in it, care_phase_history carries over
 * into care_journey_phases (same lock semantics), and existing
 * checklist items are linked to their journey phase.
 */
export async function up(knex: Knex): Promise<void> {
  // ---------------------------------------------------------------- schema
  await knex.schema.createTable('life_stages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 100).notNullable();
    t.text('description').nullable();
    // Null bound means unbounded on that side; both null means any age.
    t.integer('min_age_years').nullable();
    t.integer('max_age_years').nullable();
    // Matched by due date for profiles not yet born.
    t.boolean('applies_before_birth').notNullable().defaultTo(false);
    t.integer('sort_order').notNullable().defaultTo(0);
    // Retired stages keep their template assignments but stop suggesting.
    t.boolean('retired').notNullable().defaultTo(false);
    t.boolean('is_system').notNullable().defaultTo(false);
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('journey_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // Stable identifier for system templates (handover wiring, backfill).
    t.string('slug', 100).nullable().unique();
    t.string('name', 150).notNullable();
    t.text('description').nullable();
    t.string('kind', 30).notNullable().defaultTo('life_stage');
    t.boolean('is_system').notNullable().defaultTo(false);
    t.string('status', 20).notNullable().defaultTo('published');
    t.uuid('source_template_id').nullable().references('id').inTable('journey_templates').onDelete('SET NULL');
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('journey_template_life_stages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('template_id').notNullable().references('id').inTable('journey_templates').onDelete('CASCADE');
    t.uuid('life_stage_id').notNullable().references('id').inTable('life_stages').onDelete('CASCADE');
    t.unique(['template_id', 'life_stage_id']);
    t.index('life_stage_id');
  });

  await knex.schema.createTable('journey_template_phases', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('template_id').notNullable().references('id').inTable('journey_templates').onDelete('CASCADE');
    t.string('name', 150).notNullable();
    t.text('description').nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    // Legacy care_profiles.current_phase value this phase mirrors, only
    // set on the migrated ageing template.
    t.string('legacy_phase', 50).nullable();
    t.index('template_id');
  });

  await knex.schema.createTable('journey_template_tasks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('template_phase_id').notNullable().references('id').inTable('journey_template_phases').onDelete('CASCADE');
    t.string('title', 255).notNullable();
    t.text('description').nullable();
    // Milestone tasks surface in the Memory Book timeline when completed.
    t.boolean('is_milestone').notNullable().defaultTo(false);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.index('template_phase_id');
  });

  await knex.schema.createTable('journey_template_handovers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('from_template_id').notNullable().references('id').inTable('journey_templates').onDelete('CASCADE');
    // Null means the handover is offered from any phase of the journey.
    t.uuid('from_phase_id').nullable().references('id').inTable('journey_template_phases').onDelete('CASCADE');
    t.uuid('to_template_id').notNullable().references('id').inTable('journey_templates').onDelete('CASCADE');
    t.string('label', 255).notNullable();
    t.index('from_template_id');
  });

  await knex.schema.createTable('care_journeys', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_profile_id').notNullable().references('id').inTable('care_profiles').onDelete('CASCADE');
    // Null for bespoke journeys built from scratch for one person.
    t.uuid('template_id').nullable().references('id').inTable('journey_templates').onDelete('SET NULL');
    t.string('name', 150).notNullable();
    t.string('status', 20).notNullable().defaultTo('active');
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('ended_at').nullable();
    t.uuid('handed_over_to_journey_id').nullable().references('id').inTable('care_journeys').onDelete('SET NULL');
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index('care_profile_id');
  });

  await knex.schema.createTable('care_journey_phases', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('care_journey_id').notNullable().references('id').inTable('care_journeys').onDelete('CASCADE');
    // Where this phase was copied from, for re-seeding tasks on entry.
    t.uuid('template_phase_id').nullable().references('id').inTable('journey_template_phases').onDelete('SET NULL');
    t.string('name', 150).notNullable();
    t.text('description').nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.string('legacy_phase', 50).nullable();
    // State is derived: upcoming (entered_at null), current (entered, not
    // locked), locked (locked_at set). One fact, one column.
    t.timestamp('entered_at').nullable();
    t.timestamp('locked_at').nullable();
    t.uuid('locked_by').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.index('care_journey_id');
  });

  await knex.schema.alterTable('checklist_items', (t) => {
    t.uuid('care_journey_phase_id').nullable().references('id').inTable('care_journey_phases').onDelete('CASCADE');
    // The day it really happened, distinct from completed_at, which is
    // when the box was ticked in the app. Two facts, two columns.
    t.date('achieved_on').nullable();
    t.boolean('is_milestone').notNullable().defaultTo(false);
    t.index('care_journey_phase_id');
  });
  // Journey checklist items carry no legacy phase slug.
  await knex.schema.alterTable('checklist_items', (t) => {
    t.string('phase', 50).nullable().alter();
  });

  await knex.schema.alterTable('checklist_item_notes', (t) => {
    t.string('photo_url', 500).nullable();
  });

  await knex.schema.alterTable('memory_book_entries', (t) => {
    // Set when a Memory Book story is written about an achievement.
    t.uuid('checklist_item_id').nullable().references('id').inTable('checklist_items').onDelete('SET NULL');
  });

  await knex.schema.alterTable('care_profiles', (t) => {
    // Expected babies get a profile before birth.
    t.date('due_date').nullable();
  });

  // ------------------------------------------------------------- seed data
  const stageIdByName = new Map<string, string>();
  for (const stage of LIFE_STAGES) {
    const [row] = await knex('life_stages')
      .insert({
        name: stage.name,
        description: stage.description,
        min_age_years: stage.min_age_years,
        max_age_years: stage.max_age_years,
        applies_before_birth: stage.applies_before_birth,
        sort_order: stage.sort_order,
        is_system: true,
      })
      .returning('id');
    stageIdByName.set(stage.name, row.id);
  }

  const templateIdBySlug = new Map<string, string>();
  const phaseIdsBySlug = new Map<string, Array<{ id: string; legacy: string | null }>>();
  for (const tpl of JOURNEY_TEMPLATES) {
    const [row] = await knex('journey_templates')
      .insert({
        slug: tpl.slug,
        name: tpl.name,
        description: tpl.description,
        kind: tpl.kind,
        is_system: true,
        status: 'published',
      })
      .returning('id');
    templateIdBySlug.set(tpl.slug, row.id);

    await knex('journey_template_life_stages').insert(
      tpl.stages.map((name) => ({ template_id: row.id, life_stage_id: stageIdByName.get(name) }))
    );

    const phaseRows: Array<{ id: string; legacy: string | null }> = [];
    for (const [i, phase] of tpl.phases.entries()) {
      const [phaseRow] = await knex('journey_template_phases')
        .insert({
          template_id: row.id,
          name: phase.name,
          description: phase.description ?? null,
          sort_order: i,
          legacy_phase: phase.legacy ?? null,
        })
        .returning('id');
      phaseRows.push({ id: phaseRow.id, legacy: phase.legacy ?? null });
      const tasks = phase.tasks ?? [];
      if (tasks.length > 0) {
        await knex('journey_template_tasks').insert(
          tasks.map((task, j) => ({
            template_phase_id: phaseRow.id,
            title: task.title,
            description: task.description ?? null,
            is_milestone: task.milestone ?? false,
            sort_order: j,
          }))
        );
      }
    }
    phaseIdsBySlug.set(tpl.slug, phaseRows);
  }

  for (const tpl of JOURNEY_TEMPLATES) {
    for (const handover of tpl.handovers ?? []) {
      const to = templateIdBySlug.get(handover.to);
      if (!to) continue;
      await knex('journey_template_handovers').insert({
        from_template_id: templateIdBySlug.get(tpl.slug),
        to_template_id: to,
        label: handover.label,
      });
    }
  }

  // -------------------------------------------------------------- backfill
  const ageingTemplateId = templateIdBySlug.get('more-help-at-home')!;
  const ageingTemplate = JOURNEY_TEMPLATES.find((t) => t.slug === 'more-help-at-home')!;
  const templatePhases = await knex('journey_template_phases')
    .where({ template_id: ageingTemplateId })
    .orderBy('sort_order', 'asc');
  const templateTasksByPhase = new Map<string, Array<{ title: string; description: string | null; is_milestone: boolean; sort_order: number }>>();
  for (const p of templatePhases) {
    templateTasksByPhase.set(
      p.id,
      await knex('journey_template_tasks').where({ template_phase_id: p.id }).orderBy('sort_order', 'asc')
    );
  }
  const legacyOrder = ageingTemplate.phases.map((p) => p.legacy!);

  const profiles = await knex('care_profiles').select('id', 'current_phase', 'created_at', 'updated_at');
  for (const profile of profiles) {
    const history = await knex('care_phase_history').where({ care_profile_id: profile.id });
    const historyByPhase = new Map(history.map((h) => [h.phase, h]));
    const currentIndex = Math.max(0, legacyOrder.indexOf(profile.current_phase));

    const [journey] = await knex('care_journeys')
      .insert({
        care_profile_id: profile.id,
        template_id: ageingTemplateId,
        name: ageingTemplate.name,
        status: 'active',
        started_at: profile.created_at ?? knex.fn.now(),
      })
      .returning('id');

    for (const [i, tp] of templatePhases.entries()) {
      const h = historyByPhase.get(tp.legacy_phase);
      let entered_at: Date | string | null = null;
      let locked_at: Date | string | null = null;
      let locked_by: string | null = null;
      if (i < currentIndex) {
        // A phase the profile has already moved past: locked record.
        entered_at = h?.entered_at ?? profile.created_at ?? new Date();
        locked_at = h?.locked_at ?? profile.updated_at ?? new Date();
        locked_by = h?.locked_by ?? null;
      } else if (i === currentIndex) {
        entered_at = h?.entered_at ?? profile.created_at ?? new Date();
      }
      const [journeyPhase] = await knex('care_journey_phases')
        .insert({
          care_journey_id: journey.id,
          template_phase_id: tp.id,
          name: tp.name,
          description: tp.description,
          sort_order: tp.sort_order,
          legacy_phase: tp.legacy_phase,
          entered_at,
          locked_at,
          locked_by,
        })
        .returning('id');

      // Adopt this profile's existing checklist items for the phase.
      const adopted = await knex('checklist_items')
        .where({ care_profile_id: profile.id, phase: tp.legacy_phase })
        .update({ care_journey_phase_id: journeyPhase.id });

      // Seed template tasks only for phases that have no items yet and
      // are not already locked history, mirroring enrolment behaviour
      // without polluting locked records with unticked boxes.
      if (adopted === 0 && !locked_at) {
        const tasks = templateTasksByPhase.get(tp.id) ?? [];
        if (tasks.length > 0) {
          await knex('checklist_items').insert(
            tasks.map((task) => ({
              care_profile_id: profile.id,
              care_journey_phase_id: journeyPhase.id,
              phase: tp.legacy_phase,
              title: task.title,
              description: task.description,
              is_milestone: task.is_milestone,
              sort_order: task.sort_order,
            }))
          );
        }
      }
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('care_profiles', (t) => {
    t.dropColumn('due_date');
  });
  await knex.schema.alterTable('memory_book_entries', (t) => {
    t.dropColumn('checklist_item_id');
  });
  await knex.schema.alterTable('checklist_item_notes', (t) => {
    t.dropColumn('photo_url');
  });
  // Items created under the journey system have no legacy phase; they
  // cannot survive a rollback to the enum-only world.
  await knex('checklist_items').whereNull('phase').delete();
  await knex.schema.alterTable('checklist_items', (t) => {
    t.dropColumn('care_journey_phase_id');
    t.dropColumn('achieved_on');
    t.dropColumn('is_milestone');
  });
  await knex.schema.alterTable('checklist_items', (t) => {
    t.string('phase', 50).notNullable().alter();
  });
  await knex.schema.dropTable('care_journey_phases');
  await knex.schema.dropTable('care_journeys');
  await knex.schema.dropTable('journey_template_handovers');
  await knex.schema.dropTable('journey_template_tasks');
  await knex.schema.dropTable('journey_template_phases');
  await knex.schema.dropTable('journey_template_life_stages');
  await knex.schema.dropTable('journey_templates');
  await knex.schema.dropTable('life_stages');
}
