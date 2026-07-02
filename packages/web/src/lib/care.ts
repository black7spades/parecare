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
