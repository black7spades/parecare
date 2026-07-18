import type { Knex } from 'knex';

/**
 * Traits, needs and supports for a neurotype. A neurotype (autism, ADHD, and
 * so on) is recorded as a medical_conditions row in the neurotype category;
 * on its own that says almost nothing about the actual person. These tables
 * let someone record what their neurodivergence really looks like for them:
 *
 *  - a trait is how it shows up (sensory sensitivity, a need for routine),
 *  - a need is what the person requires (advance notice of change),
 *  - a support is what helps in practice (noise-reducing headphones).
 *
 * Each is one structured record, chosen from a shared, research-informed
 * library so people are offered a common vocabulary, and freely extendable
 * with their own words. Kind, neurotype, label, domain and description are
 * each their own column: one fact, one column, everywhere.
 *
 * The library mirrors the condition, medication and substance catalogues: an
 * instance-wide list that anyone can search, growing whenever someone records
 * something new. The seed below is drawn from widely accepted clinical and
 * neurodiversity descriptions (DSM-5 domains, sensory processing, executive
 * function) and framed in plain, non-deficit language.
 */

interface Seed {
  kind: 'trait' | 'need' | 'support';
  neurotype: string | null;
  label: string;
  domain: string | null;
  description: string;
}

const SEED: Seed[] = [
  // Autism
  { kind: 'trait', neurotype: 'autism', label: 'Sensory sensitivity', domain: 'sensory', description: 'Strong reactions to sound, light, texture, taste or smell, which may be over- or under-sensitive.' },
  { kind: 'trait', neurotype: 'autism', label: 'Need for routine and predictability', domain: 'executive_function', description: 'Familiar routines feel safe, and unexpected change can be stressful.' },
  { kind: 'trait', neurotype: 'autism', label: 'Deep focused interests', domain: 'cognitive', description: 'Intense, detailed knowledge of and enthusiasm for particular topics.' },
  { kind: 'trait', neurotype: 'autism', label: 'Direct and literal communication', domain: 'social_communication', description: 'Prefers clear, precise language and may take figures of speech literally.' },
  { kind: 'trait', neurotype: 'autism', label: 'Reading unspoken social cues is hard', domain: 'social_communication', description: 'Body language, tone of voice and implied meaning can be difficult to interpret.' },
  { kind: 'trait', neurotype: 'autism', label: 'Stimming to self-regulate', domain: 'sensory', description: 'Repetitive movements or sounds that help manage emotion and sensory input.' },
  { kind: 'trait', neurotype: 'autism', label: 'Social interaction is tiring', domain: 'emotional', description: 'Socialising can drain energy and may need recovery time afterwards.' },
  { kind: 'trait', neurotype: 'autism', label: 'Strong sense of fairness and honesty', domain: 'emotional', description: 'Values consistency, clear rules and honesty.' },
  { kind: 'need', neurotype: 'autism', label: 'Advance notice of change', domain: 'executive_function', description: 'Being told about changes ahead of time reduces stress.' },
  { kind: 'need', neurotype: 'autism', label: 'Quiet, low-stimulation spaces', domain: 'sensory', description: 'Access to calm environments to avoid sensory overload.' },
  { kind: 'need', neurotype: 'autism', label: 'Time to process information', domain: 'cognitive', description: 'Extra time to take things in and respond.' },
  { kind: 'need', neurotype: 'autism', label: 'Clear, explicit expectations', domain: 'social_communication', description: 'Instructions and expectations spelled out rather than implied.' },
  { kind: 'support', neurotype: 'autism', label: 'Written instructions and visual schedules', domain: 'executive_function', description: 'Information in writing or pictures, not only spoken aloud.' },
  { kind: 'support', neurotype: 'autism', label: 'Noise-reducing headphones or ear defenders', domain: 'sensory', description: 'Cutting background noise to prevent overload.' },
  { kind: 'support', neurotype: 'autism', label: 'Sensory tools such as fidgets or weighted items', domain: 'sensory', description: 'Objects that help with regulation and focus.' },
  { kind: 'support', neurotype: 'autism', label: 'A warning before transitions', domain: 'executive_function', description: 'A heads-up before moving from one activity to the next.' },
  { kind: 'support', neurotype: 'autism', label: 'A designated calm space', domain: 'emotional', description: 'A quiet place to retreat to and settle.' },

  // ADHD
  { kind: 'trait', neurotype: 'adhd', label: 'Attention shifts with interest', domain: 'attention', description: 'Focus varies with interest and energy, and can lock deeply onto engaging tasks.' },
  { kind: 'trait', neurotype: 'adhd', label: 'Impulsivity', domain: 'executive_function', description: 'Acting or speaking quickly, before weighing the consequences.' },
  { kind: 'trait', neurotype: 'adhd', label: 'Physical restlessness', domain: 'motor', description: 'A need to move, fidget or change position often.' },
  { kind: 'trait', neurotype: 'adhd', label: 'Time blindness', domain: 'executive_function', description: 'Difficulty sensing time passing and estimating how long things take.' },
  { kind: 'trait', neurotype: 'adhd', label: 'Emotional intensity', domain: 'emotional', description: 'Feelings can be strong and fast-changing.' },
  { kind: 'trait', neurotype: 'adhd', label: 'Working memory is easily overloaded', domain: 'cognitive', description: 'Holding several steps or instructions in mind at once is hard.' },
  { kind: 'trait', neurotype: 'adhd', label: 'Fast, creative idea generation', domain: 'cognitive', description: 'Quick, divergent thinking and plenty of ideas.' },
  { kind: 'need', neurotype: 'adhd', label: 'External structure and reminders', domain: 'executive_function', description: 'Outside prompts to start, switch and finish tasks.' },
  { kind: 'need', neurotype: 'adhd', label: 'Regular movement breaks', domain: 'motor', description: 'Chances to move that make sitting and focusing easier.' },
  { kind: 'need', neurotype: 'adhd', label: 'Tasks broken into small steps', domain: 'executive_function', description: 'One manageable step at a time instead of a large whole.' },
  { kind: 'need', neurotype: 'adhd', label: 'Fewer distractions for focused work', domain: 'attention', description: 'A quieter, lower-interruption setting when concentration matters.' },
  { kind: 'support', neurotype: 'adhd', label: 'Timers and alarms', domain: 'executive_function', description: 'Making time visible and audible to stay on track.' },
  { kind: 'support', neurotype: 'adhd', label: 'Checklists, one step at a time', domain: 'executive_function', description: 'A written list to offload memory and track progress.' },
  { kind: 'support', neurotype: 'adhd', label: 'Working alongside someone', domain: 'executive_function', description: 'The presence of another person to help start and stay with a task.' },
  { kind: 'support', neurotype: 'adhd', label: 'Fidget tools', domain: 'motor', description: 'Something to move or handle that supports focus.' },

  // Dyslexia
  { kind: 'trait', neurotype: 'dyslexia', label: 'Decoding written words is hard', domain: 'language', description: 'Turning letters into sounds and words takes more effort.' },
  { kind: 'trait', neurotype: 'dyslexia', label: 'Slower reading pace', domain: 'language', description: 'Reading accurately can take longer.' },
  { kind: 'trait', neurotype: 'dyslexia', label: 'Spelling difficulty', domain: 'language', description: 'Spelling is inconsistent, even for familiar words.' },
  { kind: 'trait', neurotype: 'dyslexia', label: 'Strong verbal reasoning', domain: 'cognitive', description: 'Ideas and problem solving are often a real strength.' },
  { kind: 'need', neurotype: 'dyslexia', label: 'Information in more than one format', domain: 'language', description: 'Spoken or visual versions alongside written text.' },
  { kind: 'need', neurotype: 'dyslexia', label: 'Extra time for reading and writing', domain: 'language', description: 'Room to work without time pressure.' },
  { kind: 'support', neurotype: 'dyslexia', label: 'Text-to-speech and audio versions', domain: 'language', description: 'Having text read aloud.' },
  { kind: 'support', neurotype: 'dyslexia', label: 'Dyslexia-friendly fonts or coloured overlays', domain: 'language', description: 'Adjusting how text looks to make it easier to read.' },
  { kind: 'support', neurotype: 'dyslexia', label: 'Spell-check and dictation', domain: 'language', description: 'Tools that take the strain off spelling and writing.' },

  // Dyspraxia (developmental coordination difference)
  { kind: 'trait', neurotype: 'dyspraxia', label: 'Coordination and fine motor tasks are hard', domain: 'motor', description: 'Handwriting, doing up buttons and similar tasks take more effort.' },
  { kind: 'trait', neurotype: 'dyspraxia', label: 'Balance and spatial awareness difficulty', domain: 'motor', description: 'Judging space and staying steady can be tricky.' },
  { kind: 'trait', neurotype: 'dyspraxia', label: 'Planning and sequencing movement is hard', domain: 'motor', description: 'Organising the steps of a physical task takes thought.' },
  { kind: 'need', neurotype: 'dyspraxia', label: 'Extra time for physical tasks', domain: 'motor', description: 'No rush for tasks that need coordination.' },
  { kind: 'need', neurotype: 'dyspraxia', label: 'Uncluttered, predictable spaces', domain: 'motor', description: 'Tidy, familiar layouts to move through safely.' },
  { kind: 'support', neurotype: 'dyspraxia', label: 'Assistive tools for writing and daily tasks', domain: 'motor', description: 'Grips, adapted utensils and similar aids.' },
  { kind: 'support', neurotype: 'dyspraxia', label: 'Step-by-step demonstrations', domain: 'motor', description: 'Showing a task one part at a time.' },

  // Dyscalculia
  { kind: 'trait', neurotype: 'dyscalculia', label: 'Numbers and quantities are hard to grasp', domain: 'cognitive', description: 'Understanding amounts and doing calculations takes more effort.' },
  { kind: 'trait', neurotype: 'dyscalculia', label: 'Time, money and measurement difficulty', domain: 'cognitive', description: 'Everyday number tasks like change or telling time can be hard.' },
  { kind: 'need', neurotype: 'dyscalculia', label: 'Concrete, visual ways to work with numbers', domain: 'cognitive', description: 'Seeing and handling numbers rather than working in the abstract.' },
  { kind: 'support', neurotype: 'dyscalculia', label: 'Calculators and number aids', domain: 'cognitive', description: 'Tools that take the load off mental arithmetic.' },
  { kind: 'support', neurotype: 'dyscalculia', label: 'Visual number lines and objects to count', domain: 'cognitive', description: 'Physical or drawn aids for working with numbers.' },

  // Tourette syndrome
  { kind: 'trait', neurotype: 'tourette', label: 'Motor tics', domain: 'motor', description: 'Sudden, repeated movements that are hard to hold back.' },
  { kind: 'trait', neurotype: 'tourette', label: 'Vocal tics', domain: 'motor', description: 'Sudden, repeated sounds or words.' },
  { kind: 'trait', neurotype: 'tourette', label: 'Tics change with stress or excitement', domain: 'emotional', description: 'Tics often increase when tired, stressed or excited.' },
  { kind: 'need', neurotype: 'tourette', label: 'No pressure to suppress tics', domain: 'emotional', description: 'Acceptance, since holding tics in is tiring and stressful.' },
  { kind: 'need', neurotype: 'tourette', label: 'Low-stress environments', domain: 'emotional', description: 'Calm settings where tics are less likely to spike.' },
  { kind: 'support', neurotype: 'tourette', label: 'Understanding from people around them', domain: 'social_communication', description: 'Those nearby knowing what tics are and taking them in stride.' },
  { kind: 'support', neurotype: 'tourette', label: 'Space to release tics comfortably', domain: 'motor', description: 'Somewhere it is fine to tic without judgement.' },

  // Intellectual disability
  { kind: 'trait', neurotype: 'intellectual_disability', label: 'Learns at a steadier pace', domain: 'cognitive', description: 'Takes more time and repetition to learn new things.' },
  { kind: 'trait', neurotype: 'intellectual_disability', label: 'Abstract concepts are hard', domain: 'cognitive', description: 'Concrete, familiar ideas are easier than abstract ones.' },
  { kind: 'need', neurotype: 'intellectual_disability', label: 'Simple, concrete language', domain: 'cognitive', description: 'Plain words and clear, specific instructions.' },
  { kind: 'need', neurotype: 'intellectual_disability', label: 'Time and repetition to learn', domain: 'cognitive', description: 'Space to practise and go over things again.' },
  { kind: 'need', neurotype: 'intellectual_disability', label: 'Support with daily living skills', domain: 'self_care', description: 'A hand with everyday tasks as needed.' },
  { kind: 'support', neurotype: 'intellectual_disability', label: 'Easy-read materials and pictures', domain: 'cognitive', description: 'Short text with images to explain things.' },
  { kind: 'support', neurotype: 'intellectual_disability', label: 'Consistent routines and modelling', domain: 'executive_function', description: 'Predictable steps and showing how, not only telling.' },

  // Sensory processing difference
  { kind: 'trait', neurotype: 'sensory_processing', label: 'Over-sensitivity to sensory input', domain: 'sensory', description: 'Everyday sights, sounds or textures can feel overwhelming.' },
  { kind: 'trait', neurotype: 'sensory_processing', label: 'Under-sensitivity to sensory input', domain: 'sensory', description: 'Needs stronger input to register sensations.' },
  { kind: 'trait', neurotype: 'sensory_processing', label: 'Sensory seeking', domain: 'sensory', description: 'Actively seeks movement, pressure or other sensory input.' },
  { kind: 'need', neurotype: 'sensory_processing', label: 'Control over the sensory environment', domain: 'sensory', description: 'Being able to adjust noise, light and other input.' },
  { kind: 'need', neurotype: 'sensory_processing', label: 'Regular sensory breaks', domain: 'sensory', description: 'Time to reset between demands on the senses.' },
  { kind: 'support', neurotype: 'sensory_processing', label: 'A sensory kit of tools', domain: 'sensory', description: 'Items that calm or provide input as needed.' },
  { kind: 'support', neurotype: 'sensory_processing', label: 'Adjustable lighting and sound', domain: 'sensory', description: 'Dimmable light and quieter settings.' },

  // Cross-cutting (applies to many neurotypes)
  { kind: 'trait', neurotype: null, label: 'Masking', domain: 'emotional', description: 'Hiding natural traits to fit in, which is exhausting to keep up.' },
  { kind: 'need', neurotype: null, label: 'To be understood and accepted', domain: 'emotional', description: 'Being met as they are, without pressure to appear otherwise.' },
  { kind: 'support', neurotype: null, label: 'A one-page profile or communication passport', domain: 'social_communication', description: 'A short profile describing how someone communicates and what helps them.' },
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('neurotype_attribute_catalogue', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // trait | need | support
    t.string('kind', 20).notNullable();
    // The neurotype it is most associated with, or null when cross-cutting.
    t.string('neurotype', 50).nullable();
    t.string('label', 255).notNullable();
    // Area of life the item touches: sensory, social_communication,
    // executive_function, motor, cognitive, emotional, language, self_care,
    // attention, other. Null when it does not fit one.
    t.string('domain', 40).nullable();
    t.text('description').nullable();
    t.uuid('created_by_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['kind', 'neurotype']);
  });

  await knex.schema.createTable('neurotype_attributes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // The neurotype condition this belongs to (a medical_conditions row).
    t.uuid('condition_id').notNullable().references('id').inTable('medical_conditions').onDelete('CASCADE');
    t.uuid('catalogue_id').notNullable().references('id').inTable('neurotype_attribute_catalogue').onDelete('RESTRICT');
    // Person-specific detail: how this trait shows up for them, or what the
    // support looks like in practice for this person.
    t.text('notes').nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['condition_id', 'catalogue_id']);
    t.index('condition_id');
  });

  await knex('neurotype_attribute_catalogue').insert(SEED);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('neurotype_attributes');
  await knex.schema.dropTable('neurotype_attribute_catalogue');
}
