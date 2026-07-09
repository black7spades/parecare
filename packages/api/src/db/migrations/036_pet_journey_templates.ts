import type { Knex } from 'knex';
import { PET_JOURNEY_TEMPLATES } from '../journeys/catalogue';

/**
 * Seed the pet care journey templates. These sit alongside the human
 * catalogue from migration 031 but carry no life stages, so they are never
 * age-suggested to people; they are offered from pet onboarding and the
 * journey library instead. Everything lands as ordinary editable data.
 *
 * Idempotent by slug: a template whose slug already exists is left alone,
 * so a fresh database that later gains these in migration 031 would not be
 * double-seeded here.
 */
export async function up(knex: Knex): Promise<void> {
  const templateIdBySlug = new Map<string, string>();

  for (const tpl of PET_JOURNEY_TEMPLATES) {
    const existing = await knex('journey_templates').where({ slug: tpl.slug }).first();
    if (existing) {
      templateIdBySlug.set(tpl.slug, existing.id);
      continue;
    }
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

    for (const [i, phase] of tpl.phases.entries()) {
      const [phaseRow] = await knex('journey_template_phases')
        .insert({
          template_id: row.id,
          name: phase.name,
          description: phase.description ?? null,
          sort_order: i,
        })
        .returning('id');
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
  }

  // Handovers between pet journeys, wired once every template id is known.
  for (const tpl of PET_JOURNEY_TEMPLATES) {
    const from = templateIdBySlug.get(tpl.slug);
    if (!from) continue;
    for (const handover of tpl.handovers ?? []) {
      const to = templateIdBySlug.get(handover.to);
      if (!to) continue;
      const already = await knex('journey_template_handovers')
        .where({ from_template_id: from, to_template_id: to })
        .first();
      if (already) continue;
      await knex('journey_template_handovers').insert({
        from_template_id: from,
        to_template_id: to,
        label: handover.label,
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  const slugs = PET_JOURNEY_TEMPLATES.map((t) => t.slug);
  // Cascades remove the templates' phases, tasks and handovers.
  await knex('journey_templates').whereIn('slug', slugs).del();
}
