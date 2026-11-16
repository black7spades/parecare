/**
 * Telling provider names apart, shared by duplicate spotting, merging and
 * every lookup that finds a provider by what someone called it.
 */

// Words that do not tell two places apart: "Health Hub Doctors Morayfield"
// and "Health Hub Morayfield" are the same place, "Dr Karen Sank" and
// "Karen Sank" the same person.
const FILLER = new Set([
  'the', 'and', 'of', 'at', 'in', 'on', 'a', 'an', 'for',
  'dr', 'drs', 'doctor', 'doctors', 'prof', 'professor', 'mr', 'mrs', 'ms', 'miss',
  'pty', 'ltd', 'limited', 'inc', 'group', 'co',
]);

/** The words in a name that matter for telling it apart. */
export function nameTokens(name: string): string[] {
  return [
    ...new Set(
      name
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w && !FILLER.has(w))
    ),
  ].sort();
}

/** Same words once the filler is set aside: safe to treat as one, even unasked. */
export function sameName(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  return ta.length > 0 && ta.join(' ') === tb.join(' ');
}

/**
 * Close enough to suggest, but not to act on unasked: the same words, or
 * one name is the other with one word added ("Neuro Clinic" and "Neuro
 * Clinic Brisbane"), sharing at least two words.
 */
export function similarName(a: string, b: string): boolean {
  if (sameName(a, b)) return true;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (small.length < 2 || large.length - small.length > 1) return false;
  return small.every((w) => large.includes(w));
}
