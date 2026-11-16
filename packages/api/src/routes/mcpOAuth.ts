import { Router, type Request, type Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db } from '../config/database';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { API_KEY_PREFIX, hashApiKey } from './apiKeys';

/**
 * Signing an outside assistant in to PareCare, so connecting Claude or
 * ChatGPT is "paste the address, click Connect, click Allow" and nobody
 * copies a password anywhere.
 *
 * This is the OAuth 2.1 flow the Model Context Protocol expects: the
 * assistant discovers us from the well-known documents, registers itself
 * (dynamic client registration), sends the person to our consent screen,
 * and swaps the single-use code it gets back (checked with PKCE) for a
 * pass. The pass is an ordinary row in api_keys, so it shows up in the
 * person's list of connected apps and disconnecting it works at once.
 */

const ACCESS_TTL_S = 30 * 24 * 3600; // a pass lasts 30 days, then renews
const CODE_TTL_MS = 10 * 60 * 1000;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function issuer(): string {
  return env.APP_URL;
}

// ── Discovery: served at the site root, outside /api/v1 ────────────────

export const wellKnownRouter = Router();

function protectedResource(_req: Request, res: Response) {
  res.json({
    resource: `${issuer()}/api/v1/mcp`,
    authorization_servers: [issuer()],
    bearer_methods_supported: ['header'],
    resource_name: 'PareCare',
  });
}

function authorizationServer(_req: Request, res: Response) {
  const base = `${issuer()}/api/v1/oauth`;
  res.json({
    issuer: issuer(),
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    revocation_endpoint: `${base}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['parecare'],
  });
}

wellKnownRouter.get(/^\/oauth-protected-resource(\/.*)?$/, protectedResource);
wellKnownRouter.get(/^\/oauth-authorization-server(\/.*)?$/, authorizationServer);
wellKnownRouter.get(/^\/openid-configuration(\/.*)?$/, authorizationServer);

// ── The flow itself, under /api/v1/oauth ───────────────────────────────

export const oauthServerRouter = Router();

/** Only addresses an assistant could really be waiting at: https, or this machine. */
function acceptableRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return true;
    // Desktop apps sometimes call back on their own scheme, e.g. cursor://.
    return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !['http:', 'javascript:', 'data:', 'file:', 'vbscript:'].includes(u.protocol);
  } catch {
    return false;
  }
}

const registerSchema = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().max(200).optional(),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post', 'client_secret_basic']).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

oauthServerRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.redirect_uris.every(acceptableRedirect)) {
    res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Every redirect address must be https, or on this machine.' });
    return;
  }
  const method = parsed.data.token_endpoint_auth_method ?? 'none';
  const clientId = `pcc_${randomBytes(16).toString('hex')}`;
  const secret = method === 'none' ? null : randomBytes(32).toString('hex');
  const name = (parsed.data.client_name ?? '').trim() || 'An assistant';
  await db('oauth_clients').insert({
    client_id: clientId,
    client_secret_hash: secret ? sha256(secret) : null,
    client_name: name,
    redirect_uris: JSON.stringify(parsed.data.redirect_uris),
  });
  res.status(201).json({
    client_id: clientId,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: parsed.data.redirect_uris,
    token_endpoint_auth_method: method,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
});

interface ClientRow {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string[] | string;
}

async function findClient(clientId: unknown): Promise<ClientRow | undefined> {
  if (typeof clientId !== 'string' || !clientId) return undefined;
  return db('oauth_clients').where({ client_id: clientId }).first();
}

const redirectsOf = (c: ClientRow): string[] => (typeof c.redirect_uris === 'string' ? JSON.parse(c.redirect_uris) : c.redirect_uris);

function plainPage(res: Response, status: number, message: string) {
  res
    .status(status)
    .type('html')
    .send(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PareCare</title>` +
        `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">` +
        `<h1 style="font-size:1.25rem">This connection could not start</h1><p>${message}</p>` +
        `<p>Go back to your assistant and try connecting again. If it keeps happening, remove PareCare there and add it again.</p></body>`
    );
}

/**
 * The assistant sends the person here. Check what we can before involving
 * them, then hand over to the consent screen in the web app, which has
 * their session.
 */
oauthServerRouter.get('/authorize', async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const client = await findClient(q['client_id']);
  if (!client) {
    plainPage(res, 400, 'The assistant did not say who it is, or PareCare does not recognise it.');
    return;
  }
  const redirectUri = q['redirect_uri'] ?? (redirectsOf(client).length === 1 ? redirectsOf(client)[0] : undefined);
  if (!redirectUri || !redirectsOf(client).includes(redirectUri)) {
    plainPage(res, 400, 'The assistant asked to be sent back somewhere it did not register.');
    return;
  }
  const back = (params: Record<string, string>) => {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (q['state']) u.searchParams.set('state', q['state']);
    res.redirect(302, u.toString());
  };
  if (q['response_type'] !== 'code') {
    back({ error: 'unsupported_response_type' });
    return;
  }
  if (!q['code_challenge'] || (q['code_challenge_method'] ?? 'S256') !== 'S256') {
    back({ error: 'invalid_request', error_description: 'PKCE with S256 is required.' });
    return;
  }
  const consent = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: q['code_challenge'],
    ...(q['state'] ? { state: q['state'] } : {}),
  });
  res.redirect(302, `${issuer()}/connect?${consent.toString()}`);
});

/** What the consent screen shows: who is asking. */
oauthServerRouter.get('/client', requireAuth, async (req, res) => {
  const client = await findClient(req.query['client_id']);
  const redirectUri = String(req.query['redirect_uri'] ?? '');
  if (!client || !redirectsOf(client).includes(redirectUri)) {
    res.status(404).json({ error: 'This connection request is not valid any more. Start again from your assistant.', code: 'NOT_FOUND' });
    return;
  }
  let host = '';
  try {
    host = new URL(redirectUri).host;
  } catch {
    host = '';
  }
  res.json({ client_name: client.client_name, redirect_host: host });
});

const approveSchema = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  code_challenge: z.string().min(43).max(128),
  state: z.string().max(2000).optional().nullable(),
  access: z.enum(['full', 'read']).default('full'),
  decision: z.enum(['allow', 'deny']),
});

/**
 * The person clicked Allow or Cancel. Only a real signed-in session may
 * approve: a connected app cannot use its own pass to connect more apps.
 */
oauthServerRouter.post('/approve', requireAuth, async (req, res) => {
  if (req.connectionAccess) {
    res.status(403).json({ error: 'Approve this from PareCare itself.', code: 'FORBIDDEN' });
    return;
  }
  const parsed = approveSchema.safeParse(req.body);
  const client = parsed.success ? await findClient(parsed.data.client_id) : undefined;
  if (!parsed.success || !client || !redirectsOf(client).includes(parsed.data.redirect_uri)) {
    res.status(400).json({ error: 'This connection request is not valid any more. Start again from your assistant.', code: 'VALIDATION_ERROR' });
    return;
  }
  const u = new URL(parsed.data.redirect_uri);
  if (parsed.data.state) u.searchParams.set('state', parsed.data.state);
  if (parsed.data.decision === 'deny') {
    u.searchParams.set('error', 'access_denied');
    res.json({ redirect_to: u.toString() });
    return;
  }
  const code = b64url(randomBytes(32));
  await db('oauth_codes').insert({
    code_hash: sha256(code),
    client_id: client.client_id,
    account_id: req.account!.id,
    redirect_uri: parsed.data.redirect_uri,
    code_challenge: parsed.data.code_challenge,
    access: parsed.data.access,
    expires_at: new Date(Date.now() + CODE_TTL_MS),
  });
  u.searchParams.set('code', code);
  res.json({ redirect_to: u.toString() });
});

function tokenError(res: Response, status: number, error: string, description: string) {
  res.status(status).setHeader('Cache-Control', 'no-store');
  res.json({ error, error_description: description });
}

/** Check the app's own secret, when it registered with one. */
function clientAuthenticates(req: Request, client: ClientRow): boolean {
  if (!client.client_secret_hash) return true;
  let secret = typeof req.body?.client_secret === 'string' ? req.body.client_secret : '';
  const header = req.headers.authorization;
  if (!secret && header?.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i > 0 && decodeURIComponent(decoded.slice(0, i)) === client.client_id) secret = decodeURIComponent(decoded.slice(i + 1));
  }
  if (!secret) return false;
  const a = Buffer.from(sha256(secret));
  const b = Buffer.from(client.client_secret_hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

function basicClientId(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Basic ')) return undefined;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  return i > 0 ? decodeURIComponent(decoded.slice(0, i)) : undefined;
}

async function issuePass(res: Response, row: { id?: string; account_id: string; client: ClientRow; access: string }) {
  const accessToken = `${API_KEY_PREFIX}${randomBytes(24).toString('hex')}`;
  const refreshToken = `pcr_${randomBytes(32).toString('hex')}`;
  const columns = {
    token_hash: hashApiKey(accessToken),
    token_prefix: accessToken.slice(0, 10),
    refresh_token_hash: sha256(refreshToken),
    expires_at: new Date(Date.now() + ACCESS_TTL_S * 1000),
  };
  if (row.id) {
    await db('api_keys').where({ id: row.id }).update(columns);
  } else {
    await db('api_keys').insert({
      account_id: row.account_id,
      label: row.client.client_name.slice(0, 100),
      access: row.access,
      oauth_client_id: row.client.client_id,
      ...columns,
    });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_S,
    refresh_token: refreshToken,
    scope: 'parecare',
  });
}

oauthServerRouter.post('/token', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, string | undefined>;
  const client = await findClient(body['client_id'] ?? basicClientId(req));
  if (!client || !clientAuthenticates(req, client)) {
    tokenError(res, 401, 'invalid_client', 'PareCare does not recognise this app. Connect it again.');
    return;
  }

  if (body['grant_type'] === 'authorization_code') {
    const code = String(body['code'] ?? '');
    const verifier = String(body['code_verifier'] ?? '');
    const row = code ? await db('oauth_codes').where({ code_hash: sha256(code) }).first() : undefined;
    if (!row || row.client_id !== client.client_id || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      tokenError(res, 400, 'invalid_grant', 'That sign-in has expired or was already used. Connect again.');
      return;
    }
    if (body['redirect_uri'] && body['redirect_uri'] !== row.redirect_uri) {
      tokenError(res, 400, 'invalid_grant', 'The sign-in came back to a different address.');
      return;
    }
    if (!verifier || b64url(createHash('sha256').update(verifier).digest()) !== row.code_challenge) {
      tokenError(res, 400, 'invalid_grant', 'The sign-in could not be checked. Connect again.');
      return;
    }
    // Single use, even if two requests race for it.
    const claimed = await db('oauth_codes').where({ code_hash: row.code_hash }).whereNull('used_at').update({ used_at: db.fn.now() });
    if (!claimed) {
      tokenError(res, 400, 'invalid_grant', 'That sign-in was already used. Connect again.');
      return;
    }
    await issuePass(res, { account_id: row.account_id, client, access: row.access });
    return;
  }

  if (body['grant_type'] === 'refresh_token') {
    const token = String(body['refresh_token'] ?? '');
    const key = token
      ? await db('api_keys').where({ refresh_token_hash: sha256(token), oauth_client_id: client.client_id }).whereNull('revoked_at').first()
      : undefined;
    if (!key) {
      tokenError(res, 400, 'invalid_grant', 'This connection was disconnected. Connect again.');
      return;
    }
    await issuePass(res, { id: key.id, account_id: key.account_id, client, access: key.access });
    return;
  }

  tokenError(res, 400, 'unsupported_grant_type', 'Only sign-in codes and renewals are accepted here.');
});

/** An app asking to be disconnected. Always succeeds, as the standard asks. */
oauthServerRouter.post('/revoke', async (req, res) => {
  const token = String((req.body ?? {})['token'] ?? '');
  if (token) {
    const hash = token.startsWith(API_KEY_PREFIX) ? hashApiKey(token) : sha256(token);
    await db('api_keys')
      .where((w) => w.where({ token_hash: hash }).orWhere({ refresh_token_hash: hash }))
      .whereNotNull('oauth_client_id')
      .update({ revoked_at: db.fn.now() });
  }
  res.status(200).end();
});
