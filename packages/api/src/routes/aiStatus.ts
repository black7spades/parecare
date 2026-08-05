import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getAiConfig } from '../config/settings';
import { localModelState, isLocalProvider } from '../services/aiProvider';

export const aiStatusRouter = Router();

/**
 * Whether Pare is ready, so the app can say "still getting ready" instead of
 * failing with a raw error while a model on this machine is still downloading.
 * Polled by the assistant and the Homeboard, so the answer is cached briefly.
 * The web turns `provider`/`local` into the one plain sentence about which
 * assistant is in use, so that copy stays in one place.
 */
interface AiStatusBody {
  state: 'preparing' | 'ready' | 'unavailable';
  provider: string;
  local: boolean;
}

let cache: { at: number; body: AiStatusBody } | null = null;
const TTL_MS = 8000;

aiStatusRouter.get('/status', requireAuth, async (_req, res) => {
  if (cache && Date.now() - cache.at < TTL_MS) {
    res.json(cache.body);
    return;
  }
  const cfg = getAiConfig();
  const body: AiStatusBody = {
    state: await localModelState(),
    provider: cfg.provider,
    local: isLocalProvider(),
  };
  cache = { at: Date.now(), body };
  res.json(body);
});
