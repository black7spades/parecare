import * as fs from 'node:fs';
import { env } from '../config/env';
import { getBackupConfig, updateSettings } from '../config/settings';

/**
 * Keeping copies in the person's own Dropbox.
 *
 * Same shape as the Google Drive path, and for the same reason: the copy has
 * to live somewhere that is not the machine it protects. Dropbox needs its
 * own small app registering, so the screen shows the two things to paste in
 * and the address to allow, and nothing else is asked of anyone.
 *
 * The permission is scoped to an app folder, so PareCare gets its own
 * corner of the Dropbox and can never see anything else in it.
 */

const FOLDER = '/PareCare backups';
// Dropbox takes a single upload up to 150 MB; past that it must be sent in
// pieces. Well under the limit so a copy near the boundary never fails.
const SINGLE_SHOT_LIMIT = 120 * 1024 * 1024;
const CHUNK = 8 * 1024 * 1024;

export function dropboxRedirectUri(): string {
  return `${env.APP_URL}/api/v1/admin/backups/dropbox/callback`;
}

export function dropboxConfigured(): boolean {
  const cfg = getBackupConfig();
  return !!cfg.dropboxAppKey && !!cfg.dropboxAppSecret;
}

export function dropboxConnected(): boolean {
  return !!getBackupConfig().dropboxRefreshToken;
}

export function dropboxAccount(): string | undefined {
  return getBackupConfig().dropboxAccount;
}

/**
 * token_access_type=offline is what makes Dropbox hand back a lasting token.
 * Without it the connection works for a few hours and then quietly stops,
 * which is the worst way for a backup to fail.
 */
export function dropboxAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getBackupConfig().dropboxAppKey!,
    redirect_uri: dropboxRedirectUri(),
    response_type: 'code',
    token_access_type: 'offline',
    state,
  });
  return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  account_id?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const cfg = getBackupConfig();
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${cfg.dropboxAppKey}:${cfg.dropboxAppSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams(body).toString(),
  });
  return (await res.json()) as TokenResponse;
}

export async function completeDropboxConnection(
  code: string,
  accountId: string | null
): Promise<{ ok: boolean; message: string }> {
  const token = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: dropboxRedirectUri(),
  });
  if (!token.refresh_token) {
    return {
      ok: false,
      message: 'Dropbox did not finish the connection. Try again, and make sure you press Allow.',
    };
  }

  let who = 'your Dropbox';
  if (token.access_token) {
    const me = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ email?: string }>) : null))
      .catch(() => null);
    if (me?.email) who = me.email;
  }

  await updateSettings(
    { 'backups.dropbox_refresh_token': token.refresh_token, 'backups.dropbox_account': who },
    accountId
  );
  return { ok: true, message: `Copies will now also be kept in ${who}.` };
}

export async function disconnectDropbox(accountId: string | null): Promise<void> {
  await updateSettings({ 'backups.dropbox_refresh_token': '', 'backups.dropbox_account': '' }, accountId);
}

async function accessToken(): Promise<string | null> {
  const cfg = getBackupConfig();
  if (!cfg.dropboxRefreshToken || !dropboxConfigured()) return null;
  const token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: cfg.dropboxRefreshToken });
  return token.access_token ?? null;
}

const apiArg = (value: unknown): string => JSON.stringify(value);

/**
 * Send one copy up. Small ones go in a single request; larger ones are sent
 * in pieces, because a copy of a well-used installation is big enough that a
 * dropped connection partway through is ordinary rather than exceptional.
 */
export async function sendToDropbox(
  filePath: string,
  filename: string
): Promise<{ ok: boolean; ref?: string; message: string }> {
  const token = await accessToken();
  if (!token) {
    return { ok: false, message: 'The connection to Dropbox has stopped working. Connect it again.' };
  }
  const target = `${FOLDER}/${filename}`;
  const size = fs.statSync(filePath).size;

  if (size <= SINGLE_SHOT_LIMIT) {
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': apiArg({ path: target, mode: 'overwrite', mute: true }),
      },
      body: fs.readFileSync(filePath),
    });
    if (!res.ok) return { ok: false, message: 'Dropbox would not accept the copy just now.' };
    return { ok: true, ref: target, message: 'A copy has been kept in Dropbox.' };
  }

  // Larger copies: open a session, push pieces, then close it.
  const handle = await fetch('https://content.dropboxapi.com/2/files/upload_session/start', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArg({ close: false }),
    },
    body: Buffer.alloc(0),
  });
  if (!handle.ok) return { ok: false, message: 'Dropbox would not start receiving the copy.' };
  const { session_id } = (await handle.json()) as { session_id: string };

  let offset = 0;
  const fd = await fs.promises.open(filePath, 'r');
  try {
    while (offset < size) {
      const length = Math.min(CHUNK, size - offset);
      const buffer = Buffer.alloc(length);
      await fd.read(buffer, 0, length, offset);
      const res = await fetch('https://content.dropboxapi.com/2/files/upload_session/append_v2', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': apiArg({ cursor: { session_id, offset }, close: false }),
        },
        body: buffer,
      });
      if (!res.ok) return { ok: false, message: 'The copy stopped partway through uploading to Dropbox.' };
      offset += length;
    }
  } finally {
    await fd.close();
  }

  const finish = await fetch('https://content.dropboxapi.com/2/files/upload_session/finish', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArg({
        cursor: { session_id, offset: size },
        commit: { path: target, mode: 'overwrite', mute: true },
      }),
    },
    body: Buffer.alloc(0),
  });
  if (!finish.ok) return { ok: false, message: 'The copy did not finish uploading to Dropbox.' };
  return { ok: true, ref: target, message: 'A copy has been kept in Dropbox.' };
}

export async function removeFromDropbox(ref: string): Promise<void> {
  const token = await accessToken();
  if (!token) return;
  await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: ref }),
  }).catch(() => {});
}
