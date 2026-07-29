import { db } from '../config/database';
import { lastPassedDrill } from './backupDrill';

/**
 * How far this installation has got towards records that would actually
 * survive something going wrong.
 *
 * Three levels, each earned by evidence rather than by claiming it. Nothing
 * here is a checkbox someone ticks: a level is worked out from what has
 * genuinely happened, so it cannot be reached by intending to.
 *
 * The order is deliberate. Each level is worth less without the one before,
 * and the last is the one everybody skips: proving a restore actually works.
 * Putting it at the top of the climb is the only honest way found to make the
 * boring half feel like progress instead of nagging.
 */

export interface BackupLevel {
  level: number;
  /** Short, and about the person's situation rather than the mechanism. */
  title: string;
  /** What being here actually means for them, in one sentence. */
  meaning: string;
  reached: boolean;
  /** The single next thing to do, when this is the level being worked on. */
  next?: string;
}

export interface LevelReport {
  current: number;
  total: number;
  levels: BackupLevel[];
  /** One line for the top of the screen. */
  headline: string;
}

const TOTAL = 3;

export async function levelReport(): Promise<LevelReport> {
  const [aCopy, offsite, drill] = await Promise.all([
    db('backups').where({ status: 'ok' }).first(),
    // A copy someone downloaded and keeps on their own machine is off this
    // server just as much as one sent to Drive. Counting only the automatic
    // kind would have made this level's own advice a lie.
    db('backups')
      .where({ status: 'ok' })
      .where((qb) => qb.whereNotNull('offsite_at').orWhereNotNull('downloaded_at'))
      .first(),
    lastPassedDrill(),
  ]);

  const levels: BackupLevel[] = [
    {
      level: 1,
      title: 'Copies are being made',
      meaning: 'A mistake, a bad edit or an accidental deletion can be undone.',
      reached: !!aCopy,
      next: 'Press Make a copy now, and the first one exists in under a minute.',
    },
    {
      level: 2,
      title: 'A copy lives somewhere else',
      meaning: 'Losing this server no longer means losing the records.',
      reached: !!offsite,
      next: 'Connect Google Drive, Dropbox or your own storage, or download a copy and keep it safe.',
    },
    {
      level: 3,
      title: 'A restore has been proved',
      meaning: 'The copies are known to work, because records were destroyed and brought back.',
      reached: !!drill,
      next: 'Run a practice emergency. It destroys and restores a practice copy, and never touches anything real.',
    },
  ];

  // Levels are earned in order: reaching three while two is missing would say
  // the records are safe when the copies have never left this server.
  let current = 0;
  for (const l of levels) {
    if (!l.reached) break;
    current = l.level;
  }

  // No "Level 2 of 3" here: the screen already says that above this line, and
  // saying it twice reads like a system talking to itself.
  const headline =
    current === 0
      ? 'No copies yet. The first one takes under a minute.'
      : current === TOTAL
        ? 'Everything is in place. Copies are made, kept somewhere else, and proved to work.'
        : (levels[current]?.next ?? '');

  return { current, total: TOTAL, levels, headline };
}
