import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const [template] = await knex('journey_templates')
    .insert({
      slug: 'neurotype-diagnosis',
      name: 'Neurotype diagnosis',
      description:
        'The journey to a formal neurotype diagnosis, from first concerns through referral, assessment, and post-diagnosis support.',
      kind: 'condition',
      is_system: true,
      status: 'published',
    })
    .returning('id');

  const phases = [
    {
      name: 'First concerns',
      description: 'Noticing differences and gathering observations from home, school, or work.',
      sort_order: 0,
    },
    {
      name: 'Research and self-education',
      description: 'Learning about the neurotype, talking to others with lived experience, and deciding whether to pursue formal assessment.',
      sort_order: 1,
    },
    {
      name: 'Referral',
      description: 'Getting a referral from a GP or paediatrician to a specialist assessor.',
      sort_order: 2,
    },
    {
      name: 'Waiting for assessment',
      description: 'On the waitlist for a formal assessment. Gathering supporting evidence such as school reports, developmental history, and questionnaires.',
      sort_order: 3,
    },
    {
      name: 'Assessment',
      description: 'Attending the formal assessment sessions with the diagnosing clinician.',
      sort_order: 4,
    },
    {
      name: 'Diagnosis received',
      description: 'Receiving and understanding the formal diagnosis report.',
      sort_order: 5,
    },
    {
      name: 'Post-diagnosis support',
      description: 'Accessing support services, accommodations, therapies, and connecting with the neurodivergent community.',
      sort_order: 6,
    },
  ];

  const phaseRows = phases.map((p) => ({ ...p, template_id: template.id }));
  const insertedPhases = await knex('journey_template_phases').insert(phaseRows).returning(['id', 'sort_order']);

  const tasksByPhase: Record<number, Array<{ title: string; description?: string; is_milestone?: boolean }>> = {
    0: [
      { title: 'Document specific observations and examples' },
      { title: 'Talk to teachers, carers, or colleagues about what they have noticed' },
    ],
    2: [
      { title: 'Book GP or paediatrician appointment', is_milestone: true },
      { title: 'Get referral letter' },
    ],
    3: [
      { title: 'Gather developmental history' },
      { title: 'Collect school reports or workplace assessments' },
      { title: 'Complete pre-assessment questionnaires' },
    ],
    4: [
      { title: 'Attend assessment sessions' },
    ],
    5: [
      { title: 'Receive written diagnosis report', is_milestone: true },
      { title: 'Upload diagnosis document to PareCare' },
    ],
    6: [
      { title: 'Research available support services' },
      { title: 'Apply for any funding or accommodations' },
      { title: 'Connect with support groups or community' },
    ],
  };

  const tasks: Array<{ template_phase_id: string; title: string; description?: string; is_milestone: boolean; sort_order: number }> = [];
  for (const phase of insertedPhases) {
    const phaseTasks = tasksByPhase[phase.sort_order] ?? [];
    phaseTasks.forEach((t, i) => {
      tasks.push({
        template_phase_id: phase.id,
        title: t.title,
        description: t.description,
        is_milestone: t.is_milestone ?? false,
        sort_order: i,
      });
    });
  }
  if (tasks.length > 0) await knex('journey_template_tasks').insert(tasks);
}

export async function down(knex: Knex): Promise<void> {
  const template = await knex('journey_templates').where({ slug: 'neurotype-diagnosis' }).first();
  if (template) {
    const phases = await knex('journey_template_phases').where({ template_id: template.id }).select('id');
    if (phases.length > 0) {
      await knex('journey_template_tasks').whereIn('template_phase_id', phases.map((p) => p.id)).delete();
    }
    await knex('journey_template_phases').where({ template_id: template.id }).delete();
    await knex('journey_templates').where({ id: template.id }).delete();
  }
}
