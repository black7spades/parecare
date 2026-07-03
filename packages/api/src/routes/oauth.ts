import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/database';
import { env } from '../config/env';
import { getOAuthConfig } from '../config/settings';
import { accountSummary, issueMfaToken, issueSessionToken } from './auth';
import type { Account } from '../types';

/**
 * Google / Facebook sign-in via the standard OAuth authorization-code flow,
 * implemented directly (no passport). Providers are enabled by setting
 * GOOGLE_CLIENT_ID/SECRET or FACEBOOK_APP_ID/SECRET.
 *
 * Super admins must sign in with email + password: OAuth sign-in is refused
 * for super admin accounts and for the configured SUPER_ADMIN_EMAIL.
 */
export const oauthRouter = Router();

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  scope: string;
  fetchProfile: (accessToken: string) => Promise<{ subject: string; email: string | null; name: string }>;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: () => getOAuthConfig().googleClientId,
    clientSecret: () => getOAuthConfig().googleClientSecret,
    scope: 'openid email profile',
    fetchProfile: async (accessToken) => {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Google profile fetch failed (${res.status})`);
      const data = (await res.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string };
      return {
        subject: data.sub,
        email: data.email_verified ? (data.email ?? null) : null,
        name: data.name ?? 'Google user',
      };
    },
  },
  facebook: {
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    clientId: () => getOAuthConfig().facebookAppId,
    clientSecret: () => getOAuthConfig().facebookAppSecret,
    scope: 'email public_profile',
    fetchProfile: async (accessToken) => {
      const res = await fetch(
        `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`
      );
      if (!res.ok) throw new Error(`Facebook profile fetch failed (${res.status})`);
      const data = (await res.json()) as { id: string; name?: string; email?: string };
      return { subject: data.id, email: data.email ?? null, name: data.name ?? 'Facebook user' };
    },
  },
};

function redirectUri(provider: string): string {
  return `${env.APP_URL}/api/v1/auth/oauth/${provider}/callback`;
}

function frontendRedirect(fragment: string): string {
  return `${env.APP_URL}/auth/callback#${fragment}`;
}

// Step 1: send the user to the provider's consent screen
oauthRouter.get('/oauth/:provider', (req, res) => {
  const provider = PROVIDERS[req.params['provider']];
  const name = req.params['provider'];
  if (!provider || !provider.clientId() || !provider.clientSecret()) {
    res.status(404).json({ error: 'Sign-in provider not configured', code: 'NOT_FOUND' });
    return;
  }
  // Short-lived signed state guards the callback against forgery
  const state = jwt.sign({ purpose: 'oauth_state', provider: name }, env.JWT_SECRET, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id: provider.clientId()!,
    redirect_uri: redirectUri(name),
    response_type: 'code',
    scope: provider.scope,
    state,
  });
  res.redirect(`${provider.authUrl}?${params.toString()}`);
});

// Step 2: the provider sends the user back with a one-time code
oauthRouter.get('/oauth/:provider/callback', async (req, res) => {
  const name = req.params['provider'] as 'google' | 'facebook';
  const provider = PROVIDERS[name];
  if (!provider || !provider.clientId() || !provider.clientSecret()) {
    res.redirect(frontendRedirect('error=provider_not_configured'));
    return;
  }

  try {
    const state = String(req.query['state'] ?? '');
    const payload = jwt.verify(state, env.JWT_SECRET) as { purpose?: string; provider?: string };
    if (payload.purpose !== 'oauth_state' || payload.provider !== name) throw new Error('state mismatch');
  } catch {
    res.redirect(frontendRedirect('error=invalid_state'));
    return;
  }

  const code = String(req.query['code'] ?? '');
  if (!code) {
    res.redirect(frontendRedirect('error=cancelled'));
    return;
  }

  let profile: { subject: string; email: string | null; name: string };
  try {
    const tokenRes = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: provider.clientId()!,
        client_secret: provider.clientSecret()!,
        redirect_uri: redirectUri(name),
        grant_type: 'authorization_code',
        code,
      }).toString(),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) throw new Error('no access token in response');
    profile = await provider.fetchProfile(tokenData.access_token);
  } catch (err) {
    console.warn(`OAuth ${name} sign-in failed:`, (err as Error).message);
    res.redirect(frontendRedirect('error=provider_error'));
    return;
  }

  if (!profile.email) {
    // We key family invitations and the super admin rule on email
    res.redirect(frontendRedirect('error=no_email'));
    return;
  }
  const email = profile.email.toLowerCase();

  // The super admin signs in with email + password only
  if (env.SUPER_ADMIN_EMAIL === email) {
    res.redirect(frontendRedirect('error=super_admin_password_only'));
    return;
  }

  // Already linked to this provider identity?
  let account = await db<Account>('accounts')
    .where({ oauth_provider: name, oauth_subject: profile.subject })
    .first();

  if (!account) {
    const byEmail = await db<Account>('accounts').whereRaw('lower(email) = ?', [email]).first();
    if (byEmail) {
      if (byEmail.role === 'super_admin') {
        res.redirect(frontendRedirect('error=super_admin_password_only'));
        return;
      }
      if (byEmail.oauth_provider && byEmail.oauth_provider !== name) {
        res.redirect(frontendRedirect(`error=linked_to_${byEmail.oauth_provider}`));
        return;
      }
      // Same verified email — link the provider to the existing account
      await db('accounts')
        .where({ id: byEmail.id })
        .update({ oauth_provider: name, oauth_subject: profile.subject, updated_at: db.fn.now() });
      account = { ...byEmail, oauth_provider: name, oauth_subject: profile.subject };
    } else {
      const [created] = await db<Account>('accounts')
        .insert({
          email,
          password_hash: null,
          display_name: profile.name,
          role: 'user',
          oauth_provider: name,
          oauth_subject: profile.subject,
        })
        .returning('*');
      account = created;
    }
  }

  if (account.mfa_enabled) {
    res.redirect(frontendRedirect(`mfa_token=${encodeURIComponent(issueMfaToken(account.id))}`));
    return;
  }
  res.redirect(frontendRedirect(`token=${encodeURIComponent(issueSessionToken(account.id))}`));
});
