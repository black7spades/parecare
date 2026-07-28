import { Router } from 'express';
import * as fs from 'node:fs';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAccountRight } from '../middleware/accountRights';
import { getBackupConfig } from '../config/settings';
import { runBackup, verifyBackup, lastGoodBackup, restoreBackup, spaceReport, type BackupRow } from '../services/backup';

/**
 * The Backups screen, for the super admin. Copies are taken whether or not
 * anyone comes here; this exists to say plainly that they are working, and
 * to hand the data back when it is needed.
 *
 * A copy holds every record in the installation, so reading one is the most
 * sensitive thing this API does. Super admin only, and every download and
 * restore is written to the audit log.
 */
export const adminBackupsRouter = Router();

// Not super admin alone. If the one person who can reach this is away, has
// lost their account, or something has happened to them, the records have to
// still be recoverable by someone. The right is off by default because a copy
// holds everyone's health records, so it is given deliberately.
adminBackupsRouter.use(requireAuth, requireAccountRight('can_manage_backups'));

async function audit(accountId: string, summary: string): Promise<void> {
  await db('audit_log')
    .insert({ care_profile_id: null, actor_account_id: accountId, action: 'created', entity_type: 'backups', summary: summary.slice(0, 255) })
    .catch(() => {});
}

/**
 * One sentence a worried person can act on, describing where this
 * installation stands. Never a status code or a count of anything.
 *
 * "Protected" is earned, not assumed. Copies that have only ever existed on
 * the machine they are protecting die with that machine, so an installation
 * whose copies have never left it is told so plainly rather than reassured.
 */
type BackupState = 'protected' | 'here_only' | 'stale' | 'none' | 'off' | 'no_room';

function reassurance(
  last: BackupRow | undefined,
  enabled: boolean,
  everTakenAway: boolean,
  roomForMore: number
): { state: BackupState; message: string } {
  if (!enabled) {
    return { state: 'off', message: 'Automatic copies are turned off, so there is nothing to go back to if something goes wrong.' };
  }
  if (!last) {
    return { state: 'none', message: 'No copy has been made yet. The first one is taken within a few minutes.' };
  }
  if (roomForMore < 1) {
    return {
      state: 'no_room',
      message: 'There is no room left on this server for more copies, so new ones will stop being made. Free some space, or ask whoever runs this server to.',
    };
  }
  if (Date.now() - new Date(last.started_at).getTime() > 3 * 86400_000) {
    return { state: 'stale', message: 'Copies have not run recently, so the most recent one may be out of date.' };
  }
  if (!everTakenAway) {
    return {
      state: 'here_only',
      message:
        'Copies are being made, but they are all on this server. If this server is lost, they go with it. Download one and keep it somewhere else.',
    };
  }
  return {
    state: 'protected',
    message: last.verified_at
      ? 'Your data is protected. The last copy was checked and works, and a copy has been kept somewhere else.'
      : 'Your data is protected, and a copy has been kept somewhere else.',
  };
}

adminBackupsRouter.get('/', async (_req, res) => {
  const cfg = getBackupConfig();
  const last = await lastGoodBackup();
  const backups = await db('backups').orderBy('started_at', 'desc').limit(200);
  const space = await spaceReport();
  // A copy that was downloaded has left this server, which is the only thing
  // that makes any of this survive the server dying.
  const takenAway = await db('backups').whereNotNull('downloaded_at').first();

  // Who else could get these records back if this person could not. One name
  // is a single point of failure, and in a care setting that is not a
  // hypothetical, so the screen says so.
  // Grouped deliberately: without the brackets, AND binds tighter than OR in
  // SQL and disabled accounts would be counted as people who could help.
  const keyholders = await db('accounts')
    .where((qb) => {
      qb.where({ can_manage_backups: true }).orWhere({ role: 'super_admin' }).orWhere({ role: 'admin' });
    })
    .whereNull('disabled_at')
    .select('id', 'display_name', 'email');

  res.json({
    status: reassurance(last, cfg.enabled, !!takenAway, space.roomForMore),
    settings: { enabled: cfg.enabled, frequency: cfg.frequency, keep_days: cfg.keepDays },
    space: { room_for_more: space.roomForMore, used_by_copies: space.usedByCopies },
    keyholders,
    last_backup_at: last?.started_at ?? null,
    backups: backups.map((b: BackupRow) => ({
      ...b,
      size_bytes: b.size_bytes == null ? null : Number(b.size_bytes),
      // The path on disk is ours, not the user's business, and naming it
      // invites someone to go looking for it in a shell.
      file_url: undefined,
      stored: !!b.file_url,
    })),
  });
});

// Take one now. Copies made by hand are never thinned out automatically.
adminBackupsRouter.post('/run', async (req, res) => {
  const running = await db('backups').where({ status: 'running' }).first();
  if (running) {
    res.status(409).json({ error: 'A copy is already being made. It will appear here when it finishes.', code: 'ALREADY_RUNNING' });
    return;
  }
  await audit(req.account!.id, 'took a backup by hand');
  const backup = await runBackup('manual', req.account!.id);
  res.status(201).json({
    backup: { ...backup, size_bytes: backup.size_bytes == null ? null : Number(backup.size_bytes), file_url: undefined, stored: !!backup.file_url },
  });
});

// Check a copy again on demand, for someone who wants to be sure before
// relying on it.
adminBackupsRouter.post('/:backupId/check', async (req, res) => {
  const backup = await db('backups').where({ id: req.params['backupId'] }).first();
  if (!backup) {
    res.status(404).json({ error: 'That copy is no longer here.', code: 'NOT_FOUND' });
    return;
  }
  const ok = await verifyBackup(backup.id);
  const updated = await db('backups').where({ id: backup.id }).first();
  res.json({
    ok,
    message: ok ? 'Checked and working.' : updated?.error ?? 'This copy could not be checked.',
    backup: { ...updated, size_bytes: updated.size_bytes == null ? null : Number(updated.size_bytes), file_url: undefined, stored: !!updated.file_url },
  });
});

adminBackupsRouter.get('/:backupId/download', async (req, res) => {
  const backup = await db('backups').where({ id: req.params['backupId'] }).first();
  if (!backup?.file_url || !fs.existsSync(backup.file_url)) {
    res.status(404).json({ error: 'That copy is no longer here.', code: 'NOT_FOUND' });
    return;
  }
  await audit(req.account!.id, `downloaded the copy from ${new Date(backup.started_at).toISOString()}`);
  // Remembered so the screen can stop claiming protection it has not earned:
  // a copy that has left this server is the only kind that survives it.
  await db('backups').where({ id: backup.id }).update({ downloaded_at: db.fn.now() });
  res.download(backup.file_url, backup.filename ?? 'parecare-backup.tar.gz');
});

/**
 * Put everything back as it was in a chosen copy. This replaces the live
 * records, so it asks for the date to be typed back rather than relying on a
 * button nobody reads. A copy of the current state is taken first, so an
 * accidental restore is itself undoable.
 */
const restoreSchema = z.object({ confirm: z.string().min(1) });

adminBackupsRouter.post('/:backupId/restore', async (req, res) => {
  const parsed = restoreSchema.safeParse(req.body);
  const backup = await db('backups').where({ id: req.params['backupId'] }).first();
  if (!backup?.file_url || !fs.existsSync(backup.file_url)) {
    res.status(404).json({ error: 'That copy is no longer here.', code: 'NOT_FOUND' });
    return;
  }
  const expected = new Date(backup.started_at).toISOString().slice(0, 10);
  if (!parsed.success || parsed.data.confirm.trim() !== expected) {
    res.status(400).json({
      error: `To put this copy back, type its date: ${expected}`,
      code: 'CONFIRM_REQUIRED',
    });
    return;
  }
  await audit(req.account!.id, `restored the copy from ${new Date(backup.started_at).toISOString()}`);
  const result = await restoreBackup(backup.id, req.account!.id);
  if (!result.ok) {
    res.status(500).json({ error: result.message, code: 'RESTORE_FAILED' });
    return;
  }
  res.json({ message: result.message });
});
