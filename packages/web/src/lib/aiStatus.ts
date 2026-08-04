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
}

export function useAiStatus(enabled = true) {
  return useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<AiStatus>('/ai/status'),
    enabled,
    // Poll while a model is still downloading; stop once it is ready.
    refetchInterval: (query) => (query.state.data?.state === 'preparing' ? 5000 : false),
    staleTime: 5000,
  });
}

/** The plain sentence to show while a model is still getting ready. */
export const AI_WARMING_MESSAGE = 'Pare is still getting ready. Everything else works in the meantime.';

/**
 * The one plain sentence naming which assistant is in use, or null when there
 * is nothing worth saying (the usual cloud or already-known case).
 */
export function assistantNotice(status: AiStatus | undefined): string | null {
  if (!status) return null;
  if (status.local) return 'PareCare is using the assistant on this machine. It is slower, and nothing leaves here.';
  if (status.provider === 'anthropic') return 'PareCare is using Claude. It is faster, and records are sent to Anthropic to be read.';
  return null;
}
