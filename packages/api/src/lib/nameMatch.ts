/**
 * Fuzzy matching of a spoken name against the care profiles an account can
 * reach. People rarely type a profile's full legal name: they say "Chris
 * Rattray" for "Mr Christian Paul Rattray". The assistant must recognise
 * that without swinging wildly to unrelated profiles (a pet with a
 * different surname is never a candidate).
 *
 * The rule of thumb: a query matches a profile when every word of the query
 * is accounted for by some part of that profile's name, where a word counts
 * if it is the same, a known short form (Chris/Christian), or a clear prefix
 * (Chris/Christian). The surname is the anchor, so "Chris Rattray" only
 * matches Rattrays.
 */

export interface NameCandidate {
  id: string;
  full_name: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

// Titles carry no identifying value and must not block a match.
const HONORIFICS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'mx',
  'dr',
  'prof',
  'professor',
  'sir',
  'dame',
  'rev',
  'reverend',
  'lady',
  'lord',
]);

// Common short forms, checked in both directions. Not exhaustive; prefix
// matching catches many more (Chris/Christian, Matt/Matthew).
const NICKNAMES: Record<string, string[]> = {
  christian: ['chris'],
  christopher: ['chris', 'kit'],
  christina: ['chris', 'chrissy', 'tina'],
  matthew: ['matt'],
  daniel: ['dan', 'danny'],
  thomas: ['tom', 'tommy'],
  william: ['will', 'bill', 'billy', 'liam'],
  robert: ['rob', 'bob', 'bobby'],
  richard: ['rich', 'rick', 'dick'],
  james: ['jim', 'jimmy', 'jamie'],
  michael: ['mike', 'mick', 'mikey'],
  elizabeth: ['liz', 'beth', 'betty', 'eliza', 'lizzy', 'libby'],
  margaret: ['maggie', 'meg', 'peggy', 'marge'],
  katherine: ['kate', 'katie', 'kath', 'kathy', 'kit'],
  catherine: ['cathy', 'cath', 'kate', 'katie'],
  patricia: ['pat', 'patty', 'tricia'],
  jennifer: ['jen', 'jenny'],
  deborah: ['deb', 'debbie'],
  susan: ['sue', 'susie'],
  anthony: ['tony'],
  joseph: ['joe', 'joey'],
  edward: ['ed', 'eddie', 'ted', 'ned'],
  charles: ['charlie', 'chuck'],
  nicholas: ['nick', 'nicky'],
  samuel: ['sam', 'sammy'],
  benjamin: ['ben', 'benji'],
  alexander: ['alex', 'sandy', 'xander'],
  alexandra: ['alex', 'sandy', 'lexi'],
  andrew: ['andy', 'drew'],
  vivienne: ['viv'],
  vivian: ['viv'],
  victoria: ['vicky', 'tori', 'vic'],
  rebecca: ['bec', 'becky', 'becca'],
  jonathan: ['jon', 'jonny'],
  stephen: ['steve', 'stevie'],
  steven: ['steve', 'stevie'],
  timothy: ['tim', 'timmy'],
  peter: ['pete'],
  david: ['dave', 'davey'],
};

function normalise(value: string | null | undefined): string[] {
  return (value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => !HONORIFICS.has(t));
}

/** Every distinct name word a profile is known by. */
function candidateTokens(c: NameCandidate): Set<string> {
  return new Set([
    ...normalise(c.full_name),
    ...normalise(c.first_name),
    ...normalise(c.middle_name),
    ...normalise(c.last_name),
    ...normalise(c.preferred_name),
  ]);
}

/** Whether one query word is accounted for by any of a profile's name words. */
function wordCovered(q: string, tokens: Set<string>): boolean {
  for (const t of tokens) {
    if (q === t) return true;
    if ((NICKNAMES[t] ?? []).includes(q)) return true;
    if ((NICKNAMES[q] ?? []).includes(t)) return true;
    // Prefixes of length 3+ catch Chris/Christian, Sam/Samuel, etc.
    if (q.length >= 3 && t.startsWith(q)) return true;
    if (t.length >= 3 && q.startsWith(t)) return true;
  }
  return false;
}

/**
 * The ids of the profiles the query best identifies. Exact matches on the
 * whole full name, preferred name or first name win outright; otherwise a
 * profile qualifies when every query word is covered by its name words.
 * Returns every profile at the best tier, so the caller can treat one match
 * as resolved and several as "ask which one".
 */
export function matchProfileNames(query: string, candidates: NameCandidate[]): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const exact = candidates.filter(
    (c) =>
      c.full_name.trim().toLowerCase() === needle ||
      (c.preferred_name ?? '').trim().toLowerCase() === needle ||
      (c.first_name ?? '').trim().toLowerCase() === needle
  );
  if (exact.length > 0) return exact.map((c) => c.id);

  const queryWords = normalise(needle);
  if (queryWords.length === 0) return [];

  const fuzzy = candidates.filter((c) => {
    const tokens = candidateTokens(c);
    return queryWords.every((q) => wordCovered(q, tokens));
  });
  return fuzzy.map((c) => c.id);
}
