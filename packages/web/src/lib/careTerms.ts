/**
 * The country's name for a written record of treatment wishes, for labels
 * drawn outside any one person's page, such as a care plan section heading.
 * Set by CountryScope once the account's country is known.
 */
let directiveTerm = 'Advance care directive';

export function setDirectiveTerm(term: string): void {
  directiveTerm = term;
}

export const currentDirectiveTerm = (): string => directiveTerm;
