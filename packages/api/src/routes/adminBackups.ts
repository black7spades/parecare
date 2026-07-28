import { Router } from 'express';
import * as fs from 'node:fs';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { getBackupConfig } from '../config/settings';
import { runBackup, verifyBackup, lastGoodBackup, restoreBackup, type BackupRow } from '../services/backup';

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

adminBackupsRouter.use(requireAuth, requireRole('super_admin'));

async function audit(accountId: string, summary: string): Promise<void> {
  await db('audit_log')
    .insert({ care_profile_id: null, actor_account_id: accountId, action: 'created', entity_type: 'backups', summary: summary.slice(0, 255) })
    .catch(() => {});
}

/**
 * One sentence a worried person can act on, describing where this
 * installation stands. Never a status code or a count of anything.
 */
function reassurance(last: BackupRow | undefined, enabled: boolean): { state: 'protected' | 'stale' | 'none' | 'off'; message: string } {
  if (!enabled) {
    return { state: 'off', message: 'Automatic copies are turned off, so there is nothing to restore from if something goes wrong.' };
  }
  if (!last) {
    return { state: 'none', message: 'No copy has been made yet. The first one is taken within a few minutes.' };
  }
  const ageMs = Date.now() - new Date(last.started_at).getTime();
  const stale = ageMs > 3 * 86400_000;
  if (stale) {
    return { state: 'stale', message: 'Copies have not run recently. Your most recent one may be out of date.' };
  }
  return {
    state: 'protected',
    message: last.verified_at ? 'Your data is protected. The last copy was checked and works.' : 'Your data is protected.',
  };
}

adminBackupsRouter.get('/', async (_req, res) => {
  const cfg = getBackupConfig();
  const last = await lastGoodBackup();
  const backups = await db('backups').orderBy('started_at', 'desc').limit(200);
  res.json({
    status: reassurance(last, cfg.enabled),
    settings: { enabled: cfg.enabled, frequency: cfg.frequency, keep_days: cfg.keepDays },
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
