import { complete, isAiConfigured } from './aiProvider';
import { db } from '../config/database';
import { isMessageToneGuardEnabled } from '../config/settings';

/**
 * The message tone guard. Family messaging about someone's care can turn
 * tense, and old grievances, personal attacks and off-topic venting pull
 * everyone away from the one thing that matters: the person being cared for.
 * Before a message posts, this reads it and either lets it through or asks the
 * sender to revise, offering a calm, care-focused rewrite of their own point.
 *
 * It is deliberately permissive about hard subjects: disagreement about care,
 * bad news, concerns and firm boundaries are all fine when said without
 * contempt. It only stops a message that attacks a person, drags in unrelated
 * past conflict, or has nothing to do with the person's care.
 *
 * Fail-open: if the assistant is not configured, errors, or is too slow, the
 * message is allowed. The guard must never become a reason family cannot talk.
 */

export type ToneVerdict =
  | { ok: true }
  | { ok: false; reason: string; suggestion: string };

const TIMEOUT_MS = 12_000;

/**
 * A deterministic first pass that needs no model. It catches the clear-cut
 * cases that must never slip through, no matter what the assistant is doing:
 * strong swearing, slurs, threats, and hostility pointed at people. The AI
 * layer handles everything subtler; this one is the guarantee.
 */

// Strong profanity, matched at word boundaries with common endings. Kept to
// roots that are not substrings of ordinary words (so "class", "assist" and
// the like are never caught).
const PROFANITY = [
  'fuck\\w*', 'motherfuck\\w*', 'shit\\w*', 'bullshit', 'cunt\\w*',
  'pricks?', 'wankers?', 'bastards?', 'arseholes?', 'assholes?',
  'dickheads?', 'bitch(?:es)?', 'bollocks', 'twats?', 'piss(?:ed|ing)? off',
];

// Slurs and clearly dehumanising terms. Always blocked.
const SLURS = [
  'retard\\w*', 'faggots?', 'fags?', 'niggers?', 'niggas?', 'spastics?', 'tranny',
];

// Hostility aimed at people rather than the care matter, and threats. These
// need no swearing to be a problem.
const HOSTILITY: RegExp[] = [
  /\bi\s+(hate|despise|loathe|detest)\s+(you|y'?all|you\s+all|everyone|the\s+lot\s+of\s+you|these\s+people|this\s+family)\b/i,
  /\bhate\s+you\s+all\b/i,
  /\bshut\s+(up|the\s+f\w*)\b/i,
  /\bgo\s+to\s+hell\b/i,
  /\bkill\s+your\s?self\b/i,
  /\b(i'?ll|i\s+will|i'?m\s+gonna|going\s+to)\s+(kill|hurt|destroy|end)\s+(you|him|her|them|the\s+lot)\b/i,
  /\byou(?:'?re|\s+are)?\s+(all\s+)?(pathetic|useless|worthless|disgusting|scum|vermin|a\s+disgrace)\b/i,
];

const PROFANITY_RE = new RegExp(`\\b(?:${PROFANITY.join('|')})\\b`, 'i');
const SLUR_RE = new RegExp(`\\b(?:${SLURS.join('|')})\\b`, 'i');

/**
 * Screen a message without the assistant. Returns a block reason when the
 * message is clearly unacceptable, or null to let the AI layer decide.
 */
export function screenMessageTone(body: string, careName: string): { reason: string } | null {
  const text = body.toLowerCase();
  if (SLUR_RE.test(text) || HOSTILITY.some((re) => re.test(body))) {
    return {
      reason: `This message is aimed at people rather than ${careName}'s care. Please rewrite it around what needs to happen, without attacking anyone.`,
    };
  }
  if (PROFANITY_RE.test(text)) {
    return {
      reason: `Please rewrite this without the strong language, focused on ${careName}'s care.`,
    };
  }
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('tone check timed out')), ms)),
  ]);
}

/** Pull the first JSON object out of a model reply that may include prose. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function reviewMessageTone(body: string, careName: string): Promise<ToneVerdict> {
  const text = body.trim();
  if (!text) return { ok: true };

  // The deterministic backstop runs first and always, so blatant abuse is
  // stopped even when the assistant is unconfigured, slow, or uncooperative.
  const screened = screenMessageTone(text, careName);
  if (screened) return { ok: false, reason: screened.reason, suggestion: '' };

  // Everything subtler is left to the assistant, which fails open below.
  if (!isAiConfigured()) return { ok: true };

  const system = [
    `You are the tone guard for PareCare, where a family coordinates the care of ${careName}.`,
    'You review one message a member is about to post to the others and decide whether it stays focused on care and is said without hostility.',
    'ALLOW the message (this is the default) when it is about coordinating care, even if it is a disagreement, a concern, bad news, or a firm boundary, as long as it is not a personal attack. Plain, direct, and emotional are all fine.',
    'ASK FOR A REVISION only when the message clearly does one of these: attacks or insults a person or their character; expresses contempt or hostility; drags in past grievances or old conflicts unrelated to the current care matter; or is off-topic venting that has nothing to do with caring for the person.',
    'When you ask for a revision, keep the sender’s legitimate point intact and rewrite it as they might say it: calm, specific, and focused on the care of the person. Never invent facts. Never scold the sender.',
    'Reply with ONLY a JSON object and nothing else: {"allowed": true} when it is fine, or {"allowed": false, "reason": "one short, kind sentence naming what to change", "rewrite": "the revised message in the sender’s own voice"} when it needs work.',
  ].join('\n');

  try {
    const { text: reply } = await withTimeout(
      complete(system, [{ role: 'user', content: text }], 700, 'chat'),
      TIMEOUT_MS
    );
    const parsed = parseJsonObject(reply);
    if (!parsed) return { ok: true }; // unreadable verdict: fail open
    if (parsed['allowed'] !== false) return { ok: true };
    const reason = typeof parsed['reason'] === 'string' ? parsed['reason'].trim() : '';
    const suggestion = typeof parsed['rewrite'] === 'string' ? parsed['rewrite'].trim() : '';
    // If the model flagged it but gave nothing useful to act on, let it through
    // rather than blocking with no guidance.
    if (!reason && !suggestion) return { ok: true };
    return {
      ok: false,
      reason: reason || 'This message could be more focused on care. Here is a suggested rewrite.',
      suggestion,
    };
  } catch (err) {
    console.warn('Message tone check skipped:', (err as Error).message);
    return { ok: true };
  }
}

/**
 * Guard a piece of member-written text on a profile, honouring the instance
 * setting. Shared by every communications surface (messages, questions,
 * memory book) so they all enforce the same tone in the same way. Returns
 * { ok: true } when the guard is off or the text is fine.
 */
export async function guardMessageTone(profileId: string, text: string): Promise<ToneVerdict> {
  if (!isMessageToneGuardEnabled()) return { ok: true };
  if (!text || !text.trim()) return { ok: true };
  const profile = await db('care_profiles').where({ id: profileId }).first();
  const careName = profile?.preferred_name ?? profile?.first_name ?? profile?.full_name ?? 'this person';
  return reviewMessageTone(text, careName);
}

/** The 422 body every surface returns when the guard asks for a revision. */
export function toneBlockBody(verdict: Extract<ToneVerdict, { ok: false }>) {
  return {
    error: verdict.reason,
    code: 'TONE_REVISION_NEEDED',
    reason: verdict.reason,
    suggestion: verdict.suggestion,
  };
}
