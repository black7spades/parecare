/**
 * How a page speaks about the person, to whoever is looking: "you" and
 * "your" on your own profile, otherwise the person's own name, never the
 * relationship word ("mother's", "self's"). Every subheader, card and
 * placeholder takes its words from here.
 */
export interface Voice {
  /** Their own profile, seen by them. */
  isSelf: boolean;
  /** The name to use, never a relationship word. */
  name: string;
  /** "you" or "Dorothy", as the one doing something. */
  subject: string;
  /** "your" or "Dorothy's". */
  possessive: string;
  /** "you" or "Dorothy", as the one something is done for. */
  object: string;
}

export function possessiveOf(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

export function voiceFor(name: string, isSelf: boolean): Voice {
  return isSelf
    ? { isSelf, name, subject: 'you', possessive: 'your', object: 'you' }
    : { isSelf, name, subject: name, possessive: possessiveOf(name), object: name };
}

/** The first letter as a capital, for a voice word starting a sentence. */
export const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
