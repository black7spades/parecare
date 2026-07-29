import { db } from '../config/database';
import { lastPassedDrill } from './backupDrill';

/**
 * How far this installation has got towards records that would actually
 * survive something going wrong.
 *
 * Five levels, each earned by evidence rather than by claiming it. Nothing
 * here is a checkbox someone ticks: a level is worked out from what has
 * genuinely happened, so it cannot be reached by intending to.
 *
 * The order is deliberate. Each level is worth less without the one before,
 * and the last two are the ones everybody skips: proving a restore actually
 * works, and making sure one person being unavailable is not the end of it.
 * Putting them on a ladder is the only honest way found to make the boring
 * half feel like progress instead of nagging.
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

export async function levelReport(): Promise<LevelReport> {
  const [aCopy, offsite, drill, wardens] = await Promise.all([
    db('backups').where({ status: 'ok' }).first(),
    // A copy someone downloaded and keeps on their own machine is off this
    // server just as much as one sent to Drive. Counting only the automatic
    // kind would have made this level's own advice a lie.
    db('backups')
      .where({ status: 'ok' })
      .where((qb) => qb.whereNotNull('offsite_at').orWhereNotNull('downloaded_at'))
      .first(),
    lastPassedDrill(),
    // A warden is someone given the right explicitly. People who have it
    // because they are an administrator are not a second pair of hands: they
    // are usually the same person wearing another hat.
    db('accounts').where({ can_manage_backups: true }).whereNull('disabled_at').select('warden_briefed_at', 'backups_seen_at'),
  ]);

  const briefedWarden = wardens.find((w: { warden_briefed_at: Date | null }) => !!w.warden_briefed_at);
  const arrivedWarden = wardens.find((w: { backups_seen_at: Date | null }) => !!w.backups_seen_at);

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
    {
      level: 4,
      title: 'Someone else has been asked',
      meaning: 'A second person is able to get the records back, and knows they have been asked.',
      reached: !!briefedWarden,
      next: 'Choose a second data warden, and send them what it means.',
    },
    {
      level: 5,
      title: 'Someone else has turned up',
      meaning: 'That second person has actually been here, so they could really step in.',
      reached: !!arrivedWarden,
      next: 'Ask your data warden to sign in and open this screen once, so you both know it works.',
    },
  ];

  // Levels are earned in order: reaching five while three is missing would
  // say the records are safe when the one thing nobody ever checks is still
  // unchecked.
  let current = 0;
  for (const l of levels) {
    if (!l.reached) break;
    current = l.level;
  }

  const headline =
    current === 0
      ? 'No copies yet. The first one takes under a minute.'
      : current === 5
        ? 'Everything is in place. Copies are made, kept elsewhere, proved to work, and someone else can get them back.'
        : `Level ${current} of 5. ${levels[current]?.next ?? ''}`;

  return { current, total: 5, levels, headline };
}
