/**
 * One list of repeats for tasks and appointments, the same as the API's
 * lib/repeat.ts. Forms send the choice; the server stores the rule.
 */
export const REPEAT_CHOICES = [
  { value: 'once', label: "Doesn't repeat" },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'fortnightly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'three_monthly', label: 'Every 3 months' },
  { value: 'six_monthly', label: 'Every 6 months' },
  { value: 'yearly', label: 'Every year' },
] as const;

export type RepeatChoice = (typeof REPEAT_CHOICES)[number]['value'];

export const repeatLabel = (choice: string | null | undefined): string =>
  REPEAT_CHOICES.find((c) => c.value === choice)?.label ?? "Doesn't repeat";

/** Order for sorting a list by how often it repeats. */
export const repeatRank = (choice: string | null | undefined): number => {
  const i = REPEAT_CHOICES.findIndex((c) => c.value === choice);
  return i < 0 ? 0 : i;
};
