export const SITE_COPY_DEFAULTS: Record<string, string> = {
  // System/admin pages
  'system.subheader': 'Administer accounts and server configuration.',
  'system.users.subheader': 'Create accounts, invite carers to the people they look after, and manage roles and tiers.',
  'system.users.invitations.subheader': 'Every invitation sent from anywhere in the system, with its link while it is pending.',
  'system.users.templates.subheader': 'Named bundles of account rights. Select people in the table above and apply a template to set them all at once.',
  'system.settings.subheader': 'Change how PareCare runs without editing files or restarting. Changes apply straight away. Blank a field to fall back to its built-in default or the value set in the server environment. Secrets are stored encrypted and never shown again.',
  'system.database.subheader': 'Tidy the data behind the app: fix a misspelt name in a shared catalogue or correct a care record. Only the lists and records already managed in the main navigation are shown here.',
  'system.journeys.stages.subheader': 'The stages that organise the journey library and drive suggestions. They never restrict which journeys a person can be on.',
  'system.journeys.library.subheader': "The journeys people can be enrolled in. Build new ones from scratch, clone and adapt, or cherry-pick phases from across the library. People's journeys are copies; library edits change no one's record.",

  // Directory pages
  'directory.providers.subheader': 'All providers across your care profiles. Edit details here and they update everywhere.',
  'directory.suppliers.subheader': 'The pharmacies and shops your medications are reordered from. Edit details here and they update on every medication that names them.',
  'directory.addresses.subheader': 'Every address in the system. Edit one here and it updates for everyone it is linked to.',
  'directory.assets.subheader': 'The equipment kept for the people and pets in your care: a wheelchair, a hoist, a bed, a monitor. Link each to whoever it belongs to.',
  'directory.profiles.people.subheader': 'All people across your care profiles.',
  'directory.profiles.pets.subheader': 'All pets across your care profiles.',
  'reports.generator.subheader': 'Build custom reports from any data in the system',

  // Notification settings
  'account.notifications.subheader': 'What you are told about, and where. The bell in the header always shows everything you have switched on; channels deliver it beyond the app.',

  // Profile-level pages (use {name} placeholder)
  'profile.circle.subheader': "The family members, friends and organisations involved in {name}'s care.",
  'profile.medications.subheader': "{name}'s current regimen. Add, edit and organise medications here; log and review doses in the record below.",
  'profile.mar.subheader': 'Log each dose against {name} and review the history. Doses colour instantly as you record them.',
  'profile.appointments.subheader': 'Everything booked for {name}. Each appointment shows on the Calendar and in the upcoming events on the Overview.',
  'profile.conditions.subheader': 'Everything {name} lives with: illnesses, injuries, recovery, disabilities, and long-term conditions, each with their category, severity, diagnosis codes, treatments, and symptoms.',
  'profile.allergies.subheader': 'What {name} must not be given, and what happens if they are. One row per substance.',
  'profile.providers.subheader': 'Doctors, facilities and services involved in care, with contact details in one place.',
  'profile.care-needs.subheader': "Day-to-day needs, the advance care directive, and who to call for {name}. Changes save straight away and flow into the care plan.",
  'profile.plan.subheader': "The assembled, versioned plan for {name}. Nothing is recorded here: facts are entered on their own pages and each change flows in as a tracked update.",
  'profile.messages.subheader': "A shared space for everyone in {name}'s circle.",
  'profile.activity.subheader': "Every change made to {name}'s records: who did what, and when. Nobody can edit or remove this list.",
  'profile.questions.subheader': 'Open questions the family needs to settle: "Should mum still be driving?", "Who takes February visits?"',
  'profile.neurotype.subheader': 'Neurodivergent profiles such as autism, ADHD, dyslexia and others. These are lifelong from birth.',
  'profile.substance-use.subheader': 'Substances {name} takes, legal or illegal, and how each is used. One row per substance.',
  'profile.emergency.subheader': 'A one-page summary for paramedics, hospital staff, or anyone stepping in. Keep a printed copy on the fridge.',
  'profile.memory-book.achievements.subheader': 'Every completed checklist item, across every journey. Select one to see its whole story.',

  // What's new
  'whats-new.subheader': 'Everything that has changed across your care profiles, most recent first. Changes you made yourself are included.',
};
