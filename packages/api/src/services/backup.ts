import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { db } from '../config/database';
import { env } from '../config/env';
import { getBackupConfig, getStorageConfig } from '../config/settings';

/**
 * Copies of this installation, taken on a timer and kept without anyone
 * having to set them up.
 *
 * A copy is the database and the uploaded documents together, in one file.
 * Restoring one without the other leaves records pointing at documents that
 * are not there, so they are never separable.
 *
 * Everything sophisticated here stays here. The screen offers "every day"
 * and "keep for 30 days"; the thinning of older copies, the checking of each
 * one against the live database, and the naming are all worked out from
 * those two answers and never named in the interface.
 */

export type BackupFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';

/** Tables counted to prove a copy holds what the live database holds. */
const CENSUS_TABLES = ['accounts', 'care_profiles', 'medications', 'care_log_entries', 'documents'] as const;

export interface BackupRow {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  status: 'running' | 'ok' | 'failed';
  kind: 'scheduled' | 'manual';
  tier: string | null;
  file_url: string | null;
  filename: string | null;
  size_bytes: string | number | null;
  checksum: string | null;
  source_rows: number | null;
  verified_rows: number | null;
  verified_at: Date | null;
  error: string | null;
  offsite_at?: Date | null;
  offsite_ref?: string | null;
  offsite_error?: string | null;
}

/** Run a command to completion, capturing stderr for the failure sentence. */
function run(
  command: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; stdoutTo?: string } = {}
): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: { ...process.env, ...opts.env } });
    let stderr = '';
    child.stderr.on('data', (d) => {
      // Keep only the tail; a failing dump can be very chatty.
      stderr = (stderr + String(d)).slice(-4000);
    });
    if (opts.stdoutTo) {
      const out = fs.createWriteStream(opts.stdoutTo);
      child.stdout.pipe(out);
      out.on('close', () => resolve({ ok: child.exitCode === 0, stderr }));
      child.on('error', (err) => resolve({ ok: false, stderr: err.message }));
      child.on('close', (code) => {
        if (code !== 0) resolve({ ok: false, stderr });
      });
      return;
    }
    child.stdout.resume();
    child.on('error', (err) => resolve({ ok: false, stderr: err.message }));
    child.on('close', (code) => resolve({ ok: code === 0, stderr }));
  });
}

/**
 * The database connection as pg_dump wants it. Passing the URL straight
 * through keeps this identical to what the app itself connects with, so a
 * copy can never silently come from a different database.
 */
function dbUrl(): string {
  return env.DATABASE_URL;
}

/** Rows in the live database, for checking a copy against afterwards. */
async function censusOf(knex: typeof db, tables: readonly string[]): Promise<number> {
  let total = 0;
  for (const table of tables) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;
    const row = await knex(table).count('* as c').first();
    total += Number((row as { c?: string | number } | undefined)?.c ?? 0);
  }
  return total;
}

function sha256Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (d) => hash.update(d));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// --- Room on the disk ------------------------------------------------------

/**
 * Copies must never crowd out the thing they are protecting. A disk filled
 * by backups takes the database down with it, which would make the safety
 * net the outage. Two limits keep that from happening, and neither is a
 * setting: copies never take more than this share of the disk, and a copy is
 * not started unless this much would still be free afterwards.
 */
const MAX_DISK_SHARE = 0.25;
const RESERVE_BYTES = 1024 * 1024 * 1024;

/** What a copy is likely to need: the last one plus room to build it. */
const FIRST_COPY_ESTIMATE = 256 * 1024 * 1024;

export interface SpaceReport {
  freeBytes: number;
  totalBytes: number;
  usedByCopies: number;
  /** What one more copy is expected to need, from recent history. */
  estimatedCopyBytes: number;
  /** Roughly how many more copies fit. Shown as a sentence, never a figure. */
  roomForMore: number;
}

async function diskOf(dir: string): Promise<{ freeBytes: number; totalBytes: number }> {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const s = await fs.promises.statfs(dir);
    return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) };
  } catch {
    // An unreadable disk must not stop a copy being attempted; the copy
    // itself will fail loudly enough if there is genuinely no room.
    return { freeBytes: Number.MAX_SAFE_INTEGER, totalBytes: Number.MAX_SAFE_INTEGER };
  }
}

export async function spaceReport(): Promise<SpaceReport> {
  const cfg = getBackupConfig();
  const { freeBytes, totalBytes } = await diskOf(cfg.path);
  const sizes = await db('backups').where({ status: 'ok' }).whereNotNull('size_bytes').select('size_bytes');
  const used = sizes.reduce((sum: number, r: { size_bytes: string | number }) => sum + Number(r.size_bytes), 0);
  const recent = sizes.slice(-5).map((r: { size_bytes: string | number }) => Number(r.size_bytes));
  const estimate = recent.length > 0 ? Math.max(...recent) : FIRST_COPY_ESTIMATE;

  // Whichever runs out first: the share of the disk copies may use, or the
  // free space that must remain for the database to keep working.
  const shareLeft = Math.max(0, totalBytes * MAX_DISK_SHARE - used);
  const diskLeft = Math.max(0, freeBytes - RESERVE_BYTES);
  const usable = Math.min(shareLeft, diskLeft);

  return {
    freeBytes,
    totalBytes,
    usedByCopies: used,
    estimatedCopyBytes: estimate,
    roomForMore: estimate > 0 ? Math.floor(usable / estimate) : 0,
  };
}

/**
 * Whether there is room to take a copy, and to check it afterwards. Checking
 * restores into a scratch database, which needs the space over again, so it
 * is judged separately: a tight disk gets an unchecked copy rather than no
 * copy and a broken database.
 */
async function roomToWork(): Promise<{ canCopy: boolean; canVerify: boolean; report: SpaceReport }> {
  const report = await spaceReport();
  // Building a copy needs the dump and the archive side by side.
  const needed = report.estimatedCopyBytes * 2;
  const canCopy = report.freeBytes - needed > RESERVE_BYTES && report.usedByCopies + report.estimatedCopyBytes <= report.totalBytes * MAX_DISK_SHARE;
  const canVerify = report.freeBytes - needed * 2 > RESERVE_BYTES;
  return { canCopy, canVerify, report };
}

/**
 * Which bucket of history a copy belongs to. Worked out from when it was
 * taken, not chosen: the first copy of a month is the monthly one, the first
 * of a week the weekly one, and so on. Pruning then keeps one per bucket.
 */
function tierFor(when: Date): string {
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, '0');
  const d = String(when.getUTCDate()).padStart(2, '0');
  const h = String(when.getUTCHours()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Every copy gets its own name. The id is part of it deliberately: two copies
 * taken in the same minute, which happens the moment anyone presses the
 * button twice or a restore takes its safety copy, must never write over each
 * other. A backup that quietly replaces a good backup is worse than no
 * backup at all.
 */
function backupFilename(when: Date, id: string): string {
  const stamp = `${when.getUTCFullYear()}${pad(when.getUTCMonth() + 1)}${pad(when.getUTCDate())}-${pad(
    when.getUTCHours()
  )}${pad(when.getUTCMinutes())}${pad(when.getUTCSeconds())}`;
  return `parecare-${stamp}-${id.slice(0, 8)}.tar.gz`;
}

/**
 * The note that travels inside every copy. Written for whoever opens the
 * file, who may never have seen this software, may be holding it because the
 * person who set it up is gone, and should not have to guess what it is or
 * who can help. It names no commands and assumes no knowledge.
 */
function readmeText(when: Date): string {
  const taken = when.toISOString().replace('T', ' ').slice(0, 16);
  return [
    'WHAT THIS IS',
    '',
    'This is a complete copy of a PareCare care record system, taken on',
    `${taken} UTC. PareCare is used to organise someone's care: their`,
    'medications, appointments, conditions, care plan and documents.',
    '',
    'It contains health information about real people. Treat it as you would',
    "treat someone's medical file. Keep it somewhere private, and do not send",
    'it to anyone who is not entitled to see it.',
    '',
    'WHAT IS INSIDE',
    '',
    '  database.dump   every record: people, medications, appointments,',
    '                  care plans, notes and who had access',
    '  uploads/        the documents that were uploaded, such as letters,',
    '                  scans and photographs',
    '',
    'The two belong together. Putting back one without the other leaves',
    'records pointing at documents that are not there.',
    '',
    'HOW TO PUT IT BACK',
    '',
    'If PareCare is still running somewhere, sign in as an administrator, go',
    'to System, then Backups, and use "Put this back". That is the whole job.',
    '',
    'If the server it came from is gone, PareCare needs to be installed again',
    'first, and then this file put back the same way. Anyone comfortable',
    'setting up a website can do it, and the instructions live with the',
    'PareCare software itself.',
    '',
    'IF YOU ARE STUCK',
    '',
    'Keep this file safe and unchanged, and find someone who looks after',
    'computers to help. Everything needed is in here. Nothing else is',
    'required, and no password is needed to open it.',
    '',
  ].join('\n');
}

/**
 * Take one copy: dump the database, gather the uploaded documents alongside
 * it, and roll the pair into a single file. Then check it, then thin out the
 * old ones. A failure at any point leaves a row saying so in a sentence.
 */
export async function runBackup(
  kind: 'scheduled' | 'manual' = 'scheduled',
  accountId: string | null = null
): Promise<BackupRow> {
  const cfg = getBackupConfig();

  // Old copies are thinned out before a new one is taken, not after. Doing it
  // afterwards means the moment of peak disk use is while the disk is at its
  // fullest, which is exactly when it would overflow.
  await pruneBackups().catch((err) => console.warn('Backup thinning failed:', (err as Error).message));

  const when = new Date();
  const [row] = await db('backups')
    .insert({ started_at: when, status: 'running', kind, tier: tierFor(when), created_by_account_id: accountId })
    .returning('*');

  const work = path.join(cfg.path, `.work-${row.id}`);
  const filename = backupFilename(when, row.id);
  const finalPath = path.join(cfg.path, filename);

  const fail = async (message: string): Promise<BackupRow> => {
    await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
    const [updated] = await db('backups')
      .where({ id: row.id })
      .update({ status: 'failed', finished_at: db.fn.now(), error: message.slice(0, 2000) })
      .returning('*');
    console.warn(`Backup ${row.id} failed: ${message}`);
    return updated as BackupRow;
  };

  try {
    await fs.promises.mkdir(work, { recursive: true });
    await fs.promises.mkdir(cfg.path, { recursive: true });

    // Never fill the disk. A copy that takes the database down with it is
    // worse than a copy that was not taken, because the first one breaks
    // care that is happening right now.
    const room = await roomToWork();
    if (!room.canCopy) {
      return fail(
        'There is not enough room left on this server to make a copy. Older copies have already been cleared out. Free some space, or ask whoever runs this server to.'
      );
    }

    const sourceRows = await censusOf(db, CENSUS_TABLES);

    // The database, in the portable custom format so it can be restored into
    // a fresh server of the same major version.
    const dumpFile = path.join(work, 'database.dump');
    const dump = await run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', dumpFile, dbUrl()]);
    if (!dump.ok) {
      return fail(
        `The database could not be copied. ${dump.stderr.trim().split('\n').pop() ?? 'The copying tool did not finish.'}`
      );
    }

    // Whoever ends up holding this file may not be the person who made it,
    // and may be holding it because the server it came from is gone. A plain
    // note travels with it so it is never an anonymous archive nobody can
    // act on.
    await fs.promises.writeFile(path.join(work, 'READ ME FIRST.txt'), readmeText(when), 'utf8');

    // The uploaded documents, when they live on this server. An installation
    // storing them in the cloud already has them somewhere else.
    const storage = getStorageConfig();
    const uploadsDir = storage.provider === 'local' ? storage.localPath : null;
    const args = ['-czf', finalPath, '-C', work, 'database.dump', 'READ ME FIRST.txt'];
    if (uploadsDir && fs.existsSync(uploadsDir)) {
      args.push('-C', path.dirname(uploadsDir), path.basename(uploadsDir));
    }
    const tar = await run('tar', args);
    if (!tar.ok) {
      return fail(`The copy could not be packaged up. ${tar.stderr.trim().split('\n').pop() ?? ''}`.trim());
    }

    const stat = await fs.promises.stat(finalPath);
    const checksum = await sha256Of(finalPath);
    await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});

    await db('backups').where({ id: row.id }).update({
      status: 'ok',
      finished_at: db.fn.now(),
      file_url: finalPath,
      filename,
      size_bytes: stat.size,
      checksum,
      source_rows: sourceRows,
    });

    // Checked straight away, so the screen can say "checked and working"
    // rather than hoping. A copy that cannot be read is worse than none,
    // because it is believed. Checking restores into a scratch database, so
    // on a tight disk it is skipped: the copy is then honestly described as
    // unchecked rather than risking the database to prove it.
    // The only thing that survives losing this server is a copy that is not
    // on it. Sent after the copy is safely written, so a Drive outage never
    // costs the local copy.
    const { driveConnected, sendCopyOffsite } = await import('./backupDrive');
    if (driveConnected()) {
      const sent = await sendCopyOffsite(row.id).catch((err) => ({ ok: false, message: (err as Error).message }));
      if (!sent.ok) {
        await db('backups').where({ id: row.id }).update({ offsite_error: sent.message.slice(0, 500) });
      }
    }

    if (room.canVerify) {
      await verifyBackup(row.id).catch((err) => console.warn('Backup check failed:', (err as Error).message));
    } else {
      await db('backups')
        .where({ id: row.id })
        .update({ error: 'Saved, but not checked: there was not enough room on this server to read it back.' });
    }

    const [done] = await db('backups').where({ id: row.id }).select('*');
    return done as BackupRow;
  } catch (err) {
    return fail(`Something went wrong while copying. ${(err as Error).message}`);
  }
}

/**
 * Read a copy back and count what is inside it, against what the live
 * database held when it was taken. This is the difference between having
 * backups and believing you do.
 *
 * The copy is restored into a scratch database that is always dropped again,
 * so nothing live is touched at any point.
 */
export async function verifyBackup(backupId: string): Promise<boolean> {
  const backup = await db('backups').where({ id: backupId }).first();
  if (!backup?.file_url) return false;

  // Damage in place is caught before anything heavier runs.
  if (backup.checksum) {
    const now = await sha256Of(backup.file_url).catch(() => null);
    if (now !== backup.checksum) {
      await db('backups')
        .where({ id: backupId })
        .update({ verified_at: null, verified_rows: null, error: 'This copy has changed since it was made and may be damaged.' });
      return false;
    }
  }

  const cfg = getBackupConfig();
  const work = path.join(cfg.path, `.check-${backupId}`);
  const scratch = `parecare_check_${backupId.replace(/-/g, '').slice(0, 16)}`;
  const url = new URL(dbUrl());
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';
  const scratchUrl = new URL(url.toString());
  scratchUrl.pathname = `/${scratch}`;

  const dropScratch = () =>
    run('psql', ['--quiet', '--no-psqlrc', '-c', `DROP DATABASE IF EXISTS "${scratch}"`, adminUrl.toString()]);

  try {
    await fs.promises.mkdir(work, { recursive: true });
    const untar = await run('tar', ['-xzf', backup.file_url, '-C', work, 'database.dump']);
    if (!untar.ok) return false;

    await dropScratch();
    const create = await run('psql', ['--quiet', '--no-psqlrc', '-c', `CREATE DATABASE "${scratch}"`, adminUrl.toString()]);
    if (!create.ok) return false;

    const restore = await run('pg_restore', [
      '--no-owner',
      '--no-acl',
      '--dbname',
      scratchUrl.toString(),
      path.join(work, 'database.dump'),
    ]);
    if (!restore.ok) return false;

    const scratchDb = (await import('knex')).default({ client: 'pg', connection: scratchUrl.toString() });
    let verified = 0;
    try {
      verified = await censusOf(scratchDb as unknown as typeof db, CENSUS_TABLES);
    } finally {
      await scratchDb.destroy();
    }

    const ok = verified === backup.source_rows;
    await db('backups')
      .where({ id: backupId })
      .update({
        verified_rows: verified,
        verified_at: ok ? db.fn.now() : null,
        error: ok ? null : 'This copy did not hold everything the live records held when it was made.',
      });
    return ok;
  } finally {
    await dropScratch().catch(() => {});
    await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Thin out old copies. The person chose a number of days; this keeps every
 * copy from the last day, one a day for the last week, one a week beyond
 * that, and one a month at the far end, up to the limit they set. Copies
 * someone took by hand are never removed.
 */
export async function pruneBackups(): Promise<number> {
  const cfg = getBackupConfig();
  const now = Date.now();
  const cutoff = now - cfg.keepDays * 86400_000;
  const rows: BackupRow[] = await db('backups')
    .where({ status: 'ok', kind: 'scheduled' })
    .orderBy('started_at', 'desc');

  const keep = new Set<string>();
  const seen = new Set<string>();
  const bucketOf = (d: Date, age: number): string => {
    const y = d.getUTCFullYear();
    const m = pad(d.getUTCMonth() + 1);
    const day = pad(d.getUTCDate());
    if (age < 86400_000) return `h:${y}${m}${day}:${pad(d.getUTCHours())}`;
    if (age < 7 * 86400_000) return `d:${y}${m}${day}`;
    if (age < 31 * 86400_000) {
      const week = Math.floor(d.getTime() / (7 * 86400_000));
      return `w:${week}`;
    }
    return `m:${y}${m}`;
  };

  for (const row of rows) {
    const at = new Date(row.started_at);
    if (at.getTime() < cutoff) continue;
    const bucket = bucketOf(at, now - at.getTime());
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    keep.add(row.id);
  }

  let removed = 0;
  for (const row of rows) {
    if (keep.has(row.id)) continue;
    if (row.file_url) await fs.promises.rm(row.file_url, { force: true }).catch(() => {});
    // Thinned out in both places, so what is here and what is in Drive stay
    // the same set rather than drifting apart over months.
    if (row.offsite_ref) {
      const { removeCopyOffsite } = await import('./backupDrive');
      await removeCopyOffsite(row.offsite_ref).catch(() => {});
    }
    await db('backups').where({ id: row.id }).del();
    removed += 1;
  }
  return removed;
}

/** The most recent copy that worked, for the reassurance line at the top. */
export async function lastGoodBackup(): Promise<BackupRow | undefined> {
  return db('backups').where({ status: 'ok' }).orderBy('started_at', 'desc').first();
}

// --- Putting a copy back ---------------------------------------------------

let restoring = false;

/** True while records are being put back, so the app can say so and wait. */
export function isRestoring(): boolean {
  return restoring;
}

/**
 * Put everything back as it was in a chosen copy: the records and the
 * documents together.
 *
 * A copy of how things are right now is taken first and always. Someone who
 * restores the wrong date, or realises halfway through that they meant a
 * different one, has to be able to get back, so this is never a one-way
 * door.
 *
 * While it runs the app answers everything with "putting your records back",
 * because serving half-restored data would be worse than serving none.
 */
export async function restoreBackup(
  backupId: string,
  accountId: string | null
): Promise<{ ok: boolean; message: string }> {
  const backup = await db('backups').where({ id: backupId }).first();
  if (!backup?.file_url || !fs.existsSync(backup.file_url)) {
    return { ok: false, message: 'That copy is no longer here, so nothing was changed.' };
  }

  // Nothing is touched until there is a way back.
  const safety = await runBackup('manual', accountId);
  if (safety.status !== 'ok') {
    return {
      ok: false,
      message: 'Stopped before changing anything, because a copy of how things are now could not be made first.',
    };
  }

  const cfg = getBackupConfig();
  const work = path.join(cfg.path, `.restore-${backupId}`);
  const storage = getStorageConfig();
  const uploadsDir = storage.provider === 'local' ? storage.localPath : null;
  const parked = uploadsDir ? `${uploadsDir}.replaced-${Date.now()}` : null;

  restoring = true;
  try {
    await fs.promises.mkdir(work, { recursive: true });
    const untar = await run('tar', ['-xzf', backup.file_url, '-C', work]);
    if (!untar.ok) {
      return { ok: false, message: 'That copy could not be opened, so nothing was changed.' };
    }

    const restore = await run('pg_restore', [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      '--dbname',
      dbUrl(),
      path.join(work, 'database.dump'),
    ]);
    if (!restore.ok) {
      return {
        ok: false,
        message: `The records could not be put back. Nothing was lost: the copy made just before this is still here. ${
          restore.stderr.trim().split('\n').pop() ?? ''
        }`.trim(),
      };
    }

    // Documents come back as a set. The ones that are there now are moved
    // aside rather than deleted, so a wrong restore is still recoverable.
    const fromCopy = uploadsDir ? path.join(work, path.basename(uploadsDir)) : null;
    if (uploadsDir && fromCopy && fs.existsSync(fromCopy)) {
      if (fs.existsSync(uploadsDir) && parked) await fs.promises.rename(uploadsDir, parked).catch(() => {});
      await fs.promises.rename(fromCopy, uploadsDir);
    }

    // pg_restore reports success even when individual objects failed, so the
    // records are counted rather than assumed. Saying a restore worked when
    // it did not would leave someone believing they had their data back.
    const landed = await censusOf(db, CENSUS_TABLES);
    if (backup.source_rows != null && landed !== backup.source_rows) {
      return {
        ok: false,
        message:
          'The copy was opened but not everything came back. Nothing else was changed, and the copy made just before this is still here.',
      };
    }

    return {
      ok: true,
      message: `Everything has been put back as it was on ${new Date(backup.started_at).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}. Sign in again to see it.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Something went wrong putting the copy back. The copy made just before this is still here. ${
        (err as Error).message
      }`,
    };
  } finally {
    restoring = false;
    await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// --- The timer -------------------------------------------------------------

const FREQUENCY_MS: Record<BackupFrequency, number> = {
  hourly: 3600_000,
  daily: 86400_000,
  weekly: 7 * 86400_000,
  monthly: 30 * 86400_000,
};

// How often to look, not how often to copy. Whether a copy is due is decided
// from when the last good one was taken, so a restart never skips one and a
// changed setting takes effect on the next look.
const CHECK_EVERY_MS = 5 * 60_000;

let timer: NodeJS.Timeout | null = null;
let warnedAt = 0;

/**
 * Tell the super admin when copies have stopped working. A backup that fails
 * quietly is worse than none at all, because it is trusted. Sent at most
 * once a day so a broken server does not also become a broken inbox.
 */
async function warnSuperAdmin(message: string): Promise<void> {
  if (Date.now() - warnedAt < 86400_000) return;
  warnedAt = Date.now();
  const admin = await db('accounts').where({ role: 'super_admin' }).orderBy('created_at', 'asc').first();
  if (!admin?.email) return;
  const { sendNotificationEmail } = await import('./email');
  await sendNotificationEmail(admin.email, 'PareCare backups need attention', [
    { text: message, url: `${env.APP_URL}/system/backups` },
  ]).catch((err) => console.warn('Backup warning email failed:', (err as Error).message));
}

async function tick(): Promise<void> {
  const cfg = getBackupConfig();
  if (!cfg.enabled) return;
  const last = await lastGoodBackup();
  const interval = FREQUENCY_MS[cfg.frequency] ?? FREQUENCY_MS.daily;
  const since = last ? Date.now() - new Date(last.started_at).getTime() : Infinity;
  if (since < interval) return;

  const result = await runBackup('scheduled');
  if (result.status === 'failed') {
    await warnSuperAdmin(result.error ?? 'The last backup did not work.');
    return;
  }
  // A copy that ran but could not be read back is still a problem worth
  // saying out loud.
  if (!result.verified_at) {
    await warnSuperAdmin('The last backup was made but could not be checked. It may not be usable.');
    return;
  }
  const { driveConnected } = await import('./backupDrive');
  if (driveConnected() && !result.offsite_at) {
    await warnSuperAdmin(
      'The last backup was made here but could not be sent to Google Drive, so it would not survive this server being lost.'
    );
  }
}

function scheduleNext(): void {
  timer = setTimeout(() => {
    tick()
      .catch((err) => console.error('Backup scheduler error:', err))
      .finally(() => scheduleNext());
  }, CHECK_EVERY_MS);
  timer.unref();
}

export function rearmBackupScheduler(): void {
  if (timer) clearTimeout(timer);
  scheduleNext();
}

/**
 * Backups run from install: no setup, no first visit to a screen. A brand
 * new server takes its first copy within a few minutes of coming up, and
 * keeps a month of history, because someone who has not thought about
 * backups is exactly who needs them.
 */
export function startBackupScheduler(): void {
  scheduleNext();
  const cfg = getBackupConfig();
  console.log(
    cfg.enabled
      ? `Backups running (${cfg.frequency}, keeping ${cfg.keepDays} days).`
      : 'Backups are turned off for this installation.'
  );
}
