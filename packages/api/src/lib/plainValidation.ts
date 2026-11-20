import type { ZodError } from 'zod';

/**
 * Turn a refused form into a sentence a person can act on: which box, in
 * their words, rather than "Invalid request". The labels name each field the
 * way the screen does; anything unlisted falls back to a general sentence.
 * Array positions in the path are skipped, so "next_steps.2.due_on" reads
 * as the do-by date.
 */
export function plainValidationError(error: ZodError, labels: Record<string, string>, fallback: string): string {
  for (const issue of error.issues) {
    const keys = issue.path.filter((p): p is string => typeof p === 'string');
    // The most specific label wins: "forward.body" before "forward".
    for (let i = keys.length; i > 0; i--) {
      const label = labels[keys.slice(0, i).join('.')] ?? labels[keys[i - 1]!];
      if (label) {
        if (issue.code === 'too_big' && typeof issue.maximum === 'number') {
          return `${label} is too long. Keep it under ${issue.maximum} characters.`;
        }
        if (issue.code === 'too_small' || (issue.code === 'invalid_type' && issue.received === 'undefined')) {
          return `${label} is missing. Fill it in and save again.`;
        }
        return `Check ${label.charAt(0).toLowerCase()}${label.slice(1)}. It does not look right.`;
      }
    }
  }
  return fallback;
}

/** How the appointment form's boxes are named on screen. */
export const APPOINTMENT_FIELD_LABELS: Record<string, string> = {
  title: 'What it is for',
  appointment_type: 'The kind of appointment',
  provider_id: 'Who it is with',
  provider_name: 'The name of who it is with',
  provider_type: 'What they do',
  medical_condition_id: 'The condition it is for',
  location: 'Where it is',
  address_line1: 'Address line 1',
  address_line2: 'Address line 2',
  address_suburb: 'The suburb',
  address_state: 'The state',
  address_postcode: 'The postcode',
  address_country: 'The country',
  directions_link: 'The map link',
  starts_at: 'The start date and time',
  ends_at: 'The end time',
  status: 'The status',
  notes: 'The notes',
  cost_estimate: 'The estimated cost',
  cost_actual: 'The actual cost',
  preparation: 'How to get ready',
  telehealth_link: 'The video call link',
  interpreter_language: 'The language',
  attendees: "Who's going",
  bring_document_ids: 'Documents to bring',
  repeat: 'Repeats',
  repeat_until: 'Until',
  provider_phone: 'Their phone',
};

/** How How did it go names its boxes. */
export const OUTCOME_FIELD_LABELS: Record<string, string> = {
  outcome: 'What happened',
  'next_steps.type': 'The kind of next step',
  'next_steps.details': 'The details of a next step',
  'next_steps.due_on': 'The do-by date of a next step',
  'next_steps.provider_id': 'Who a next step is with',
  'next_steps.provider_name': 'Who a next step is with',
  'next_steps.provider_type': 'What they do',
  'next_steps.forward.body': 'A note being sent with a next step',
  'next_steps.forward': 'The notes being sent with a next step',
};
