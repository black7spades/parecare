import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getAiConfig } from '../config/settings';
import { localModelState, isLocalProvider } from '../services/aiProvider';
import { health, type Health } from '../services/aiMetrics';

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
  /** The traffic light: green working well, amber under load or getting ready, red offline. */
  health: Health;
}

// The reachability half is cached; the health half is recomputed each time from
// the live in-memory metrics, so the traffic light reacts to load without a lag.
let cache: { at: number; state: AiStatusBody['state']; provider: string; local: boolean } | null = null;
const TTL_MS = 8000;

aiStatusRouter.get('/status', requireAuth, async (_req, res) => {
  if (!cache || Date.now() - cache.at >= TTL_MS) {
    const cfg = getAiConfig();
    cache = { at: Date.now(), state: await localModelState(), provider: cfg.provider, local: isLocalProvider() };
  }
  res.json({ state: cache.state, provider: cache.provider, local: cache.local, health: health(cache.state) });
});
