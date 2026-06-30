import type { Knex } from 'knex';

// These are stored as a special care_profile_id = NULL template record
// When a new profile is created, these get copied for the profile's current phase.
// We store them in a separate table so they don't pollute care_profiles data.
// For simplicity in this seed, we just document the templates — the API
// copies them when creating a new care profile.

export const PHASE_CHECKLISTS: Record<string, Array<{ title: string; description: string }>> = {
  early_concern: [
    {
      title: 'Book a GP appointment',
      description: "Start with a general health review. Mention any specific concerns you've observed.",
    },
    {
      title: 'Have a family conversation about next steps',
      description: 'Agree on who will take the lead in coordinating care.',
    },
    {
      title: "Note any changes you've observed",
      description: 'Write down changes in memory, mobility, mood, or daily habits. Dates matter.',
    },
    {
      title: 'Check if they have a current Will',
      description: 'This is easiest to sort before a crisis.',
    },
    {
      title: 'Check if Power of Attorney is in place',
      description:
        'If not, this should be arranged while the person has legal capacity to grant it.',
    },
  ],
  home_with_support: [
    {
      title: 'Contact My Aged Care for an assessment',
      description:
        'In Australia, call 1800 200 422 or visit myagedcare.gov.au to start the ACAT/ACAS process.',
    },
    {
      title: 'Arrange a home safety assessment',
      description:
        'An occupational therapist can recommend modifications to reduce fall risk.',
    },
    {
      title: 'Set up medication management',
      description:
        'Consider a Webster-pak or similar blister-pack dispensing service through your pharmacy.',
    },
    {
      title: 'Create a care roster',
      description: 'Agree on who visits when, and log it in PareCare so everyone can see coverage.',
    },
    {
      title: 'Register with the National Disability Insurance Scheme if eligible',
      description: 'For those under 65 with a permanent disability.',
    },
    {
      title: 'Arrange transport for appointments',
      description: 'Identify who drives, or register for community transport services.',
    },
  ],
  increased_dependency: [
    {
      title: 'Research residential care options',
      description: 'Start early — quality facilities often have waiting lists.',
    },
    {
      title: 'Request a financial assessment (ACFI)',
      description: 'This determines the level of government subsidy available for residential care.',
    },
    {
      title: 'Confirm Power of Attorney is activated if needed',
      description: 'Check the conditions under which POA takes effect.',
    },
    {
      title: 'Complete or update Advance Care Directive',
      description:
        "Documents the person's wishes for medical treatment if they can no longer communicate them.",
    },
    {
      title: 'Hold a family meeting to discuss options',
      description:
        "Log the outcomes in PareCare's Open Questions board if decisions are unresolved.",
    },
    {
      title: 'Review financial position',
      description: 'Understand assets, income, and how residential care fees are calculated.',
    },
  ],
  transition_to_residential: [
    {
      title: 'Choose and apply to a residential care facility',
      description:
        'Submit a formal application. Confirm the facility is accredited by the Aged Care Quality and Safety Commission.',
    },
    {
      title: 'Understand the Refundable Accommodation Deposit (RAD)',
      description:
        'The RAD is the lump sum payment option for a room. Ask the facility for a written quote.',
    },
    {
      title: 'Arrange removal of personal belongings',
      description:
        'Co-ordinate what goes to the facility, what stays with family, and what is donated or sold.',
    },
    {
      title: 'Transfer GP care to facility or nearby practice',
      description: "Confirm the facility's visiting GP arrangements.",
    },
    {
      title: 'Introduce yourself to key facility staff',
      description: 'Log their names and roles in the Providers section.',
    },
    {
      title: 'Set up a visiting roster',
      description: 'Regular familiar faces improve settling-in significantly.',
    },
    {
      title: 'Notify relevant organisations of address change',
      description: 'Medicare, Centrelink, bank, electoral roll, subscriptions.',
    },
  ],
  residential_ongoing: [
    {
      title: 'Attend the annual care plan review',
      description: 'You have the right to be present. Bring any concerns in writing.',
    },
    {
      title: 'Know how to raise a complaint',
      description:
        'Facilities have an internal complaints process. The Aged Care Quality and Safety Commission handles unresolved complaints.',
    },
    {
      title: 'Review the care plan in PareCare after each visit',
      description: 'Log anything that has changed or needs following up.',
    },
    {
      title: 'Check financial statements quarterly',
      description: 'Confirm fees are correct and the RAD is being managed as agreed.',
    },
    {
      title: 'Maintain connections outside the facility',
      description: 'Outings, video calls, and visitors all support wellbeing.',
    },
  ],
  end_of_life: [
    {
      title: 'Confirm palliative care arrangements',
      description:
        'Talk to the facility and GP about what palliative care looks like in this context.',
    },
    {
      title: 'Review Advance Care Directive',
      description:
        "Ensure the document reflects current wishes and is on file at the facility.",
    },
    {
      title: 'Locate the Will and confirm executor',
      description: "Make sure the executor knows where the Will is held.",
    },
    {
      title: 'Funeral pre-planning',
      description:
        'Some people have pre-paid funeral plans. Confirm arrangements and document them here.',
    },
    {
      title: 'Notify close family and friends of the situation',
      description: 'Agree on who communicates updates and how.',
    },
    {
      title: 'Consider a Memory Book',
      description:
        "PareCare's Memory Book feature lets family members write messages, share photos, and record stories while there is still time.",
    },
  ],
};

export async function seed(_knex: Knex): Promise<void> {
  // Templates are applied by the API when creating care profiles.
  // Nothing to seed into the DB directly — the PHASE_CHECKLISTS export
  // is imported by the care profiles service.
  console.log('Checklist templates loaded (applied per-profile at creation time).');
}
