import * as fs from 'node:fs';
import { db } from '../config/database';
import { getBackupConfig } from '../config/settings';
import { driveConfigured, driveConnected, driveAccount, sendToDrive, removeFromDrive } from './backupDrive';
import { dropboxConfigured, dropboxConnected, dropboxAccount, sendToDropbox, removeFromDropbox } from './backupDropbox';
import { s3Configured, s3Account, sendToS3, removeFromS3 } from './backupS3';

/**
 * The one place that knows a copy went somewhere else.
 *
 * Three destinations, one path through the code. The alternative was three
 * bespoke integrations, which would have been three places to get the
 * important part wrong: sending after the local copy is safe, removing from
 * the right place when a copy is thinned out, and never claiming a copy left
 * this server when it did not.
 *
 * Only one destination is active at a time. A choice of somewhere else is
 * useful; a grid of somewhere elses is a chore, and nobody managing their
 * mother's medication needs to reason about which of four places a copy went.
 */

export type Destination = 'none' | 'google' | 'dropbox' | 's3';

export interface DestinationState {
  id: Destination;
  /** Whether the details needed to use it have been filled in. */
  available: boolean;
  /** Whether it is ready to receive copies right now. */
  ready: boolean;
  /** Which account or bucket, so the screen never just says "connected". */
  account: string | null;
}

/** How each destination is named to a person. Never the protocol. */
export const DESTINATION_NAMES: Record<Destination, string> = {
  none: 'nowhere else',
  google: 'Google Drive',
  dropbox: 'Dropbox',
  s3: 'your storage',
};

export function activeDestination(): Destination {
  return getBackupConfig().destination;
}

export function destinationStates(): DestinationState[] {
  return [
    { id: 'google', available: driveConfigured(), ready: driveConnected(), account: driveAccount() ?? null },
    { id: 'dropbox', available: dropboxConfigured(), ready: dropboxConnected(), account: dropboxAccount() ?? null },
    { id: 's3', available: true, ready: s3Configured(), account: s3Account() ?? null },
  ];
}

/** Whether copies are actually going anywhere other than this server. */
export function offsiteReady(): boolean {
  const active = activeDestination();
  if (active === 'none') return false;
  return destinationStates().find((d) => d.id === active)?.ready ?? false;
}

/**
 * Send one copy to wherever this installation keeps them. Called after the
 * copy is safely written here, so a problem at the far end never costs the
 * local copy.
 */
export async function sendCopyOffsite(backupId: string): Promise<{ ok: boolean; message: string }> {
  const active = activeDestination();
  if (active === 'none') {
    return { ok: false, message: 'Copies are not being kept anywhere other than this server.' };
  }
  const backup = await db('backups').where({ id: backupId }).first();
  if (!backup?.file_url || !fs.existsSync(backup.file_url)) {
    return { ok: false, message: 'That copy is no longer on this server.' };
  }
  const filename = backup.filename ?? 'parecare-backup.tar.gz';

  const result =
    active === 'google'
      ? await sendToDrive(backup.file_url, filename)
      : active === 'dropbox'
        ? await sendToDropbox(backup.file_url, filename)
        : await sendToS3(backup.file_url, filename);

  if (!result.ok) {
    await db('backups').where({ id: backupId }).update({ offsite_error: result.message.slice(0, 500) });
    return { ok: false, message: result.message };
  }
  await db('backups').where({ id: backupId }).update({
    offsite_at: db.fn.now(),
    offsite_kind: active,
    offsite_ref: result.ref ?? null,
    offsite_error: null,
  });
  return { ok: true, message: result.message };
}

/**
 * Take a copy out of wherever it went, when it is thinned out here. Removed
 * from the place it actually went to rather than the currently chosen one,
 * so changing destination never orphans what came before.
 */
export async function removeCopyOffsite(kind: string | null, ref: string): Promise<void> {
  if (kind === 'google') await removeFromDrive(ref);
  else if (kind === 'dropbox') await removeFromDropbox(ref);
  else if (kind === 's3') await removeFromS3(ref);
}
