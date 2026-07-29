import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
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
 * So this deliberately destroys, and then restores, and then compares. On a
 * practice database built for the purpose and dropped whatever happens, and
 * on a practice copy of the document files, never the real ones.
 *
 * The reason it writes so much down is that "some records were destroyed, and
 * then they came back" is not something anybody can feel. Three numbers prove
 * arithmetic. What proves the thing people lie awake about is watching a
 * named medication, belonging to a named person, be there, then be gone, then
 * come back with every field identical. So the drill keeps a running
 * commentary, a count and a fingerprint for every kind of record, and a
 * handful of real records followed individually all the way through.
 *
 * A fingerprint here is a short code worked out from the contents of a
 * record. Same contents, same code; one character different anywhere and the
 * code is completely different. It is what turns "the right number came back"
 * into "the same things came back".
 */

/**
 * The kinds of record the drill destroys and follows, in the order they are
 * shown. Each one knows what it is called in plain words, what a single
 * record of it is called, and who it belongs to, so a followed record can be
 * named on screen without folding two facts into one string.
 */
interface Kind {
  table: string;
  /** Plain-language name for this kind of record. */
  kind: string;
  /** Expression naming a single record. */
  labelSql: string;
  /** Expression naming who it belongs to, or null when it belongs to nobody. */
  ownerSql: string | null;
  /** Whatever join ownerSql needs. */
  joinSql: string;
}

const OWNER_JOIN = 'left join care_profiles p on p.id = t.care_profile_id';

const KINDS: Kind[] = [
  { table: 'accounts', kind: 'People who sign in', labelSql: 't.display_name', ownerSql: 't.email', joinSql: '' },
  { table: 'care_profiles', kind: 'People and pets in care', labelSql: 't.full_name', ownerSql: null, joinSql: '' },
  {
    table: 'medications',
    kind: 'Medications',
    // A medication's name lives in the shared catalogue, not on the
    // prescription itself, so naming one takes a join.
    labelSql: 'mc.name',
    ownerSql: 'p.full_name',
    joinSql: `${OWNER_JOIN} left join medication_catalogue mc on mc.id = t.medication_catalogue_id`,
  },
  {
    table: 'care_log_entries',
    kind: 'Care notes',
    labelSql: `coalesce(nullif(t.title, ''), to_char(t.occurred_at, 'FMDD Mon YYYY'))`,
    ownerSql: 'p.full_name',
    joinSql: OWNER_JOIN,
  },
  { table: 'appointments', kind: 'Appointments', labelSql: 't.title', ownerSql: 'p.full_name', joinSql: OWNER_JOIN },
  { table: 'reminders', kind: 'Reminders', labelSql: 't.title', ownerSql: 'p.full_name', joinSql: OWNER_JOIN },
  { table: 'documents', kind: 'Documents', labelSql: 't.label', ownerSql: 'p.full_name', joinSql: OWNER_JOIN },
];

/** The document files themselves, which are not rows and are counted apart. */
const FILES_ROW = { table: 'files', kind: 'Document files' } as const;

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

export interface DrillStep {
  id: string;
  position: number;
  started_at: Date;
  finished_at: Date | null;
  seconds: string | number | null;
  title: string;
  detail: string | null;
  outcome: 'done' | 'failed';
}

export interface DrillTable {
  id: string;
  table_name: string;
  kind: string;
  rows_before: number;
  rows_after_destroy: number;
  rows_restored: number;
  fingerprint_before: string | null;
  fingerprint_after: string | null;
}

export interface DrillRecord {
  id: string;
  table_name: string;
  kind: string;
  label: string;
  owner_label: string | null;
  fingerprint_before: string | null;
  present_after_destroy: boolean;
  fingerprint_after: string | null;
}

export interface DrillEvidence {
  drill: DrillRow;
  steps: DrillStep[];
  tables: DrillTable[];
  records: DrillRecord[];
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

function listFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

/**
 * How many document files there are and what they add up to. The fingerprint
 * covers the name and the size of every one, so a file coming back empty or
 * truncated is not counted as a file coming back.
 */
function fileTally(dirs: string[]): { count: number; fingerprint: string } {
  const lines: string[] = [];
  for (const dir of dirs) {
    for (const rel of listFiles(dir)) {
      const full = path.join(dir, rel);
      const size = fs.existsSync(full) ? fs.statSync(full).size : 0;
      lines.push(`${path.basename(dir)}/${rel}:${size}`);
    }
  }
  lines.sort();
  return {
    count: lines.length,
    fingerprint: lines.length === 0 ? '' : crypto.createHash('md5').update(lines.join('\n')).digest('hex'),
  };
}

/** How many records of this kind there are, and what they add up to. */
async function tally(
  knex: Awaited<ReturnType<typeof openScratch>>,
  table: string
): Promise<{ rows: number; fingerprint: string }> {
  const result = await knex.raw(
    `select count(*)::int as row_count,
            coalesce(md5(string_agg(h, '' order by h)), '') as fingerprint
       from (select md5(t::text) as h from "${table}" t) s`
  );
  const row = (result as { rows: { row_count: number; fingerprint: string }[] }).rows[0];
  return { rows: Number(row?.row_count ?? 0), fingerprint: String(row?.fingerprint ?? '') };
}

/**
 * One real record of this kind, to follow all the way through.
 *
 * Naming a record depends on the shape of the tables, and the tables change.
 * If naming one ever stops working, that is a fault in this file and not a
 * fault in the copy, so it drops the record rather than failing the drill and
 * telling somebody their backups are broken when they are fine.
 */
async function pickRecord(
  knex: Awaited<ReturnType<typeof openScratch>>,
  spec: Kind
): Promise<{ id: string; label: string; owner: string | null; fingerprint: string } | null> {
  try {
    return await pickRecordUnguarded(knex, spec);
  } catch (err) {
    console.warn(`Drill could not name a ${spec.table} record:`, (err as Error).message);
    return null;
  }
}

async function pickRecordUnguarded(
  knex: Awaited<ReturnType<typeof openScratch>>,
  spec: Kind
): Promise<{ id: string; label: string; owner: string | null; fingerprint: string } | null> {
  const result = await knex.raw(
    `select t.id::text as id,
            md5(t::text) as fingerprint,
            ${spec.labelSql} as label,
            ${spec.ownerSql ?? 'null'} as owner
       from "${spec.table}" t ${spec.joinSql}
      order by t.id
      limit 1`
  );
  const row = (result as { rows: { id: string; fingerprint: string; label: string | null; owner: string | null }[] })
    .rows[0];
  if (!row) return null;
  return {
    id: row.id,
    label: (row.label ?? 'Untitled').slice(0, 255),
    owner: row.owner ? row.owner.slice(0, 255) : null,
    fingerprint: row.fingerprint,
  };
}

/** Whether one particular record is there, and what it now adds up to. */
async function findRecord(
  knex: Awaited<ReturnType<typeof openScratch>>,
  table: string,
  id: string
): Promise<string | null> {
  const result = await knex.raw(`select md5(t::text) as fingerprint from "${table}" t where t.id = ?`, [id]);
  const row = (result as { rows: { fingerprint: string }[] }).rows[0];
  return row ? row.fingerprint : null;
}

/**
 * The running commentary. Each step is written down as it starts and closed
 * with what it found, so a drill that dies halfway still leaves a record of
 * how far it got.
 */
class StepLog {
  private position = 0;
  private open: { id: string; startedAt: Date } | null = null;

  constructor(private readonly drillId: string) {}

  async begin(title: string): Promise<void> {
    await this.close('', 'done');
    this.position += 1;
    const startedAt = new Date();
    const [row] = await db('backup_drill_steps')
      .insert({ drill_id: this.drillId, position: this.position, title, started_at: startedAt })
      .returning('id');
    this.open = { id: (row as { id: string }).id, startedAt };
  }

  async close(detail: string, outcome: 'done' | 'failed' = 'done'): Promise<void> {
    if (!this.open) return;
    const { id, startedAt } = this.open;
    this.open = null;
    const finishedAt = new Date();
    await db('backup_drill_steps')
      .where({ id })
      .update({
        finished_at: finishedAt,
        seconds: ((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(2),
        detail: detail || null,
        outcome,
      });
  }
}

/** "4 medications" rather than "medications: 4". */
function countText(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Take a copy if there is not a recent one, then prove it can bring
 * everything back from nothing.
 */
export async function runDrill(accountId: string | null): Promise<DrillEvidence> {
  // Drill against something real. If no copy exists yet, make one, because a
  // drill on a copy that does not exist would be theatre.
  let backup = await lastGoodBackup();
  if (!backup) {
    const made = await runBackup('manual', accountId);
    if (made.status !== 'ok') {
      return bareFailure(
        accountId,
        'making a copy to practise on',
        made.error ?? 'A copy could not be made to practise with.'
      );
    }
    backup = made;
  }
  if (!backup.file_url || !fs.existsSync(backup.file_url)) {
    return bareFailure(accountId, 'finding the copy', 'The most recent copy is no longer on this server.');
  }

  const [drill] = await db('backup_drills')
    .insert({ backup_id: backup.id, status: 'running', stage: 'starting', run_by_account_id: accountId })
    .returning('*');

  // Read back only once everything, including the tidying up at the end, has
  // been written down.
  await perform(drill as DrillRow, backup as { id: string; file_url: string; started_at: Date; size_bytes: number | null });
  return evidenceFor(drill.id);
}

async function perform(
  drill: DrillRow,
  backup: { id: string; file_url: string; started_at: Date; size_bytes: number | null }
): Promise<void> {
  const cfg = getBackupConfig();
  const log = new StepLog(drill.id);
  const work = path.join(cfg.path, `.drill-${drill.id}`);
  const scratch = `parecare_drill_${drill.id.replace(/-/g, '').slice(0, 16)}`;
  const url = new URL(env.DATABASE_URL);
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';
  const scratchUrl = new URL(url.toString());
  scratchUrl.pathname = `/${scratch}`;

  const dropScratch = () =>
    run('psql', ['--quiet', '--no-psqlrc', '-c', `DROP DATABASE IF EXISTS "${scratch}"`, adminUrl.toString()]);

  const fail = async (stage: string, message: string): Promise<void> => {
    await log.close(message, 'failed');
    await db('backup_drills')
      .where({ id: drill.id })
      .update({ status: 'failed', stage, finished_at: db.fn.now(), error: message.slice(0, 2000) });
  };

  let scratchDb: Awaited<ReturnType<typeof openScratch>> | null = null;
  try {
    await fs.promises.mkdir(work, { recursive: true });

    // 1. Unpack the copy, exactly as someone would in a real emergency.
    await db('backup_drills').where({ id: drill.id }).update({ stage: 'opening the copy' });
    await log.begin('Opened the copy');
    const untar = await run('tar', ['-xzf', backup.file_url, '-C', work]);
    if (!untar.ok) return fail('opening the copy', 'The copy could not be opened.');
    // Only what was in the uploads folder counts as a document. The database
    // file and the note that travels with every copy are not.
    const uploadDirs = () =>
      fs
        .readdirSync(work, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(work, e.name));
    const filesBefore = fileTally(uploadDirs());
    const madeAt = new Date(backup.started_at).toLocaleString();
    const sizeMb = backup.size_bytes ? (Number(backup.size_bytes) / (1024 * 1024)).toFixed(1) : '?';
    await log.close(
      `The copy made on ${madeAt}, ${sizeMb} MB. It opened without complaint and had ${countText(filesBefore.count, 'document file')} inside it.`
    );

    // 2. Build a practice database and put the copy into it.
    await db('backup_drills').where({ id: drill.id }).update({ stage: 'building a practice copy' });
    await log.begin('Built a separate practice area');
    await dropScratch();
    const create = await run('psql', ['--quiet', '--no-psqlrc', '-c', `CREATE DATABASE "${scratch}"`, adminUrl.toString()]);
    if (!create.ok) return fail('building a practice copy', 'A practice database could not be created.');
    await log.close('Empty, separate, and thrown away at the end. Nothing from here on touches your real records.');

    await log.begin('Loaded the copy into the practice area');
    const restoreFirst = await run('pg_restore', [
      '--no-owner', '--no-acl', '--dbname', scratchUrl.toString(), path.join(work, 'database.dump'),
    ]);
    if (!restoreFirst.ok) return fail('building a practice copy', 'The copy could not be read into the practice database.');

    scratchDb = await openScratch(scratchUrl.toString());

    // 3. Count and fingerprint everything, kind by kind, and pick out real
    //    records to follow. This is the "before" everything else is measured
    //    against.
    const present: Kind[] = [];
    for (const spec of KINDS) {
      if (await scratchDb.schema.hasTable(spec.table)) present.push(spec);
    }
    const before = new Map<string, { rows: number; fingerprint: string }>();
    for (const spec of present) {
      before.set(spec.table, await tally(scratchDb, spec.table));
    }
    const rowsBefore = [...before.values()].reduce((n, t) => n + t.rows, 0);
    if (rowsBefore === 0) {
      return fail('building a practice copy', 'The copy appears to hold no records at all.');
    }
    for (const spec of present) {
      const t = before.get(spec.table)!;
      await db('backup_drill_tables').insert({
        drill_id: drill.id,
        table_name: spec.table,
        kind: spec.kind,
        rows_before: t.rows,
        fingerprint_before: t.fingerprint,
      });
    }
    await db('backup_drill_tables').insert({
      drill_id: drill.id,
      table_name: FILES_ROW.table,
      kind: FILES_ROW.kind,
      rows_before: filesBefore.count,
      fingerprint_before: filesBefore.fingerprint || null,
    });
    await log.close(
      `${countText(rowsBefore, 'record')} across ${countText(present.length, 'kind', 'kinds')} of record, plus ${countText(filesBefore.count, 'document file')}.`
    );

    await log.begin('Chose real records to follow');
    const followed: { spec: Kind; id: string; label: string; owner: string | null; fingerprint: string }[] = [];
    for (const spec of present) {
      const picked = await pickRecord(scratchDb, spec);
      if (picked) followed.push({ spec, ...picked });
    }
    for (const f of followed) {
      await db('backup_drill_records').insert({
        drill_id: drill.id,
        table_name: f.spec.table,
        kind: f.spec.kind,
        label: f.label,
        owner_label: f.owner,
        fingerprint_before: f.fingerprint,
      });
    }
    await log.close(
      followed.length === 0
        ? 'There were no records to follow.'
        : `${followed.map((f) => f.label).join(', ')}. Each one is watched through being destroyed and coming back.`
    );

    // 4. Destroy it. This is the part that makes the drill worth doing.
    await db('backup_drills').where({ id: drill.id }).update({ stage: 'destroying the practice records' });
    await log.begin('Destroyed everything in the practice area');
    for (const spec of present) {
      await scratchDb.raw(`TRUNCATE TABLE "${spec.table}" CASCADE`);
    }
    for (const dir of uploadDirs()) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
    const afterDestroy = new Map<string, number>();
    for (const spec of present) {
      const t = await tally(scratchDb, spec.table);
      afterDestroy.set(spec.table, t.rows);
      await db('backup_drill_tables')
        .where({ drill_id: drill.id, table_name: spec.table })
        .update({ rows_after_destroy: t.rows });
    }
    const filesAfterDestroy = fileTally(uploadDirs());
    await db('backup_drill_tables')
      .where({ drill_id: drill.id, table_name: FILES_ROW.table })
      .update({ rows_after_destroy: filesAfterDestroy.count });
    const leftOver = [...afterDestroy.values()].reduce((n, c) => n + c, 0) + filesAfterDestroy.count;
    if (leftOver !== 0) {
      return fail('destroying the practice records', 'The practice records could not be cleared, so nothing was proved.');
    }
    await db('backup_drills').where({ id: drill.id }).update({ rows_before: rowsBefore, rows_after_destroy: 0, files_before: filesBefore.count });
    await log.close(
      `Every record and every document file deleted. Counted again afterwards: nothing left, in any of them. This is the part that matters, and it really happened.`
    );

    // The followed records, checked individually rather than in aggregate.
    await log.begin('Checked the followed records were really gone');
    let stillThere = 0;
    for (const f of followed) {
      const found = await findRecord(scratchDb, f.spec.table, f.id);
      if (found) stillThere += 1;
      await db('backup_drill_records')
        .where({ drill_id: drill.id, table_name: f.spec.table })
        .update({ present_after_destroy: !!found });
    }
    if (stillThere > 0) {
      return fail('destroying the practice records', `${stillThere} of the followed records survived being destroyed, so nothing was proved.`);
    }
    await log.close(
      followed.length === 0 ? 'There were none to check.' : `Looked for each one by name. All ${followed.length} gone.`
    );

    // 5. Put it back, the same way a real restore does: onto a database that
    //    already exists and has to be cleared as it goes.
    await db('backup_drills').where({ id: drill.id }).update({ stage: 'putting everything back' });
    await log.begin('Put the copy back');
    await scratchDb.destroy();
    scratchDb = null;
    const restoreAgain = await run('pg_restore', [
      '--clean', '--if-exists', '--no-owner', '--no-acl',
      '--dbname', scratchUrl.toString(), path.join(work, 'database.dump'),
    ]);
    if (!restoreAgain.ok) {
      return fail('putting everything back', 'The records could not be put back after being destroyed.');
    }
    const untarAgain = await run('tar', ['-xzf', backup.file_url, '-C', work]);
    if (!untarAgain.ok) {
      return fail('putting everything back', 'The document files could not be put back after being destroyed.');
    }
    await log.close('From the same copy, onto the practice area that already existed, exactly as a real emergency would.');

    // 6. Count what came back, and compare it with what was there.
    await log.begin('Counted and compared what came back');
    scratchDb = await openScratch(scratchUrl.toString());
    let rowsRestored = 0;
    let mismatched = 0;
    for (const spec of present) {
      const t = await tally(scratchDb, spec.table);
      rowsRestored += t.rows;
      const was = before.get(spec.table)!;
      if (t.rows !== was.rows || t.fingerprint !== was.fingerprint) mismatched += 1;
      await db('backup_drill_tables')
        .where({ drill_id: drill.id, table_name: spec.table })
        .update({ rows_restored: t.rows, fingerprint_after: t.fingerprint });
    }
    const filesAfter = fileTally(uploadDirs());
    if (filesAfter.count !== filesBefore.count || filesAfter.fingerprint !== filesBefore.fingerprint) mismatched += 1;
    await db('backup_drill_tables')
      .where({ drill_id: drill.id, table_name: FILES_ROW.table })
      .update({ rows_restored: filesAfter.count, fingerprint_after: filesAfter.fingerprint || null });
    await log.close(
      `${countText(rowsRestored, 'record')} and ${countText(filesAfter.count, 'document file')} back. ` +
        (mismatched === 0
          ? 'Every kind of record matches what was there before, contents and all.'
          : `${countText(mismatched, 'kind', 'kinds')} of record did not come back the same.`)
    );

    await log.begin('Compared the followed records word for word');
    let changed = 0;
    for (const f of followed) {
      const found = await findRecord(scratchDb, f.spec.table, f.id);
      if (found !== f.fingerprint) changed += 1;
      await db('backup_drill_records')
        .where({ drill_id: drill.id, table_name: f.spec.table })
        .update({ fingerprint_after: found });
    }
    await log.close(
      followed.length === 0
        ? 'There were none to compare.'
        : changed === 0
          ? `All ${followed.length} back, and every field of every one is identical to before.`
          : `${changed} of ${followed.length} came back changed.`
    );

    await scratchDb.destroy();
    scratchDb = null;

    const passed = rowsRestored === rowsBefore && mismatched === 0 && changed === 0;
    await db('backup_drills')
      .where({ id: drill.id })
      .update({
        status: passed ? 'passed' : 'failed',
        stage: 'finished',
        finished_at: db.fn.now(),
        rows_restored: rowsRestored,
        files_restored: filesAfter.count,
        error: passed
          ? null
          : rowsRestored !== rowsBefore
            ? `Only ${rowsRestored} of ${rowsBefore} records came back. The copy is not complete.`
            : 'Everything came back, but some of it came back changed. The copy is not trustworthy.',
      });
  } catch (err) {
    await fail('finished', `Something went wrong during the drill. ${(err as Error).message}`);
  } finally {
    if (scratchDb) await scratchDb.destroy().catch(() => {});
    await dropScratch().catch(() => {});
    await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
    // Recorded last, because "and then we cleared it all away" is part of
    // what makes this safe to run whenever anybody wants reassurance.
    await log.begin('Threw the practice area away').catch(() => {});
    await log.close('The practice database and the practice files are gone. Nothing was left behind.').catch(() => {});
  }
}

/** A drill that never got as far as having anything to write down. */
async function bareFailure(accountId: string | null, stage: string, message: string): Promise<DrillEvidence> {
  const [row] = await db('backup_drills')
    .insert({ status: 'failed', stage, finished_at: db.fn.now(), error: message, run_by_account_id: accountId })
    .returning('*');
  return { drill: row as DrillRow, steps: [], tables: [], records: [] };
}

async function openScratch(connection: string) {
  const knex = (await import('knex')).default;
  return knex({ client: 'pg', connection });
}

/** Everything written down about one drill, ready for the screen. */
export async function evidenceFor(drillId: string): Promise<DrillEvidence> {
  const [drill, steps, tables, records] = await Promise.all([
    db('backup_drills').where({ id: drillId }).first(),
    db('backup_drill_steps').where({ drill_id: drillId }).orderBy('position', 'asc'),
    db('backup_drill_tables').where({ drill_id: drillId }).orderBy('kind', 'asc'),
    db('backup_drill_records').where({ drill_id: drillId }).orderBy('kind', 'asc'),
  ]);
  return { drill: drill as DrillRow, steps, tables, records };
}

export async function lastDrill(): Promise<DrillRow | undefined> {
  return db('backup_drills').orderBy('started_at', 'desc').first();
}

export async function lastDrillEvidence(): Promise<DrillEvidence | null> {
  const drill = await lastDrill();
  return drill ? evidenceFor(drill.id) : null;
}

export async function lastPassedDrill(): Promise<DrillRow | undefined> {
  return db('backup_drills').where({ status: 'passed' }).orderBy('started_at', 'desc').first();
}
