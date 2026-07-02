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
  full_name: string;
  preferred_name: string | null;
  date_of_birth: string | null;
  current_phase: CarePhase;
  pronouns: string | null;
  primary_language: string | null;
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

export interface CircleMember {
  id: string;
  account_id: string | null;
  invited_email: string | null;
  display_name: string;
  role: string;
  role_description: string | null;
  poa_type: string | null;
  poa_activated: boolean;
  invite_accepted: boolean;
  created_at: string;
}

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
