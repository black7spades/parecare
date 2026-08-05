/**
 * The verbs the command bar can carry out, named in plain language. Choosing
 * one lands on the screen for that action, on the person it needs. This is the
 * command bar's "Do" tier: instant, no model, no round trip, unlike the slash
 * macros in assistantCommands.ts, which stay for typing inside Pare's composer.
 *
 * Keywords are extra words a person might type; they are matched but never
 * shown, so "vitals" or "bp" still finds "Record a treatment reading".
 */
export interface Command {
  id: string;
  label: string;
  keywords: string;
  /** Whether the action is about one person, so it only shows with one open. */
  needsProfile: boolean;
  /** Where it lands. profileId is '' for the account-wide commands. */
  route: (profileId: string) => string;
}

export const COMMANDS: Command[] = [
  { id: 'record-dose', label: 'Record a dose', keywords: 'medication mar administer took given log dose tablet', needsProfile: true, route: (p) => `/app/${p}/mar` },
  { id: 'add-medication', label: 'Add a medication', keywords: 'drug pill prescription new medicine', needsProfile: true, route: (p) => `/app/${p}/medications` },
  { id: 'add-log', label: 'Add a care log note', keywords: 'note observation happened diary entry', needsProfile: true, route: (p) => `/app/${p}/logs` },
  { id: 'add-task', label: 'Add a task', keywords: 'todo reminder due job chore', needsProfile: true, route: (p) => `/app/${p}/tasks` },
  { id: 'book-appointment', label: 'Book an appointment', keywords: 'visit gp specialist calendar schedule booking', needsProfile: true, route: (p) => `/app/${p}/appointments?new=1` },
  { id: 'record-reading', label: 'Record a treatment reading', keywords: 'measurement blood pressure bp weight glucose vitals sats reading', needsProfile: true, route: (p) => `/app/${p}/treatments` },
  { id: 'add-condition', label: 'Add a condition', keywords: 'diagnosis illness injury health', needsProfile: true, route: (p) => `/app/${p}/conditions` },
  { id: 'add-allergy', label: 'Add an allergy', keywords: 'reaction intolerance', needsProfile: true, route: (p) => `/app/${p}/allergies` },
  { id: 'add-provider', label: 'Add a provider', keywords: 'gp doctor pharmacy specialist contact clinic', needsProfile: true, route: (p) => `/app/${p}/providers` },
  { id: 'add-document', label: 'Add a document', keywords: 'upload file scan letter photo receipt', needsProfile: true, route: (p) => `/app/${p}/documents` },
  { id: 'raise-question', label: 'Raise a question', keywords: 'decision ask circle disagreement', needsProfile: true, route: (p) => `/app/${p}/questions` },
  { id: 'add-profile', label: 'Add a care profile', keywords: 'new person pet someone create', needsProfile: false, route: () => '/app/profiles/new' },
  { id: 'create-report', label: 'Create a report', keywords: 'export handover pdf ndis auditor summary', needsProfile: false, route: () => '/app/reports' },
];
