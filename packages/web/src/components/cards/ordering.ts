import type { Situation } from '../../lib/situation';

/**
 * The default order of the overview cards, re-ranked by the person's situation
 * so the right things come forward without anyone arranging them: current
 * health rises when they are unwell, and the power of attorney comes forward
 * once care has ended. The registry order breaks ties, so only the cards the
 * situation speaks to actually move.
 *
 * A person's own arrangement, once they make one, is respected instead of this
 * (see OverviewPage): the first move snapshots the current order and that saved
 * order wins from then on. So an adaptive default and a saved arrangement never
 * fight each other.
 */
export function orderBySituation(keys: string[], situation: Situation | null): string[] {
  if (!situation) return [...keys];
  const rank = (key: string): number => {
    if (situation.acuity === 'unwell' && key === 'health') return -3;
    if (situation.acuity === 'watching' && key === 'health') return -1;
    if (situation.ended && key === 'poa') return -2;
    return 0;
  };
  return keys
    .map((key, i) => ({ key, i, r: rank(key) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.key);
}
