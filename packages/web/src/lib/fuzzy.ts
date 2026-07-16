/**
 * Lightweight fuzzy matching for catalogue lookups, so a typo like
 * "asprin" still finds "Aspirin" instead of creating a duplicate entry.
 */

/** Classic Levenshtein edit distance. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * Similarity in [0, 1]: 1 is identical (case-insensitive), 0 shares
 * nothing. Prefix and substring matches score high so ordinary
 * autocomplete behaviour is preserved.
 */
export function similarity(query: string, candidate: string): number {
  const q = query.trim().toLowerCase();
  const c = candidate.trim().toLowerCase();
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.startsWith(q)) return 0.95;
  if (c.includes(q)) return 0.85;
  const dist = editDistance(q, c);
  return 1 - dist / Math.max(q.length, c.length);
}

/**
 * Rank candidates against the query, best first, dropping anything below
 * the threshold. Use ~0.55 for suggestion lists and ~0.8 for "did you
 * mean" nudges.
 */
export function fuzzyRank<T>(
  query: string,
  candidates: T[],
  text: (item: T) => string,
  threshold = 0.55
): T[] {
  return candidates
    .map((item) => ({ item, score: similarity(query, text(item)) }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}
