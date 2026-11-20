/**
 * Care phases as stored and as the screens name them. Files people download
 * carry the screen label; a file read back in may carry either.
 */
export const PHASE_LABELS: Record<string, string> = {
  early_concern: 'Early concern',
  home_with_support: 'Home with support',
  increased_dependency: 'Increased dependency',
  transition_to_residential: 'Transition to residential',
  residential_ongoing: 'Residential ongoing',
  end_of_life: 'End of life',
};

export const phaseLabel = (code: string | null | undefined): string => (code ? PHASE_LABELS[code] ?? code : '');

/** A phase from a code or its label, any case or spacing; null when it is neither. */
export function phaseFrom(text: string | null | undefined): string | null {
  const t = String(text ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!t) return null;
  if (t in PHASE_LABELS) return t;
  const hit = Object.entries(PHASE_LABELS).find(([, label]) => label.toLowerCase().replace(/\s+/g, '_') === t);
  return hit ? hit[0] : null;
}
