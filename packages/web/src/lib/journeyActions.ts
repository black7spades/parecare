import type { ContactSummary } from './care';
import type { RepeatChoice } from './repeat';

/**
 * What a journey step does when tapped, the same list as the API's
 * lib/journeyActions.ts. Every step that asks someone to do something has
 * one, so no step is a dead end.
 */
export const JOURNEY_ACTIONS = [
  { value: 'book', label: 'Book an appointment' },
  { value: 'task', label: 'Add a task' },
  { value: 'upload', label: 'Upload a document' },
  { value: 'call', label: 'Call a number' },
  { value: 'equipment', label: 'Add equipment' },
  { value: 'hospital_stay', label: 'Record a hospital stay' },
  { value: 'care_move', label: 'Record a move into care' },
  { value: 'funding', label: 'Add a funding plan' },
  { value: 'result', label: 'Add a test result' },
  { value: 'open', label: 'Open a page' },
] as const;
export type JourneyAction = (typeof JOURNEY_ACTIONS)[number]['value'];

/** The pages an "open" step goes to, with what the button says. */
export const JOURNEY_PAGES = [
  { value: 'medications', label: 'Medications', button: 'Open Medications', path: 'medications' },
  { value: 'providers', label: 'Contacts', button: 'Open Contacts', path: 'providers' },
  { value: 'circle', label: 'Care circle', button: 'Open the care circle', path: 'circle' },
  { value: 'plan', label: 'Care plan', button: 'Open the care plan', path: 'plan' },
  { value: 'emergency', label: 'Emergency sheet', button: 'Open the emergency sheet', path: 'emergency' },
  { value: 'documents', label: 'Documents', button: 'Open Documents', path: 'documents' },
  { value: 'conditions', label: 'Conditions', button: 'Open Conditions', path: 'conditions' },
  { value: 'care-needs', label: 'Care needs', button: 'Open Care needs', path: 'care-needs' },
  { value: 'questions', label: 'Questions', button: 'Open Questions', path: 'questions' },
  { value: 'care-log', label: 'Care log', button: 'Open the care log', path: '' },
  { value: 'memory-book', label: 'Memory book', button: 'Open the Memory book', path: 'memory-book' },
  { value: 'tasks', label: 'Tasks', button: 'Open Tasks', path: 'tasks' },
  { value: 'appointments', label: 'Appointments', button: 'Open Appointments', path: 'appointments' },
  { value: 'messages', label: 'Messages', button: 'Open Messages', path: 'messages' },
  { value: 'substance-use', label: 'Substance use', button: 'Open Substance use', path: 'substance-use' },
  { value: 'reports', label: 'Reports', button: 'Make a report', path: null },
] as const;
export type JourneyPage = (typeof JOURNEY_PAGES)[number]['value'];

/** Where an "open" step goes. */
export function journeyPageHref(profileId: string, page: string | null): string | null {
  const hit = JOURNEY_PAGES.find((p) => p.value === page);
  if (!hit) return null;
  if (hit.path === null) return '/app/reports';
  return hit.path ? `/app/${profileId}/${hit.path}` : `/app/${profileId}`;
}

/** What the button on a record step says, and the page whose form it opens. */
export const RECORD_ACTIONS: Record<string, { button: string; page: string; params: Record<string, string> }> = {
  equipment: { button: 'Add to equipment', page: 'equipment', params: { new: '1' } },
  hospital_stay: { button: 'Record a hospital stay', page: 'where-they-live', params: { stay: 'new' } },
  care_move: { button: 'Record the move', page: 'where-they-live', params: { move: 'new' } },
  funding: { button: 'Add the plan', page: 'funding', params: { new: '1' } },
  result: { button: 'Add a result', page: 'test-results', params: { new: '1' } },
};

export interface JourneyItemTask {
  id: string;
  title: string;
  next_due_at: string;
  all_day: boolean;
  completed: boolean;
  repeat: RepeatChoice;
  assigned_to: string | null;
  assigned_account_id: string | null;
  assigned_name: string | null;
}

/** The fields a journey step carries about what it does. */
export interface JourneyItemAction {
  action: JourneyAction | null;
  action_provider_type: string | null;
  action_contact_name: string | null;
  action_phone: string | null;
  action_document_category: string | null;
  action_page: JourneyPage | null;
  due_in_days: number | null;
  repeat_rrule: string | null;
  /** Worked out from repeat_rrule. */
  repeat?: RepeatChoice;
  default_due_on?: string;
  task?: JourneyItemTask | null;
  appointment?: { id: string; title: string; starts_at: string | null; all_day: boolean; status: string } | null;
  documents?: Array<{ id: string; label: string }>;
  linked_record?: { kind: string; id: string; label: string; kind_label: string; path: string } | null;
  /** The main contact of the kind the step books or calls. */
  action_contact?: ContactSummary | null;
}

/** What a booking from a step is called: "Book a preconception health check" books a "Preconception health check". */
export function bookingTitleFromStep(title: string): string {
  const bare = title
    .replace(/^\s*(make an appointment (for|with)|book an|book a|book the|book your own|book your|book|see a|see the|see your|see)\s+/i, '')
    .trim();
  if (!bare) return title;
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/** The kind of appointment a step books. */
export function appointmentTypeForStep(title: string, description?: string | null): string {
  const words = `${title} ${description ?? ''}`;
  if (/\bimmunis|\bvaccin|\bflu shot\b/i.test(words)) return 'vaccination';
  if (/\bscan\b|\bblood tests?\b|\bscreen(ing)?\b|\bx-?ray\b|\bultrasound\b/i.test(title)) return 'test';
  if (/\breview\b|\bcare conference\b|\bfollow up\b/i.test(title)) return 'review';
  if (/\btherap|\bphysio|\bclass(es)?\b|\bprogram\b/i.test(title)) return 'therapy';
  return 'consultation';
}
