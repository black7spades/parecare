import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * Kinds of next step an appointment can set off: a wide built-in list plus
 * any the account adds by typing a new name. Shared by everyone the account
 * cares for, like document categories.
 */
export interface NextStepType {
  id: string;
  name: string;
  system_key: string | null;
  /** Done by booking another appointment, so "Book it" is offered. */
  books: boolean;
  kept: boolean;
  kept_reason: string | null;
  /** Present for the account owner only. */
  task_count?: number;
}

export interface NextStepTypeList {
  can_manage: boolean;
  types: NextStepType[];
}

/** A next step already recorded against an appointment. It is a task. */
export interface NextStep {
  id: string;
  title: string;
  next_due_at: string;
  completed: boolean;
  completed_at: string | null;
  type_id: string | null;
  type_name: string;
  /** The built-in kind, e.g. prescription, or null for one the account added. */
  type_key: string | null;
  books: boolean;
  /** Who it is with, such as who a referral is to, from Contacts. */
  provider_id?: string | null;
  provider_name?: string | null;
  provider_type?: string | null;
  /** The appointment booked to carry it out, if any. */
  /** Empty starts_at: the details are saved but it is not booked yet. */
  led_to: { id: string; title: string; starts_at: string | null; status: string } | null;
}

export const nextStepTypesKey = (profileId: string) => ['next-step-types', profileId];

export function useNextStepTypes(profileId: string) {
  return useQuery({
    queryKey: nextStepTypesKey(profileId),
    queryFn: () => api.get<NextStepTypeList>(`/care-profiles/${profileId}/next-step-types`),
  });
}

/**
 * The ones offered as one-tap choices when recording an outcome: the most
 * common things people leave an appointment with. Everything else is a
 * type-to-find away.
 */
export const QUICK_STEP_KEYS = [
  'referral',
  'follow_up',
  'prescription',
  'blood_test',
  'urine_sample',
  'xray',
  'ultrasound',
  'results',
  'document',
  'certificate',
];

/** What to ask for in the details box, by kind, so people know what to write. */
export const DETAIL_HINTS: Record<string, string> = {
  referral: 'Anything to remember, e.g. Urgent, within six weeks',
  follow_up: 'What for, e.g. Review blood pressure',
  prescription: 'Which medication, e.g. Amoxicillin',
  medication_change: 'What changed, e.g. Metformin up to 1000 mg',
  blood_test: 'What for, e.g. Iron and thyroid',
  urine_sample: 'Where to drop it, e.g. Clinic pathology',
  stool_sample: 'Where to drop it, e.g. Clinic pathology',
  semen_sample: 'Where to drop it, e.g. Fertility clinic',
  swab: 'What for, e.g. Throat swab',
  xray: 'Of what, e.g. Left ankle',
  ultrasound: 'Of what, e.g. Abdomen',
  ct_scan: 'Of what, e.g. Chest',
  mri_scan: 'Of what, e.g. Lower back',
  results: 'Which results, e.g. Blood test from Monday',
  readings: 'What to measure, e.g. Blood pressure twice a day',
  symptoms: 'What to look out for, e.g. Fever over 38',
  equipment: 'What, e.g. Moon boot',
  form: 'Which form, e.g. Disability parking',
  certificate: 'Who for, e.g. Employer',
  document: 'What it is, e.g. Discharge summary',
  bill: 'What for, e.g. Specialist fee',
};
