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
    name: 'task',
    hint: 'the task and when it is due',
    description: 'Add a task, e.g. /task book podiatrist for next Tuesday',
    expand: (a) => `Add this task: ${a}`,
  },
  {
    name: 'symptom',
    hint: 'symptom, condition and severity',
    description: 'Record or update a symptom, e.g. /symptom cough on the flu is worse today, about a 4',
    expand: (a) => `Record or update this symptom on the matching condition: ${a}`,
  },
  {
    name: 'med',
    hint: 'medication details',
    description: 'Add a medication, e.g. /med perindopril 4mg tablet, one each morning at 8',
    expand: (a) => `Add this medication to the list: ${a}`,
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
    hint: 'the substance and reaction',
    description: 'Record an allergy, e.g. /allergy penicillin causes a rash',
    expand: (a) => `Record this allergy: ${a}`,
  },
  {
    name: 'question',
    hint: 'the question for the care circle',
    description: 'Raise a question, e.g. /question should we look at respite care for August?',
    expand: (a) => `Raise this question for the care circle: ${a}`,
  },
  {
    name: 'provider',
    hint: 'name and what kind of provider',
    description: 'Add a provider, e.g. /provider Dr Chen, GP at Fremantle Medical',
    expand: (a) => `Add this provider: ${a}`,
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
