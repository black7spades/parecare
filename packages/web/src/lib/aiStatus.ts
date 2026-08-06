import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * Whether Pare is ready to answer. A model on this machine may still be
 * downloading on first run, in which case the app says so plainly rather than
 * failing with a raw error. `local`/`provider` name which assistant is in use,
 * so the one sentence about it is composed here and nowhere else.
 */
export interface AiStatus {
  state: 'preparing' | 'ready' | 'unavailable';
  provider: string;
  local: boolean;
  /** The traffic light: green working well, amber under load or getting ready, red offline. */
  health: 'green' | 'amber' | 'red';
}

export function useAiStatus(enabled = true) {
  return useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<AiStatus>('/ai/status'),
    enabled,
    // Poll fast while a model is still downloading; otherwise keep a slow
    // heartbeat so the status light reflects load without hammering the server.
    refetchInterval: (query) => (query.state.data?.state === 'preparing' ? 5000 : 30000),
    staleTime: 5000,
  });
}

/** The plain sentence to show while a model is still getting ready. */
export const AI_WARMING_MESSAGE = 'Pare is still getting ready. Everything else works in the meantime.';
