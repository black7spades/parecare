import type { ContactSummary } from './care';

/**
 * Life events as the screens read them: hospital stays, test results,
 * funding plans, moves into care and suggested reminders. The API's
 * services/hospitalStays, testResults, fundingPlans, careMoves and recalls
 * build these shapes.
 */

export interface TaskRef {
  id: string;
  title: string;
  next_due_at: string;
  all_day: boolean;
  completed: boolean;
}

export interface HospitalStay {
  id: string;
  care_profile_id: string;
  hospital_provider_id: string | null;
  admitted_on: string;
  discharged_on: string | null;
  ward: string | null;
  treating_team: string | null;
  treating_provider_id: string | null;
  reason: string | null;
  discharge_document_id: string | null;
  follow_up_task_id: string | null;
  plan_review_task_id: string | null;
  hospital: ContactSummary | null;
  treating: ContactSummary | null;
  discharge_document: { id: string; label: string | null } | null;
  follow_up_task: TaskRef | null;
  plan_review_task: TaskRef | null;
}

/** The open stay, as the banner shows it. */
export interface OpenStay {
  id: string;
  hospital: ContactSummary | null;
  hospital_name: string | null;
  ward: string | null;
  admitted_on: string;
  days: number;
}

export interface ResultValue {
  id?: string;
  name: string;
  value_number: number | null;
  value_text: string | null;
  unit: string | null;
  range_low: number | null;
  range_high: number | null;
  flag: 'low' | 'high' | 'normal' | null;
}

export interface AppointmentRef {
  id: string;
  title: string;
  starts_at: string | null;
  all_day: boolean;
  status: string;
  provider_name: string | null;
}

export interface TestResult {
  id: string;
  test_name: string;
  collected_on: string | null;
  reported_on: string | null;
  appointment_id: string | null;
  review_appointment_id: string | null;
  ordered_by_provider_id: string | null;
  lab_provider_id: string | null;
  medical_condition_id: string | null;
  summary: string | null;
  doctor_view: 'normal' | 'follow_up' | 'not_seen' | null;
  values: ResultValue[];
  ordered_by: ContactSummary | null;
  lab: ContactSummary | null;
  appointment: AppointmentRef | null;
  review_appointment: AppointmentRef | null;
  condition: { id: string; name: string } | null;
}

export const DOCTOR_VIEWS = [
  { value: 'normal', label: 'Normal' },
  { value: 'follow_up', label: 'Needs a follow-up' },
  { value: 'not_seen', label: 'Not seen by a doctor yet' },
] as const;
export const doctorViewLabel = (v: string | null | undefined) => DOCTOR_VIEWS.find((d) => d.value === v)?.label ?? '';

export const RESULT_FLAGS = [
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
] as const;
export const flagLabel = (v: string | null | undefined) => RESULT_FLAGS.find((d) => d.value === v)?.label ?? '';

export interface Budget {
  id: string;
  name: string;
  amount: number;
  spent: number;
  left: number;
}

export interface FundingPlan {
  id: string;
  scheme: 'ndis' | 'support_at_home' | 'home_care_package' | 'other';
  scheme_label: string;
  starts_on: string | null;
  ends_on: string | null;
  review_on: string | null;
  reports_due_on: string | null;
  reports_due_worked_out: boolean;
  management: 'agency' | 'plan' | 'self' | null;
  management_label: string | null;
  plan_manager: ContactSummary | null;
  support_coordinator: ContactSummary | null;
  local_area_coordinator: ContactSummary | null;
  budgets: Budget[];
  report_tasks: Array<{ id: string; title: string; next_due_at: string; all_day: boolean; completed: boolean; provider_name: string | null; provider_phone: string | null }>;
}

export const SCHEMES = [
  { value: 'ndis', label: 'NDIS plan' },
  { value: 'support_at_home', label: 'Support at Home' },
  { value: 'home_care_package', label: 'Home Care Package' },
  { value: 'other', label: 'Other funding' },
] as const;

export const MANAGEMENT = [
  { value: 'agency', label: 'Managed by the NDIA' },
  { value: 'plan', label: 'Plan managed' },
  { value: 'self', label: 'Self managed' },
] as const;

export interface CareMove {
  id: string;
  facility_provider_id: string | null;
  entry_on: string | null;
  agreement_signed_on: string | null;
  cooling_off_ends_on: string | null;
  payment_choice: 'lump_sum' | 'daily' | 'mix' | null;
  payment_choice_due_on: string | null;
  notice_given_on: string | null;
  leaving_on: string | null;
  previous_address_id: string | null;
  facility: ContactSummary | null;
  payment_label: string | null;
  previous_address: { id: string; formatted: string | null } | null;
  cooling_off_worked_out: boolean;
  payment_due_worked_out: boolean;
}

export const PAYMENT_CHOICES = [
  { value: 'lump_sum', label: 'Lump sum' },
  { value: 'daily', label: 'Daily payments' },
  { value: 'mix', label: 'Part lump sum and part daily' },
] as const;

export interface RecallSuggestion {
  rule: string;
  line: string;
  title: string;
  repeat: string;
  due_on: string;
  key: string;
}

export interface Roster {
  week_start: string;
  days: string[];
  people: Array<{ key: string; name: string; who: 'circle' | 'account' | 'anyone'; items: Array<{ task_id: string; title: string; date: string; time: string | null }> }>;
  anyone_assigned: boolean;
}

export const OWNERSHIP = [
  { value: 'owned', label: 'Owned' },
  { value: 'loaned', label: 'On loan' },
  { value: 'hired', label: 'Hired' },
] as const;
export const ownershipLabel = (v: string | null | undefined) => OWNERSHIP.find((o) => o.value === v)?.label ?? '';

/** YYYY-MM-DD plus days, as YYYY-MM-DD. */
export function addDays(day: string, days: number): string {
  const t = new Date(`${day}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/**
 * Places a person stays in, the same list the API filters the facility
 * picker by (lib/providerTypes.ts isFacility).
 */
const FACILITY_SET = new Set(
  ['Hospital', 'care_facility', 'Aged care home', 'Nursing home', 'Care home', 'Retirement village', 'Group home', 'Hospice', 'Respite service'].map((t) => t.toLowerCase())
);
const FACILITY_WORDS = /\b(hospital|aged care|nursing home|care home|retirement village|hospice|group home|respite)\b/i;
export function isFacilityProvider(p: { provider_type: string | null; name: string; kind?: string | null }): boolean {
  if (p.kind === 'person') return false;
  const t = String(p.provider_type ?? '').trim().toLowerCase();
  if (FACILITY_SET.has(t)) return true;
  return (!t || t === 'other' || t === 'practice') && FACILITY_WORDS.test(p.name);
}
