import * as fs from 'node:fs';
import { Readable } from 'node:stream';
import { env } from '../config/env';
import { getOAuthConfig, getBackupConfig, updateSettings } from '../config/settings';

/**
 * Keeping a copy somewhere that is not this server.
 *
 * Everything else about backups protects against mistakes: a wrong deletion,
 * a bad restore, a damaged file. None of it survives the machine itself
 * being lost, which is the failure people actually mean when they worry
 * about their records. A copy in the person's own Google Drive does.
 *
 * The connection is one button. It reuses the Google credentials the
 * installation already has for signing in, so nothing new has to be
 * registered beyond one address, and it asks for the narrowest permission
 * Google offers: drive.file, which can only see files this app created. It
 * cannot read anything else in their Drive.
 */

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'PareCare backups';

/** Where Google sends people back to after they agree. */
export function driveRedirectUri(): string {
  return `${env.APP_URL}/api/v1/admin/backups/google/callback`;
}

export function driveConfigured(): boolean {
  const cfg = getOAuthConfig();
  return !!cfg.googleClientId && !!cfg.googleClientSecret;
}

export function driveConnected(): boolean {
  return !!getBackupConfig().googleRefreshToken;
}

export function driveAccount(): string | undefined {
  return getBackupConfig().googleAccount;
}

/**
 * The consent screen to send someone to. access_type=offline with
 * prompt=consent is what makes Google hand back a refresh token, without
 * which the connection would quietly stop working in an hour.
 */
export function driveAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getOAuthConfig().googleClientId!,
    redirect_uri: driveRedirectUri(),
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  return (await res.json()) as TokenResponse;
}

/** Finish the connection: swap the one-time code for a lasting one. */
export async function completeDriveConnection(code: string, accountId: string | null): Promise<{ ok: boolean; message: string }> {
  const cfg = getOAuthConfig();
  const token = await tokenRequest({
    client_id: cfg.googleClientId!,
    client_secret: cfg.googleClientSecret!,
    redirect_uri: driveRedirectUri(),
    grant_type: 'authorization_code',
    code,
  });
  if (!token.refresh_token) {
    return {
      ok: false,
      message:
        'Google did not finish the connection. Try again, and make sure you press Allow on the permission screen.',
    };
  }

  // Whose Drive this is, so the screen can name it rather than saying
  // "connected" and leaving someone wondering to what.
  let who = 'your Google account';
  if (token.access_token) {
    const me = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ email?: string }>) : null))
      .catch(() => null);
    if (me?.email) who = me.email;
  }

  await updateSettings(
    { 'backups.google_refresh_token': token.refresh_token, 'backups.google_account': who, 'backups.google_folder_id': '' },
    accountId
  );
  return { ok: true, message: `Copies will now also be kept in ${who}.` };
}

export async function disconnectDrive(accountId: string | null): Promise<void> {
  await updateSettings(
    { 'backups.google_refresh_token': '', 'backups.google_account': '', 'backups.google_folder_id': '' },
    accountId
  );
}

async function accessToken(): Promise<string | null> {
  const cfg = getOAuthConfig();
  const refresh = getBackupConfig().googleRefreshToken;
  if (!refresh || !cfg.googleClientId || !cfg.googleClientSecret) return null;
  const token = await tokenRequest({
    client_id: cfg.googleClientId,
    client_secret: cfg.googleClientSecret,
    grant_type: 'refresh_token',
    refresh_token: refresh,
  });
  return token.access_token ?? null;
}

/** The folder copies go into, made once and remembered. */
async function folderId(token: string, accountId: string | null): Promise<string | null> {
  const known = getBackupConfig().googleFolderId;
  if (known) {
    const check = await fetch(`https://www.googleapis.com/drive/v3/files/${known}?fields=id,trashed`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (check.ok) {
      const data = (await check.json()) as { trashed?: boolean };
      if (!data.trashed) return known;
    }
  }
  const made = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!made.ok) return null;
  const data = (await made.json()) as { id?: string };
  if (!data.id) return null;
  await updateSettings({ 'backups.google_folder_id': data.id }, accountId);
  return data.id;
}

/**
 * Send one copy to Drive. Resumable rather than a single POST, because a
 * copy of a well-used installation is large enough that a dropped connection
 * partway through is a normal event, not an exceptional one.
 */
export async function sendToDrive(
  filePath: string,
  filename: string
): Promise<{ ok: boolean; ref?: string; message: string }> {
  const token = await accessToken();
  if (!token) {
    return { ok: false, message: 'The connection to Google Drive has stopped working. Connect it again.' };
  }
  const parent = await folderId(token, null);
  if (!parent) {
    return { ok: false, message: 'The backups folder in Google Drive could not be opened.' };
  }

  const size = fs.statSync(filePath).size;
  const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': 'application/gzip',
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name: filename, parents: [parent] }),
  });
  const session = start.headers.get('location');
  if (!start.ok || !session) {
    return { ok: false, message: 'Google Drive would not accept the copy just now.' };
  }

  // Streamed rather than read into memory: a copy of a well-used
  // installation is far larger than anything worth buffering. The web-stream
  // conversion and duplex flag are what Node needs to send a body it is
  // still reading.
  const upload = await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(size) },
    body: Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  if (!upload.ok) {
    return { ok: false, message: 'The copy did not finish uploading to Google Drive.' };
  }
  const done = (await upload.json()) as { id?: string };
  return { ok: true, ref: done.id, message: 'A copy has been kept in Google Drive.' };
}

/** Remove a copy from Drive when it is thinned out here, so the two agree. */
export async function removeFromDrive(offsiteRef: string): Promise<void> {
  const token = await accessToken();
  if (!token) return;
  await fetch(`https://www.googleapis.com/drive/v3/files/${offsiteRef}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}
