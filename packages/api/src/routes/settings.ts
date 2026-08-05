import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { SETTING_GROUPS } from '../config/settingsCatalog';
import { describeSettings, updateSettings } from '../config/settings';
import { getAiConfig } from '../config/settings';
import { complete, isAiConfigured, isLocalProvider, localModelState } from '../services/aiProvider';
import { listInstalledModels, matchesModel, startPull, getPullState, normalizeModelRef } from '../services/ollamaModels';
import { z } from 'zod';
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

/**
 * What assistant is running, what it is called, and (for the on-machine
 * assistant) which models are downloaded and whether a download is in
 * progress. This is what the settings screen shows so a super admin can see
 * and change the model without touching compose or the environment.
 */
settingsRouter.get('/ai/model', async (_req, res) => {
  const cfg = getAiConfig();
  const local = isLocalProvider();
  const active = cfg.model ?? (local ? 'parecare' : '');
  // One call to the local server: derive both the active model's details and
  // whether it is ready from the installed list, rather than asking three times.
  const installed = local ? await listInstalledModels() : [];
  const activeDetails = local ? installed.find((m) => matchesModel(m.name, active)) ?? null : null;
  const state = local ? (activeDetails ? 'ready' : 'preparing') : await localModelState();
  res.json({
    provider: cfg.provider,
    local,
    active,
    activeDetails,
    mediationModel: cfg.mediationModel ?? '',
    state,
    installed,
    pull: getPullState(),
  });
});

/**
 * Start downloading a model for the on-machine assistant. Accepts a plain model
 * name or a Hugging Face link. Returns at once with the download state; the
 * screen polls GET /ai/model for progress.
 */
settingsRouter.post('/ai/model/pull', (req, res) => {
  const parsed = z.object({ model: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a model name or a Hugging Face link.', code: 'BAD_REQUEST' });
    return;
  }
  try {
    const ref = normalizeModelRef(parsed.data.model);
    const pull = startPull(ref);
    res.status(202).json({ pull });
  } catch (err) {
    const e = err as { status?: number; code?: string; message?: string };
    res.status(e.status ?? 500).json({ error: e.message ?? 'Could not start the download', code: e.code ?? 'ERROR' });
  }
});
