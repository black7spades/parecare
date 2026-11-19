/**
 * Why a condition resolved. One list shared by the conditions routes and the
 * assistant's actions, so both write the same values. Kept in step with
 * CONDITION_RESOLUTION_REASONS in packages/web/src/lib/care.ts.
 */
export const CONDITION_RESOLUTION_REASONS = [
  'recovered',
  'treatment',
  'surgery',
  'outgrown',
  'ruled_out',
  'wrong_diagnosis',
  'not_tracking',
  'other',
] as const;

export type ConditionResolutionReason = (typeof CONDITION_RESOLUTION_REASONS)[number];
