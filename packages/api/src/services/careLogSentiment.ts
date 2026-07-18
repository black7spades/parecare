import { db } from '../config/database';
import { complete, isAiConfigured } from './aiProvider';

/**
 * Read the emotional tone of a care log note and store it as a 1-to-6
 * sentiment, matching the task outcome scale (1 angry, 2 sad, 3 disappointed,
 * 4 neutral, 5 happy, 6 overjoyed). The reading is about how things are going
 * for the person the note is about, not how the writer feels.
 *
 * Best-effort: if the assistant is not configured, times out, or answers with
 * something unusable, the entry simply keeps no analysed sentiment. It never
 * overwrites a sentiment a person set by hand.
 */

const SCALE_HELP =
  '1 = angry or highly distressing, 2 = sad, 3 = disappointing or off, 4 = neutral or routine, 5 = positive or happy, 6 = wonderful or joyful';

/** Pull the first standalone 1-6 out of the model's reply. */
function parseScore(text: string): number | null {
  const m = text.match(/[1-6]/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 1 && n <= 6 ? n : null;
}

export async function analyseCareLogSentiment(
  entryId: string,
  entryType: string,
  title: string | null,
  body: string
): Promise<void> {
  if (!isAiConfigured()) return;
  const note = [title, body].filter(Boolean).join('. ').slice(0, 2000);
  if (!note.trim()) return;

  const system =
    'You read a single care log note and rate the emotional tone of what it describes on a scale from 1 to 6. ' +
    `${SCALE_HELP}. The rating is about how things are going for the person the note is about, not the writer. ` +
    'Reply with only the single digit, nothing else.';

  try {
    const { text } = await complete(
      system,
      [{ role: 'user', content: `Care log note (type: ${entryType}):\n${note}` }],
      8,
      'chat'
    );
    const score = parseScore(text);
    if (score == null) return;
    // Only fill an unset value: a hand-set rating, or one set since we started,
    // must never be clobbered by the analysis.
    await db('care_log_entries')
      .where({ id: entryId })
      .whereNull('sentiment_source')
      .update({ sentiment: score, sentiment_source: 'ai' });
  } catch (err) {
    console.warn('Care log sentiment analysis failed:', (err as Error).message);
  }
}
