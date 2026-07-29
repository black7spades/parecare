import { Router } from 'express';
import * as fs from 'node:fs';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAccountRight } from '../middleware/accountRights';
import { getBackupConfig } from '../config/settings';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { runBackup, verifyBackup, lastGoodBackup, restoreBackup, spaceReport, type BackupRow } from '../services/backup';
import { driveAuthUrl, driveRedirectUri, completeDriveConnection, disconnectDrive } from '../services/backupDrive';
import { dropboxAuthUrl, dropboxRedirectUri, completeDropboxConnection, disconnectDropbox } from '../services/backupDropbox';
import { testS3 } from '../services/backupS3';
import {
  activeDestination,
  destinationStates,
  offsiteReady,
  sendCopyOffsite,
  DESTINATION_NAMES,
  type Destination,
} from '../services/backupOffsite';
import { updateSettings } from '../config/settings';
import { runDrill, lastDrill } from '../services/backupDrill';
import { levelReport } from '../services/backupLevels';
import { sendWardenBriefEmail, sendWardenInviteEmail, sendWardenCopyEmail } from '../services/email';
import { assertCanBeWarden, createWardenInvite, wardenInviteUrl, WardenError, MAX_WARDENS } from '../services/wardens';

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

adminBackupsRouter.get('/', async (req, res) => {
  // Someone who has this only because they were nominated, opening this
  // screen, is the whole of level five. Recorded here because visiting is
  // the evidence; there is nothing else they could do to prove it.
  if (req.account!.role !== 'admin' && req.account!.role !== 'super_admin') {
    await db('accounts').where({ id: req.account!.id }).update({ backups_seen_at: db.fn.now() }).catch(() => {});
  }

  const cfg = getBackupConfig();
  const last = await lastGoodBackup();
  const backups = await db('backups').orderBy('started_at', 'desc').limit(200);
  const space = await spaceReport();
  // A copy that was downloaded has left this server, which is the only thing
  // that makes any of this survive the server dying.
  const takenAway = await db('backups')
    .where((qb) => qb.whereNotNull('downloaded_at').orWhereNotNull('offsite_at'))
    .first();

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
    .select('id', 'display_name', 'email', 'role', 'can_manage_backups', 'warden_briefed_at', 'backups_seen_at');

  // Everyone else who could be given it, so nominating someone happens here
  // rather than by sending a worried person off to another screen to hunt
  // for a checkbox.
  const couldHelp = await db('accounts')
    .whereNot({ can_manage_backups: true })
    .whereNotIn('role', ['super_admin', 'admin'])
    .whereNull('disabled_at')
    .orderBy('display_name', 'asc')
    .select('id', 'display_name', 'email')
    .limit(200);

  // People asked but not yet answered, so the screen can show the ask as
  // in flight rather than as though nothing happened.
  const pendingInvites = await db('warden_invites')
    .where({ status: 'pending' })
    .where('expires_at', '>', new Date())
    .orderBy('created_at', 'desc')
    .select('id', 'email', 'created_at', 'expires_at');

  const [levels, drill] = await Promise.all([levelReport(), lastDrill()]);

  res.json({
    status: reassurance(last, cfg.enabled, !!takenAway, space.roomForMore),
    levels,
    last_drill: drill ?? null,
    settings: { enabled: cfg.enabled, frequency: cfg.frequency, keep_days: cfg.keepDays },
    space: { room_for_more: space.roomForMore, used_by_copies: space.usedByCopies },
    cloud: {
      active: activeDestination(),
      ready: offsiteReady(),
      destinations: destinationStates(),
      // Shown so whoever registers the apps can copy them straight across.
      google_redirect_uri: driveRedirectUri(),
      dropbox_redirect_uri: dropboxRedirectUri(),
    },
    keyholders: keyholders.map((k: {
      id: string;
      display_name: string;
      email: string;
      role: string;
      can_manage_backups: boolean;
      warden_briefed_at: Date | null;
      backups_seen_at: Date | null;
    }) => ({
      ...k,
      // Someone who has it because of their role keeps it whatever this
      // screen does, so it must not offer to take it away and then fail.
      by_role: k.role === 'super_admin' || k.role === 'admin',
    })),
    could_help: couldHelp,
    pending_wardens: pendingInvites,
    max_wardens: MAX_WARDENS,
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

/**
 * Nominate someone else who can get the records back, or take that away.
 *
 * Handing this out is itself an administrator's decision, so only an admin
 * can do it: otherwise the first person given access could quietly widen it
 * to anyone.
 */
const keyholderSchema = z.object({ account_id: z.string().uuid() });

function canNominate(role: string | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

adminBackupsRouter.post('/keyholders', async (req, res) => {
  if (!canNominate(req.account!.role)) {
    res.status(403).json({ error: 'Only an administrator can give someone else access to backups.', code: 'FORBIDDEN' });
    return;
  }
  const parsed = keyholderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose someone from the list first.', code: 'VALIDATION_ERROR' });
    return;
  }
  const person = await db('accounts').where({ id: parsed.data.account_id }).whereNull('disabled_at').first();
  if (!person) {
    res.status(404).json({ error: 'That person is no longer here.', code: 'NOT_FOUND' });
    return;
  }
  await db('accounts').where({ id: person.id }).update({ can_manage_backups: true, updated_at: db.fn.now() });
  await audit(req.account!.id, `gave ${person.email} access to backups`);
  res.json({ message: `${person.display_name} can now get these records back too.` });
});

adminBackupsRouter.delete('/keyholders/:accountId', async (req, res) => {
  if (!canNominate(req.account!.role)) {
    res.status(403).json({ error: 'Only an administrator can change who has access to backups.', code: 'FORBIDDEN' });
    return;
  }
  const person = await db('accounts').where({ id: req.params['accountId'] }).first();
  if (!person) {
    res.status(404).json({ error: 'That person is no longer here.', code: 'NOT_FOUND' });
    return;
  }
  if (person.role === 'admin' || person.role === 'super_admin') {
    res.status(400).json({
      error: `${person.display_name} has this because they are an administrator, so it cannot be taken away here.`,
      code: 'BY_ROLE',
    });
    return;
  }
  await db('accounts').where({ id: person.id }).update({ can_manage_backups: false, updated_at: db.fn.now() });
  await audit(req.account!.id, `removed backup access from ${person.email}`);
  res.json({ message: `${person.display_name} no longer has access to backups.` });
});

/**
 * Practise the emergency. Destroys and restores a practice copy of the
 * records, on a scratch database that is always dropped, so nothing live is
 * ever at risk. This is the only thing that turns "there are copies" into
 * "the copies work".
 */
adminBackupsRouter.post('/drill', async (req, res) => {
  const running = await db('backup_drills').where({ status: 'running' }).first();
  if (running) {
    res.status(409).json({ error: 'A practice run is already going. It will appear here when it finishes.', code: 'ALREADY_RUNNING' });
    return;
  }
  await audit(req.account!.id, 'ran a backup practice run');
  const drill = await runDrill(req.account!.id);
  res.status(201).json({
    drill,
    message:
      drill.status === 'passed'
        ? `Practice run passed. ${drill.rows_before} records were destroyed and all ${drill.rows_restored} came back.`
        : drill.error ?? 'The practice run did not finish.',
  });
});

/**
 * Ask somebody to be a data warden, by email address rather than by picking
 * from a list. The person most likely to be asked is a sibling or a friend
 * who has never used this, and a list of existing accounts cannot offer
 * them at all.
 *
 * Every refusal says what to do instead. Being told no without a reason is
 * how somebody ends up with no warden.
 */
const askSchema = z.object({ email: z.string().min(3).max(255) });

adminBackupsRouter.post('/wardens', async (req, res) => {
  if (!canNominate(req.account!.role)) {
    res.status(403).json({ error: 'Only an administrator can ask someone to be a data warden.', code: 'FORBIDDEN' });
    return;
  }
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter their email address.', code: 'VALIDATION_ERROR' });
    return;
  }

  let candidate;
  try {
    candidate = await assertCanBeWarden(parsed.data.email, req.account!);
  } catch (err) {
    if (err instanceof WardenError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }

  const invite = await createWardenInvite(candidate.email, req.account!);
  const url = wardenInviteUrl(invite.token);
  try {
    await sendWardenInviteEmail(candidate.email, req.account!.display_name, url);
  } catch (err) {
    // Nothing was granted, so the invitation is cancelled rather than left
    // pending against an address that never heard about it.
    await db('warden_invites').where({ id: invite.id }).update({ status: 'cancelled' });
    const why = (err as Error).message.replace(/\.$/, '');
    res.status(500).json({
      error: `The invitation could not be sent: ${why}. Set up email under Settings, then try again.`,
      code: 'EMAIL_FAILED',
    });
    return;
  }
  // A copy for the person who asked, so they know what their friend was told
  // and can talk them through it. Never blocks the invitation itself.
  await sendWardenCopyEmail(req.account!.email, req.account!.display_name, candidate.email, url).catch((err) =>
    console.warn('Data warden copy email failed:', (err as Error).message)
  );
  await audit(req.account!.id, `asked ${candidate.email} to be a data warden`);
  res.status(201).json({
    message: candidate.account
      ? `Sent. ${candidate.account.display_name} has been asked, and a copy is in your inbox.`
      : `Sent to ${candidate.email}. They can set themselves up from the link, and a copy is in your inbox.`,
  });
});

/**
 * Tell someone what being a data warden means. Being nominated quietly is
 * not the same as knowing you have been asked, and someone who does not know
 * is not a second pair of hands.
 */
adminBackupsRouter.post('/keyholders/:accountId/brief', async (req, res) => {
  if (!canNominate(req.account!.role)) {
    res.status(403).json({ error: 'Only an administrator can ask someone to be a data warden.', code: 'FORBIDDEN' });
    return;
  }
  const person = await db('accounts').where({ id: req.params['accountId'] }).whereNull('disabled_at').first();
  if (!person) {
    res.status(404).json({ error: 'That person is no longer here.', code: 'NOT_FOUND' });
    return;
  }
  if (!person.can_manage_backups) {
    res.status(400).json({ error: 'Give them access to backups first, then send the instructions.', code: 'NOT_A_KEYHOLDER' });
    return;
  }
  try {
    await sendWardenBriefEmail(
      person.email,
      person.display_name,
      req.account!.display_name,
      `${env.APP_URL}/system/backups`
    );
  } catch (err) {
    // The reason already reads as a sentence, so it is not punctuated twice.
    const why = (err as Error).message.replace(/\.$/, '');
    res.status(500).json({
      error: `The email could not be sent: ${why}. Set up email under Settings, or simply tell them yourself.`,
      code: 'EMAIL_FAILED',
    });
    return;
  }
  await db('accounts').where({ id: person.id }).update({ warden_briefed_at: db.fn.now() });
  await audit(req.account!.id, `asked ${person.email} to be a data warden`);
  res.json({ message: `Sent. ${person.display_name} now knows what to do if it is ever needed.` });
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

// --- Keeping copies somewhere that is not this server ----------------------

const OAUTH_DESTINATIONS = {
  google: { configured: () => destinationStates().find((d) => d.id === 'google')!.available, url: driveAuthUrl, name: 'Google Drive' },
  dropbox: { configured: () => destinationStates().find((d) => d.id === 'dropbox')!.available, url: dropboxAuthUrl, name: 'Dropbox' },
} as const;

adminBackupsRouter.post('/:provider(google|dropbox)/connect', (req, res) => {
  const which = req.params['provider'] as 'google' | 'dropbox';
  const dest = OAUTH_DESTINATIONS[which];
  if (!dest.configured()) {
    res.status(400).json({
      error: `${dest.name} has not been set up for this installation yet. Fill in its details first, and add the address shown here to them.`,
      code: 'NOT_CONFIGURED',
    });
    return;
  }
  // Short-lived and signed, so the callback cannot be forged, and carrying
  // who started it so the connection is recorded against a real person.
  const state = jwt.sign({ purpose: 'offsite_connect', provider: which, accountId: req.account!.id }, env.JWT_SECRET, {
    expiresIn: '10m',
  });
  res.json({ url: dest.url(state) });
});

/**
 * Google and Dropbox send the person back here. These arrive from a browser
 * redirect rather than the app, so they authenticate from the signed state
 * instead of the usual header, and always land back on the screen.
 */
export const adminBackupsCallbackRouter = Router();

adminBackupsCallbackRouter.get('/:provider(google|dropbox)/callback', async (req, res) => {
  const which = req.params['provider'] as 'google' | 'dropbox';
  const back = (msg: string) => res.redirect(`${env.APP_URL}/system/backups#${msg}`);
  let accountId: string | null = null;
  try {
    const payload = jwt.verify(String(req.query['state'] ?? ''), env.JWT_SECRET) as {
      purpose?: string;
      provider?: string;
      accountId?: string;
    };
    if (payload.purpose !== 'offsite_connect' || payload.provider !== which) throw new Error('wrong purpose');
    accountId = payload.accountId ?? null;
  } catch {
    back('error=that-link-has-expired');
    return;
  }
  const code = String(req.query['code'] ?? '');
  if (!code) {
    back('error=connecting-was-cancelled');
    return;
  }
  const result =
    which === 'google' ? await completeDriveConnection(code, accountId) : await completeDropboxConnection(code, accountId);
  if (result.ok) {
    // Choosing it is part of connecting it. Making someone connect and then
    // separately switch it on is a step that earns nothing.
    await updateSettings({ 'backups.destination': which }, accountId);
  }
  back(result.ok ? 'connected=1' : 'error=connecting-did-not-finish');
});

adminBackupsRouter.post('/:provider(google|dropbox)/disconnect', async (req, res) => {
  const which = req.params['provider'] as 'google' | 'dropbox';
  if (which === 'google') await disconnectDrive(req.account!.id);
  else await disconnectDropbox(req.account!.id);
  if (activeDestination() === which) await updateSettings({ 'backups.destination': 'none' }, req.account!.id);
  await audit(req.account!.id, `disconnected ${OAUTH_DESTINATIONS[which].name}`);
  res.json({
    message: `Copies will no longer be kept in ${OAUTH_DESTINATIONS[which].name}. The ones already there are untouched.`,
  });
});

/**
 * The details of the Google or Dropbox app this installation uses. Saved from
 * the Backups screen so setting up a destination never sends someone off to
 * another screen mid-way through a walkthrough, holding two values they have
 * just been told to copy.
 */
const googleAppSchema = z.object({ client_id: z.string().min(1).max(500), client_secret: z.string().min(1).max(500) });
const dropboxAppSchema = z.object({ app_key: z.string().min(1).max(500), app_secret: z.string().min(1).max(500) });

adminBackupsRouter.post('/:provider(google|dropbox)/app', async (req, res) => {
  if (!canNominate(req.account!.role)) {
    res.status(403).json({ error: 'Only an administrator can change how this connects to Google or Dropbox.', code: 'FORBIDDEN' });
    return;
  }
  const which = req.params['provider'] as 'google' | 'dropbox';
  if (which === 'google') {
    const parsed = googleAppSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Paste both the client ID and the client secret from Google.', code: 'VALIDATION_ERROR' });
      return;
    }
    await updateSettings(
      { 'oauth.google_client_id': parsed.data.client_id.trim(), 'oauth.google_client_secret': parsed.data.client_secret.trim() },
      req.account!.id
    );
  } else {
    const parsed = dropboxAppSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Paste both the app key and the app secret from Dropbox.', code: 'VALIDATION_ERROR' });
      return;
    }
    await updateSettings(
      { 'backups.dropbox_app_key': parsed.data.app_key.trim(), 'backups.dropbox_app_secret': parsed.data.app_secret.trim() },
      req.account!.id
    );
  }
  await audit(req.account!.id, `saved the ${which} app details for backups`);
  res.json({ message: 'Saved. You can carry on with the next step.' });
});

/**
 * Storage details are typed rather than granted, so they are saved and then
 * proved before anyone relies on them. Storage that quietly rejects every
 * copy looks exactly like storage that works, until the day it is needed.
 */
const s3Schema = z.object({
  bucket: z.string().min(1).max(255),
  region: z.string().max(100).optional(),
  access_key: z.string().min(1).max(255),
  secret_key: z.string().min(1).max(255),
  endpoint: z.string().max(500).optional(),
});

adminBackupsRouter.post('/storage', async (req, res) => {
  const parsed = s3Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Fill in the bucket, the access key and the secret key.', code: 'VALIDATION_ERROR' });
    return;
  }
  const d = parsed.data;
  await updateSettings(
    {
      'backups.s3_bucket': d.bucket,
      'backups.s3_region': d.region ?? 'us-east-1',
      'backups.s3_access_key': d.access_key,
      'backups.s3_secret_key': d.secret_key,
      'backups.s3_endpoint': d.endpoint ?? '',
    },
    req.account!.id
  );
  const test = await testS3();
  if (!test.ok) {
    res.status(400).json({ error: test.message, code: 'STORAGE_UNREACHABLE' });
    return;
  }
  await updateSettings({ 'backups.destination': 's3' }, req.account!.id);
  await audit(req.account!.id, 'connected storage for copies');
  res.json({ message: test.message });
});

adminBackupsRouter.post('/storage/disconnect', async (req, res) => {
  if (activeDestination() === 's3') await updateSettings({ 'backups.destination': 'none' }, req.account!.id);
  await audit(req.account!.id, 'stopped using storage for copies');
  res.json({ message: 'Copies will no longer be sent to your storage. The ones already there are untouched.' });
});

// Send an existing copy across, for someone who has just connected and does
// not want to wait for the next one.
adminBackupsRouter.post('/:backupId/send-offsite', async (req, res) => {
  if (!offsiteReady()) {
    res.status(400).json({ error: 'Copies are not being kept anywhere other than this server yet.', code: 'NOT_CONNECTED' });
    return;
  }
  const result = await sendCopyOffsite(req.params['backupId']!);
  if (!result.ok) {
    res.status(500).json({ error: result.message, code: 'OFFSITE_FAILED' });
    return;
  }
  await audit(req.account!.id, `sent a copy to ${DESTINATION_NAMES[activeDestination() as Destination]}`);
  res.json({ message: result.message });
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
