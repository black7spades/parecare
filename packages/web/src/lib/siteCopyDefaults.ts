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
  'directory.organisations.subheader': 'Clinics, health hubs, hospitals, pharmacies, government departments and every other organisation involved. Edit one here and it updates everywhere, including for everyone based there.',
  'directory.professionals.subheader': 'Doctors, specialists, lawyers, caseworkers and everyone else you deal with, and where each is based. Edit one here and it updates everywhere.',
  'directory.suppliers.subheader': 'The pharmacies and shops your medications are reordered from. Edit details here and they update on every medication that names them.',
  'directory.addresses.subheader': 'Every address in the system. Edit one here and it updates for everyone it is linked to.',
  'directory.assets.subheader': 'The equipment kept for the people and pets in your care: a wheelchair, a hoist, a bed, a monitor. Link each to whoever it belongs to.',
  'directory.profiles.people.subheader': 'All people across your care profiles.',
  'directory.profiles.pets.subheader': 'All pets across your care profiles.',
  'reports.generator.subheader': 'Build custom reports from any data in the system',

  // Notification settings
  'account.notifications.subheader': 'What you are told about, and where. The bell in the header always shows everything you have switched on; channels deliver it beyond the app.',

  // Connected apps
  'account.connected.subheader': 'Use PareCare from the assistant you already chat with. Connect it once, then ask it to file things in PareCare.',

  // Profile-level pages. {name} is the person's own name; each ".self"
  // version is what a person reads on their own profile.
  'profile.circle.subheader': "Everyone around {name}: family, friends, neighbours and the professionals involved in their care.",
  'profile.circle.subheader.self': 'Everyone around you: family, friends, neighbours and the professionals involved in your care.',
  'profile.medications.subheader': "The medicines {name} takes, with when and how much. Add, change and stop them here; record and look back at doses in the record below.",
  'profile.medications.subheader.self': 'The medicines you take, with when and how much. Add, change and stop them here; record and look back at doses in the record below.',
  'profile.mar.subheader': 'Record each dose {name} has and look back at the history. Doses change colour as soon as they are recorded.',
  'profile.mar.subheader.self': 'Record each dose you have and look back at the history. Doses change colour as soon as they are recorded.',
  'profile.appointments.subheader': "Every visit booked for {name}. Each one shows on the Calendar and in what's coming up on the Overview.",
  'profile.appointments.subheader.self': "Every visit booked for you. Each one shows on the Calendar and in what's coming up on the Overview.",
  'profile.conditions.subheader': 'Everything {name} lives with: illnesses, injuries, recovery, disabilities and long-term conditions, each with its kind, how serious it is, its diagnosis codes, treatments and symptoms.',
  'profile.conditions.subheader.self': 'Everything you live with: illnesses, injuries, recovery, disabilities and long-term conditions, each with its kind, how serious it is, its diagnosis codes, treatments and symptoms.',
  'profile.allergies.subheader': 'What {name} must not be given, and what happens if they are. One row per substance.',
  'profile.allergies.subheader.self': 'What you must not be given, and what happens if you are. One row per substance.',
  'profile.providers.subheader': 'The professionals and organisations involved with {name}, with contact details in one place.',
  'profile.providers.subheader.self': 'The professionals and organisations involved with you, with contact details in one place.',
  'profile.care-needs.subheader': "Day-to-day needs, the advance care directive, and who to call for {name}. Changes save straight away and flow into the care plan.",
  'profile.care-needs.subheader.self': 'Your day-to-day needs, your advance care directive, and who to call for you. Changes save straight away and flow into your care plan.',
  'profile.plan.subheader': "The assembled, versioned plan for {name}. Nothing is recorded here: facts are entered on their own pages and each change flows in as a tracked update.",
  'profile.plan.subheader.self': 'Your assembled, versioned plan. Nothing is recorded here: facts are entered on their own pages and each change flows in as a tracked update.',
  'profile.messages.subheader': "A shared space for everyone in {possessive} circle.",
  'profile.messages.subheader.self': 'A shared space for everyone in your circle.',
  'profile.activity.subheader': "Every change made to {possessive} records: who did what, and when. Nobody can edit or remove this list.",
  'profile.activity.subheader.self': 'Every change made to your records: who did what, and when. Nobody can edit or remove this list.',
  'profile.questions.subheader': 'Write down what to ask a doctor or the family about {name}, and it shows at the next visit. For example: "Is the new tablet why they are so tired?"',
  'profile.questions.subheader.self': 'Write down what you want to ask a doctor, and it shows at your next visit. For example: "Is the new tablet why I am so tired?"',
  'profile.neurotype.subheader': 'Neurodivergent profiles such as autism, ADHD, dyslexia and others. These are lifelong from birth.',
  'profile.substance-use.subheader': 'Substances {name} takes, legal or illegal, and how each is used. One row per substance.',
  'profile.substance-use.subheader.self': 'Substances you take, legal or illegal, and how each is used. One row per substance.',
  'profile.emergency.subheader': 'A one-page summary for paramedics, hospital staff, or anyone stepping in. Keep a printed copy on the fridge.',
  'profile.memory-book.achievements.subheader': 'Every completed checklist item, across every journey. Select one to see its whole story.',

  // What's new
  'whats-new.subheader': 'Everything that has changed across your care profiles, most recent first. Changes you made yourself are included.',
};
