export const CARE_PHASES = [
  { value: 'early_concern', label: 'Early concern' },
  { value: 'home_with_support', label: 'Home with support' },
  { value: 'increased_dependency', label: 'Increased dependency' },
  { value: 'transition_to_residential', label: 'Transition to residential' },
  { value: 'residential_ongoing', label: 'Residential ongoing' },
  { value: 'end_of_life', label: 'End of life' },
] as const;

export type CarePhase = (typeof CARE_PHASES)[number]['value'];

export const phaseLabel = (phase: string) =>
  CARE_PHASES.find((p) => p.value === phase)?.label ?? phase;

export interface PhaseHistoryEntry {
  phase: string;
  entered_at: string;
  locked_at: string | null;
}

export const LOG_ENTRY_TYPES = [
  { value: 'visit', label: 'Visit' },
  { value: 'medication', label: 'Medication' },
  { value: 'medical_appointment', label: 'Medical appointment' },
  { value: 'phone_call', label: 'Phone call' },
  { value: 'decision_made', label: 'Decision made' },
  { value: 'concern_raised', label: 'Concern raised' },
  { value: 'observation', label: 'Observation' },
  { value: 'handover', label: 'Handover' },
] as const;

export type LogEntryType = (typeof LOG_ENTRY_TYPES)[number]['value'];

export const entryTypeLabel = (type: string) =>
  LOG_ENTRY_TYPES.find((t) => t.value === type)?.label ?? type;

export interface CareProfile {
  id: string;
  /** Composed display name derived from the structured name parts. */
  full_name: string;
  title: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  suffix: string | null;
  owner_relationship?: string | null;
  preferred_name: string | null;
  date_of_birth: string | null;
  current_phase: CarePhase;
  pronouns: string | null;
  primary_language: string | null;
  photo_url: string | null;
  photo_color: string | null;
  notes: string | null;
}

export interface ChecklistItem {
  id: string;
  phase: CarePhase;
  title: string;
  description: string | null;
  completed: boolean;
  is_custom: boolean;
  sort_order: number;
  note_count: number;
}

export interface ChecklistNote {
  id: string;
  body: string;
  created_at: string;
  author_name: string | null;
}

export interface CareLogEntry {
  id: string;
  entry_type: LogEntryType;
  title: string | null;
  body: string;
  occurred_at: string;
  created_at: string;
}

export const POA_TYPES = [
  { value: 'enduring', label: 'Enduring power of attorney' },
  { value: 'medical', label: 'Medical treatment decision maker' },
  { value: 'financial', label: 'Financial power of attorney' },
  { value: 'guardianship', label: 'Guardianship' },
] as const;

export const poaLabel = (type: string | null) =>
  POA_TYPES.find((t) => t.value === type)?.label ?? 'Power of attorney';

export type CirclePermission = 'viewer' | 'contributor';
export type AccessLevel = 'owner' | 'admin' | 'contributor' | 'viewer';

/** Sentinel relationship for a profile that tracks the owner's own care. */
export const SELF_RELATIONSHIP = 'Myself';

export const RELATIONSHIPS = [
  SELF_RELATIONSHIP,
  'Mum',
  'Dad',
  'Son',
  'Daughter',
  'Partner',
  'Grandma',
  'Grandpa',
  'Mother-in-law',
  'Father-in-law',
  'Aunt',
  'Uncle',
  'Sister',
  'Brother',
  'Cousin',
  'Friend',
  'Neighbour',
  'Client',
  'Resident',
] as const;

export interface CircleMember {
  id: string;
  account_id: string | null;
  invited_email: string | null;
  display_name: string;
  role: string;
  relationship: string | null;
  role_description: string | null;
  poa_type: string | null;
  poa_activated: boolean;
  can_edit_profile: boolean;
  invite_accepted: boolean;
  permission: CirclePermission;
  created_at: string;
  /** Present for owners and admins while an invite is pending. */
  invite_status?: 'pending' | 'accepted' | 'revoked' | 'expired';
  invite_expires_at?: string;
  invite_url?: string | null;
}

export interface ActivityEntry {
  id: string;
  action: 'created' | 'updated' | 'deleted';
  entity_type: string;
  summary: string | null;
  created_at: string;
  actor_name: string | null;
}

const ENTITY_LABELS: Record<string, string> = {
  circle: 'care circle member',
  log: 'care log entry',
  plan: 'care plan',
  checklists: 'checklist item',
  questions: 'question',
  documents: 'document',
  providers: 'provider',
  reminders: 'task',
  messages: 'message',
  'memory-book': 'memory',
  'care-profiles': 'profile',
  ai: 'AI conversation',
};

export const entityLabel = (type: string) => ENTITY_LABELS[type] ?? type;

export const DOCUMENT_CATEGORIES = [
  { value: 'poa', label: 'Power of attorney' },
  { value: 'will', label: 'Will' },
  { value: 'advance_care_directive', label: 'Advance care directive' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'identity', label: 'Identity' },
  { value: 'medical_record', label: 'Medical record / certificate' },
  { value: 'facility_contract', label: 'Facility contract' },
  { value: 'financial', label: 'Financial' },
  { value: 'other', label: 'Other' },
] as const;

export const documentCategoryLabel = (cat: string) =>
  DOCUMENT_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;

export interface CareDocument {
  id: string;
  category: string;
  label: string;
  file_url: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  visible_to_roles: string[] | null;
  created_at: string;
}

export const PROVIDER_TYPES = [
  { value: 'gp', label: 'GP' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'care_facility', label: 'Care facility' },
  { value: 'allied_health', label: 'Allied health' },
  { value: 'legal', label: 'Legal' },
  { value: 'financial', label: 'Financial' },
  { value: 'social_worker', label: 'Social worker' },
  { value: 'other', label: 'Other' },
] as const;

export const providerTypeLabel = (type: string) =>
  PROVIDER_TYPES.find((t) => t.value === type)?.label ?? type;

export interface Provider {
  id: string;
  provider_type: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

export interface Task {
  id: string;
  title: string;
  body: string | null;
  reminder_type: 'once' | 'daily' | 'weekly' | 'monthly';
  next_due_at: string;
  assigned_to: string | null;
  completed: boolean;
}

export interface ChatMessage {
  id: string;
  body: string;
  created_at: string;
  author_account_id: string | null;
  author_name: string | null;
}

export interface OpenQuestion {
  id: string;
  title: string;
  body: string | null;
  status: 'open' | 'resolved' | 'deferred';
  resolution: string | null;
  created_at: string;
}

export interface QuestionResponse {
  id: string;
  body: string;
  created_at: string;
  is_ai: boolean;
  author_name: string | null;
}

export interface MemoryEntry {
  id: string;
  title: string | null;
  body: string;
  photo_url: string | null;
  created_at: string;
  author_account_id: string | null;
  author_name: string | null;
}

export interface Medication {
  name: string;
  dose?: string;
  frequency?: string;
  prescriber?: string;
}

export interface EmergencyContact {
  name: string;
  relationship?: string;
  phone: string;
}

/** A first-class medication record (distinct from the care-plan summary). */
export interface MedicationRecord {
  id: string;
  care_profile_id: string;
  medication_catalogue_id?: string;
  name: string;
  dose: string | null;
  form: string | null;
  route: string | null;
  frequency: string | null;
  schedule_times: string[] | null;
  instructions: string | null;
  supply: number | null;
  supply_remaining: number | null;
  active: boolean;
}

// Plain-language descriptions accompany every outcome so a family carer who
// has never worked in aged care understands the clinical terms.
export const MED_STATUSES = [
  { value: 'given', label: 'Given', description: 'You gave the dose and it was taken.' },
  { value: 'refused', label: 'Refused', description: 'The person did not want the dose and declined it.' },
  { value: 'omitted', label: 'Omitted', description: 'The dose was skipped this time, for example the person was asleep, unwell or fasting.' },
  { value: 'held', label: 'Held', description: 'The dose was deliberately paused, for example on a doctor or pharmacist instruction.' },
  { value: 'self_administered', label: 'Self-administered', description: 'The person took the dose themselves.' },
] as const;

export const medStatusLabel = (s: string) => MED_STATUSES.find((x) => x.value === s)?.label ?? s;
export const medStatusDescription = (s: string) => MED_STATUSES.find((x) => x.value === s)?.description ?? '';

export const MED_RIGHTS = [
  { key: 'right_patient', label: 'Right patient' },
  { key: 'right_medication', label: 'Right medication' },
  { key: 'right_dose', label: 'Right dose' },
  { key: 'right_route', label: 'Right route' },
  { key: 'right_time', label: 'Right time' },
  { key: 'right_documentation', label: 'Right documentation' },
] as const;

export interface MedicationAdministration {
  id: string;
  medication_id: string;
  medication_name: string;
  medication_dose: string | null;
  medication_route: string | null;
  administered_at: string;
  scheduled_for: string | null;
  administered_by_name: string | null;
  status: string;
  dose_given: string | null;
  route_given: string | null;
  notes: string | null;
  right_patient: boolean;
  right_medication: boolean;
  right_dose: boolean;
  right_route: boolean;
  right_time: boolean;
  right_documentation: boolean;
}

export interface CarePlan {
  conditions: string[];
  medications: Medication[];
  dietary_requirements: string[];
  mobility_aids: string[];
  communication_preferences: string | null;
  advance_care_directive: boolean;
  advance_care_directive_location: string | null;
  gp_name: string | null;
  gp_practice: string | null;
  gp_phone: string | null;
  emergency_contacts: EmergencyContact[];
}
