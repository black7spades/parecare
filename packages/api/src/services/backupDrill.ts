import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { db } from '../config/database';
import { env } from '../config/env';
import { getBackupConfig } from '../config/settings';
import { runBackup, lastGoodBackup } from './backup';

/**
 * The fire drill.
 *
 * Every other check reads a copy back into an empty scratch database. That
 * proves the copy can be opened. It does not prove the thing anyone actually
 * cares about, which is whether records can be got back after they have been
 * destroyed, onto a database that already has the wrong things in it. That is
 * a different path through Postgres and a different set of ways to fail.
 *
 * So this deliberately destroys, and then restores, and then counts. On a
 * scratch database built for the purpose, dropped whatever happens, never
 * the live one. That is what makes it safe to run whenever someone wants
 * reassurance rather than once, nervously, at the beginning.
 *
 * The middle number is the point. A drill that reports rows going from 4,000
 * to 0 to 4,000 has proved something. A drill that never reached 0 has
 * proved nothing, and says so.
 */

const CENSUS_TABLES = ['accounts', 'care_profiles', 'medications', 'care_log_entries', 'documents'] as const;

export interface DrillRow {
  id: string;
  backup_id: string | null;
  started_at: Date;
  finished_at: Date | null;
  status: 'running' | 'passed' | 'failed';
  stage: string | null;
  rows_before: number | null;
  rows_after_destroy: number | null;
  rows_restored: number | null;
  files_before: number | null;
  files_restored: number | null;
  error: string | null;
}

function run(command: string, args: string[]): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr = (stderr + String(d)).slice(-4000);
    });
    child.stdout.resume();
    child.on('error', (err) => resolve({ ok: false, stderr: err.message }));
    child.on('close', (code) => resolve({ ok: code === 0, stderr }));
  });
}

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(path.join(dir, entry.name));
    else total += 1;
  }
  return total;
}

/**
 * Take a copy if there is not a recent one, then prove it can bring
 * everything back from nothing.
 */
export async function runDrill(accountId: string | null): Promise<DrillRow> {
  const cfg = getBackupConfig();

  // Drill against something real. If no copy exists yet, make one, because a
  // drill on a copy that does not exist would be theatre.
  let backup = await lastGoodBackup();
  if (!backup) {
    const made = await runBackup('manual', accountId);
    if (made.status !== 'ok') {
      const [row] = await db('backup_drills')
        .insert({
          status: 'failed',
          stage: 'making a copy to practise on',
          finished_at: db.fn.now(),
          error: made.error ?? 'A copy could not be made to practise with.',
          run_by_account_id: accountId,
        })
        .returning('*');
      return row as DrillRow;
    }
    backup = made;
  }
  if (!backup.file_url || !fs.existsSync(backup.file_url)) {
    const [row] = await db('backup_drills')
      .insert({
        status: 'failed',
        stage: 'finding the copy',
        finished_at: db.fn.now(),
        error: 'The most recent copy is no longer on this server.',
        run_by_account_id: accountId,
      })
      .returning('*');
    return row as DrillRow;
  }

  const [drill] = await db('backup_drills')
    .insert({ backup_id: backup.id, status: 'running', stage: 'starting', run_by_account_id: accountId })
    .returning('*');

  const work = path.join(cfg.path, `.drill-${drill.id}`);
  const scratch = `parecare_drill_${drill.id.replace(/-/g, '').slice(0, 16)}`;
  const url = new URL(env.DATABASE_URL);
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';
  const scratchUrl = new URL(url.toString());
  scratchUrl.pathname = `/${scratch}`;

  const dropScratch = () =>
    run('psql', ['--quiet', '--no-psqlrc', '-c', `DROP DATABASE IF EXISTS "${scratch}"`, adminUrl.toString()]);

  const fail = async (stage: string, message: string): Promise<DrillRow> => {
    const [row] = await db('backup_drills')
      .where({ id: drill.id })
      .update({ status: 'failed', stage, finished_at: db.fn.now(), error: message.slice(0, 2000) })
      .returning('*');
    return row as DrillRow;
  };

  let scratchDb: Awaited<ReturnType<typeof openScratch>> | null = null;
  try {
    await fs.promises.mkdir(work, { recursive: true });

    // 1. Unpack the copy, exactly as someone would in a real emergency.
    await db('backup_drills').where({ id: drill.id }).update({ stage: 'opening the copy' });
    const untar = await run('tar', ['-xzf', backup.file_url, '-C', work]);
    if (!untar.ok) return fail('opening the copy', 'The copy could not be opened.');
    // Only what was in the uploads folder counts as a document. The database
    // file and the note that travels with every copy are not.
    const uploadsInCopy = fs
      .readdirSync(work, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(work, e.name));
    const filesInCopy = uploadsInCopy.reduce((n, dir) => n + countFiles(dir), 0);

    // 2. Build a practice database and put the copy into it.
    await db('backup_drills').where({ id: drill.id }).update({ stage: 'building a practice copy' });
    await dropScratch();
    const create = await run('psql', ['--quiet', '--no-psqlrc', '-c', `CREATE DATABASE "${scratch}"`, adminUrl.toString()]);
    if (!create.ok) return fail('building a practice copy', 'A practice database could not be created.');

    const restoreFirst = await run('pg_restore', [
      '--no-owner', '--no-acl', '--dbname', scratchUrl.toString(), path.join(work, 'database.dump'),
    ]);
    if (!restoreFirst.ok) return fail('building a practice copy', 'The copy could not be read into the practice database.');

    scratchDb = await openScratch(scratchUrl.toString());
    const before = await census(scratchDb);
    if (before === 0) {
      return fail('building a practice copy', 'The copy appears to hold no records at all.');
    }
    await db('backup_drills').where({ id: drill.id }).update({ rows_before: before, files_before: filesInCopy });

    // 3. Destroy it. This is the part that makes the drill worth doing.
    await db('backup_drills').where({ id: drill.id }).update({ stage: 'destroying the practice records' });
    for (const table of CENSUS_TABLES) {
      if (await scratchDb.schema.hasTable(table)) {
        await scratchDb.raw(`TRUNCATE TABLE "${table}" CASCADE`);
      }
    }
    const afterDestroy = await census(scratchDb);
    if (afterDestroy !== 0) {
      return fail('destroying the practice records', 'The practice records could not be cleared, so nothing was proved.');
    }
    await db('backup_drills').where({ id: drill.id }).update({ rows_after_destroy: 0 });

    // 4. Put it back, the same way a real restore does: onto a database that
    //    already exists and has to be cleared as it goes.
    await db('backup_drills').where({ id: drill.id }).update({ stage: 'putting everything back' });
    await scratchDb.destroy();
    scratchDb = null;
    const restoreAgain = await run('pg_restore', [
      '--clean', '--if-exists', '--no-owner', '--no-acl',
      '--dbname', scratchUrl.toString(), path.join(work, 'database.dump'),
    ]);
    if (!restoreAgain.ok) {
      return fail('putting everything back', 'The records could not be put back after being destroyed.');
    }

    // 5. Count what came back, and compare.
    scratchDb = await openScratch(scratchUrl.toString());
    const restored = await census(scratchDb);
    await scratchDb.destroy();
    scratchDb = null;

    const filesBack = uploadsInCopy.reduce((n, dir) => n + countFiles(dir), 0);
    const passed = restored === before;
    const [row] = await db('backup_drills')
      .where({ id: drill.id })
      .update({
        status: passed ? 'passed' : 'failed',
        stage: 'finished',
        finished_at: db.fn.now(),
        rows_restored: restored,
        files_restored: filesBack,
        error: passed
          ? null
          : `Only ${restored} of ${before} records came back. The copy is not complete.`,
      })
      .returning('*');
    return row as DrillRow;
  } catch (err) {
    return fail('finished', `Something went wrong during the drill. ${(err as Error).message}`);
  } finally {
    if (scratchDb) await scratchDb.destroy().catch(() => {});
    await dropScratch().catch(() => {});
    await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

async function openScratch(connection: string) {
  const knex = (await import('knex')).default;
  return knex({ client: 'pg', connection });
}

async function census(knex: Awaited<ReturnType<typeof openScratch>>): Promise<number> {
  let total = 0;
  for (const table of CENSUS_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    const row = await knex(table).count('* as c').first();
    total += Number((row as { c?: string | number } | undefined)?.c ?? 0);
  }
  return total;
}

export async function lastDrill(): Promise<DrillRow | undefined> {
  return db('backup_drills').orderBy('started_at', 'desc').first();
}

export async function lastPassedDrill(): Promise<DrillRow | undefined> {
  return db('backup_drills').where({ status: 'passed' }).orderBy('started_at', 'desc').first();
}
