/**
 * The outcome of a recorded dose, in the words a family member reads. Only a
 * dose that went in counts as covering a scheduled time: a refused, held or
 * omitted dose is still a dose that was missed.
 */

export const DOSE_STATUSES = ['given', 'refused', 'omitted', 'held', 'self_administered', 'not_in_stock'] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];

/**
 * Not in stock: there was none to give. It is not a given dose, and it
 * raises the out-of-stock alert with who to call.
 */
export const NOT_IN_STOCK = 'not_in_stock';

/** Outcomes where the person actually had the dose. */
export const GIVEN_STATUSES: ReadonlySet<string> = new Set(['given', 'self_administered']);

export const isGivenStatus = (status: string): boolean => GIVEN_STATUSES.has(status);

const OUTCOME_WORDS: Record<string, string> = {
  given: 'given',
  self_administered: 'self-administered',
  refused: 'refused',
  omitted: 'omitted',
  held: 'held',
  not_in_stock: 'not in stock',
};

export const doseOutcomeWord = (status: string): string => OUTCOME_WORDS[status] ?? status.replace(/_/g, ' ');

/**
 * The activity line for a dose record, read after "Jess recorded":
 * "Metoprolol as refused". Kept under the 'doses' record kind so every
 * activity list can say it as a sentence rather than "Medication added".
 */
export const doseSummary = (medicationName: string, status: string): string =>
  `${medicationName} as ${doseOutcomeWord(status)}`.slice(0, 255);

/** The audit record kind for dose records. */
export const DOSE_AUDIT_ENTITY = 'doses';
