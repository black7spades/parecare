/**
 * A person's situation, composed on the server and returned with their
 * profile. The shape mirrors services/situation.ts on the API. It is read to
 * decide what surfaces for this person: which sections and cards belong, and
 * the order the overview leads with before anyone arranges it.
 */
export interface Situation {
  journey: { name: string; phase: string; phase_index: number } | null;
  life_stage: string | null;
  acuity: 'settled' | 'watching' | 'unwell';
  attention: { urgent: number; total: number };
  ended: boolean;
}
