/**
 * Slash commands for the Ask Pare chat. Each command expands into a
 * plain-language instruction Pare already knows how to act on, so typing
 * "/dose took my morning meds at 8" is exactly the same as writing the
 * sentence out, just faster. "/help" lists them without spending tokens.
 */

export interface AssistantCommand {
  /** Typed with a leading slash, e.g. "dose" for /dose. */
  name: string;
  /** What the user types after the command. */
  hint: string;
  /** One-line description for /help and the command picker. */
  description: string;
  /** Turn the typed arguments into the message Pare receives. */
  expand: (args: string) => string;
}

export const ASSISTANT_COMMANDS: AssistantCommand[] = [
  {
    name: 'dose',
    hint: 'what was taken and when',
    description: 'Record medication doses, e.g. /dose took all my morning meds at 8',
    expand: (a) => `Record these medication doses, all in one action, without asking me to confirm each one: ${a}`,
  },
  {
    name: 'log',
    hint: 'what happened',
    description: 'Add a care log entry, e.g. /log mum had a fall in the bathroom around 3pm',
    expand: (a) => `Log this in the care log: ${a}`,
  },
  {
    name: 'handover',
    hint: 'what the next carer needs to know',
    description: 'Write a handover for the next shift, e.g. /handover refused her 8pm tablets, daughter rang at 7',
    expand: (a) => `Add this to the care log as a handover: ${a}`,
  },
  {
    name: 'task',
    hint: 'the task and when it is due',
    description: 'Add a task, e.g. /task book the neurologist Dr Chen, 03 9345 6677, by Friday',
    expand: (a) => `Add this task, linked to who it is with and their phone number when given: ${a}`,
  },
  {
    name: 'symptom',
    hint: 'symptom, condition and severity',
    description: 'Record or update a symptom, e.g. /symptom cough on the flu is worse today, about a 4',
    expand: (a) => `Record or update this symptom on the matching condition: ${a}`,
  },
  {
    name: 'done',
    hint: 'the task that is finished',
    description: 'Tick a task off, e.g. /done picked up the script',
    expand: (a) => `Mark this task complete: ${a}`,
  },
  {
    name: 'book',
    hint: 'what the appointment is for and when',
    description: 'Book an appointment, e.g. /book flu shot at the chemist on Saturday, any time',
    expand: (a) =>
      `Book this as a real appointment on the calendar, not a care log entry. Ask me only if the date or time is genuinely unclear: ${a}`,
  },
  {
    name: 'outcome',
    hint: 'how the appointment went and what came of it',
    description: 'Record how an appointment went, e.g. /outcome saw Dr Lee, referral to physio and a blood test',
    expand: (a) =>
      `Record how this appointment went and track every next step it set off, such as referrals, tests, samples or scripts to fill: ${a}`,
  },
  {
    name: 'forward',
    hint: 'which notes and where they go',
    description: "Forward an appointment's notes, e.g. /forward today's notes to the neurologist referral",
    expand: (a) =>
      `Forward notes from one appointment to another appointment, or to a next step that is not booked yet so they land when it is booked: ${a}`,
  },
  {
    name: 'cost',
    hint: 'the amount and what it was for',
    description: 'Record a care cost, e.g. /cost $42 at the chemist today',
    expand: (a) => `Record this on the health spend ledger as its own dated entry: ${a}`,
  },
  {
    name: 'reading',
    hint: 'the treatment and the measurements',
    description: 'Record a treatment reading, e.g. /reading blood pressure 128 over 82 this morning',
    expand: (a) =>
      `Record this as a treatment session with its measurements, against the matching treatment on the record: ${a}`,
  },
  {
    name: 'med',
    hint: 'medication details',
    description: 'Add a medication, e.g. /med perindopril 4mg tablet, one each morning at 8, prescribed by Dr Okafor',
    expand: (a) => `Add this medication to the list: ${a}`,
  },
  {
    name: 'stop',
    hint: 'a medicine to stop, and why',
    description: 'Stop a medicine, e.g. /stop the amoxicillin, the course finished yesterday',
    expand: (a) =>
      `Stop this medicine, with the last day it was taken and why it stopped when given, so the stop is kept in its history: ${a}`,
  },
  {
    name: 'change',
    hint: 'a medicine change, and why',
    description: 'Change a medicine, e.g. /change metoprolol down to 25mg after the hospital stay, blood pressure was low',
    expand: (a) =>
      `Change this medicine on the list and keep why it changed and where the change came from in its history: ${a}`,
  },
  {
    name: 'restock',
    hint: 'medication and how much was picked up',
    description: 'Record a repeat pickup, e.g. /restock 2 packs of perindopril',
    expand: (a) => `Record this medication restock: ${a}`,
  },
  {
    name: 'condition',
    hint: 'the condition and anything known about it',
    description: 'Add a condition, e.g. /condition flu since yesterday, moderate',
    expand: (a) => `Add this condition to the record: ${a}`,
  },
  {
    name: 'allergy',
    hint: 'the substance, reaction and how bad',
    description: 'Record an allergy, e.g. /allergy penicillin causes a rash, severe',
    expand: (a) => `Record this allergy, with how bad the reaction is when given: ${a}`,
  },
  {
    name: 'ids',
    hint: 'ID numbers from a card',
    description: 'Record ID numbers, e.g. /ids Medicare 2123 45670 1, number 1 on the card, valid to 08/2027',
    expand: (a) => `Record these ID numbers on their profile: ${a}`,
  },
  {
    name: 'substance',
    hint: 'the substance and how it is used',
    description: 'Record substance use, e.g. /substance smokes 15 cigarettes a day',
    expand: (a) => `Record this under substance use: ${a}`,
  },
  {
    name: 'neurotype',
    hint: 'a trait, need or support for a neurotype',
    description: 'Record a neurotype trait, need or support, e.g. /neurotype autism trait: sensory sensitivity to loud noise',
    expand: (a) =>
      `Record this against the named neurotype as a trait, need or support (add_neurotype_attribute), choosing the kind from the wording: ${a}`,
  },
  {
    name: 'file',
    hint: 'which document and where it goes',
    description: 'File a document under a category, e.g. /file the discharge letter under Hospital',
    expand: (a) => `File this document already in their documents: ${a}`,
  },
  {
    name: 'question',
    hint: 'the question for the care circle',
    description: 'Raise a question, e.g. /question should we look at respite care for August?',
    expand: (a) => `Raise this question for the care circle: ${a}`,
  },
  {
    name: 'provider',
    hint: 'name and what kind',
    description: 'Add a contact, e.g. /provider Dr Chen, GP at Fremantle Medical, or /provider Department of Justice',
    expand: (a) => `Add this contact, as a professional or as an organisation, whichever it is: ${a}`,
  },
  {
    name: 'circle',
    hint: 'who they are and how to reach them',
    description: 'Add someone to the care circle without an invite, e.g. /circle Joan next door, checks in most mornings, 0400 111 222',
    expand: (a) =>
      `Add this person to the care circle by name, with no invite and no login. If they are a doctor or other professional, add them as a contact instead: ${a}`,
  },
  {
    name: 'emergency',
    hint: 'who to call in an emergency',
    description: 'Choose who to call in an emergency, e.g. /emergency me, or /emergency Helen, daughter, 0417 555 101',
    expand: (a) => `Set this person as an emergency contact for them: ${a}`,
  },
  {
    name: 'practice',
    hint: 'who, and the practice they work at',
    description: 'File someone at their practice, e.g. /practice Dr Carly Examplename at Health Hub Morayfield',
    expand: (a) =>
      `File this person at their practice in the directory, sharing the practice's address, without linking them to anyone: ${a}`,
  },
  {
    name: 'link',
    hint: 'a contact or address already in the directory',
    description: 'Link an existing contact or address to this person, e.g. /link Dr Chen or /link 12 Ocean Road',
    expand: (a) =>
      `Link this existing entry from the directory to this profile, without creating a duplicate. It may be a provider (by name) or an address (by its label or street). If it is an address, also set it as where they live: ${a}`,
  },
];

export interface ExpandedCommand {
  kind: 'send' | 'help' | 'needs-args';
  /** For kind "send": the message to send in place of the raw input. */
  message?: string;
  /** For kind "needs-args": the command that was typed bare. */
  command?: AssistantCommand;
}

/**
 * Interpret a draft that starts with "/". Returns null when it is not a
 * command at all (send the text as typed).
 */
export function expandSlashCommand(draft: string): ExpandedCommand | null {
  const m = /^\/(\w+)\s*([\s\S]*)$/.exec(draft.trim());
  if (!m) return null;
  const [, name, args] = m;
  if (name.toLowerCase() === 'help') return { kind: 'help' };
  const cmd = ASSISTANT_COMMANDS.find((c) => c.name === name.toLowerCase());
  if (!cmd) return null;
  if (!args.trim()) return { kind: 'needs-args', command: cmd };
  return { kind: 'send', message: cmd.expand(args.trim()) };
}

/** The /help text, rendered locally without a round trip to the model. */
export function commandHelpText(): string {
  return [
    'Commands you can type here:',
    ...ASSISTANT_COMMANDS.map((c) => `/${c.name} ${c.hint} — ${c.description.split(', e.g.')[0]}`),
    '/help — show this list',
    'Anything else, just say in your own words.',
  ].join('\n');
}
