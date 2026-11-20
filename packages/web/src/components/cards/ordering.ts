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
export function orderBySituation(keys: string[], situation: Situation | null, fresh: Set<string> = new Set(), access?: string): string[] {
  // Someone helping, not the owner, starts a shift: Before you start leads.
  const helper = access === 'contributor' || access === 'viewer';
  const rank = (key: string): number => {
    if (key === 'shift') return helper ? -5 : -0.7;
    if (situation?.acuity === 'unwell' && key === 'health') return -3;
    if (situation?.ended && key === 'poa') return -2;
    if (situation?.acuity === 'watching' && key === 'health') return -1;
    // Recent activity leads the ordinary cards, and any card with something
    // new since the last visit comes up right behind it.
    if (key === 'recent') return -0.75;
    if (fresh.has(key)) return -0.5;
    return 0;
  };
  return keys
    .map((key, i) => ({ key, i, r: rank(key) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.key);
}
