import { complete, isAiConfigured } from './aiProvider';

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
  if (!text || !isAiConfigured()) return { ok: true };

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
