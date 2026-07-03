import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { SETTING_GROUPS } from '../config/settingsCatalog';
import { describeSettings, updateSettings } from '../config/settings';
import { getAiConfig } from '../config/settings';
import { complete, isAiConfigured } from '../services/aiProvider';
import { sendTestEmail } from '../services/email';

/**
 * Super-admin runtime configuration. Reads never expose secret values (only
 * whether they are set); writes accept a partial map of catalog keys, with an
 * empty string or null clearing an override back to the environment default.
 */
export const settingsRouter = Router();

settingsRouter.use(requireAuth, requireRole('super_admin'));

settingsRouter.get('/', (_req, res) => {
  const fields = describeSettings();
  const groups = SETTING_GROUPS.map((group) => ({
    group,
    fields: fields.filter((f) => f.group === group),
  }));
  res.json({ groups });
});

settingsRouter.patch('/', async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Expected an object of setting keys to values', code: 'BAD_REQUEST' });
    return;
  }
  await updateSettings(body, req.account?.id ?? null);
  const fields = describeSettings();
  const groups = SETTING_GROUPS.map((group) => ({
    group,
    fields: fields.filter((f) => f.group === group),
  }));
  res.json({ groups });
});

settingsRouter.post('/test-email', async (req, res) => {
  const to = req.account?.email;
  if (!to) {
    res.status(400).json({ error: 'No email on the current account', code: 'BAD_REQUEST' });
    return;
  }
  try {
    await sendTestEmail(to);
    res.json({ ok: true, sentTo: to });
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to send test email' });
  }
});

settingsRouter.post('/test-ai', async (_req, res) => {
  if (!isAiConfigured()) {
    res.json({ ok: false, error: 'The AI assistant is not configured yet.' });
    return;
  }
  try {
    const { text } = await complete(
      'You are a connection test. Reply with a single short sentence.',
      [{ role: 'user', content: 'Say hello so I know the connection works.' }],
      64,
      'chat'
    );
    res.json({ ok: true, provider: getAiConfig().provider, sample: text.slice(0, 200) });
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : 'AI request failed' });
  }
});
