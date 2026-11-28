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
  /** The traffic light: green working well, amber under load, getting ready or on the backup, red offline. */
  health: 'green' | 'amber' | 'red';
  /** Whether Pare is answering from its backup service because the main one is not answering. */
  backup: boolean;
}

/** The backup service as the system screens describe it. */
export interface AiBackupStatus {
  /** The backup chosen, or null when none is set up. */
  provider: string | null;
  model: string | null;
  /** Whether the backup runs on this machine. */
  local: boolean;
  /** Whether Pare is answering from the backup right now. */
  in_use: boolean;
  /** When the main service stopped answering, while the backup is in use. */
  since: string | null;
}

/** Each AI service by the name a person would know it by. */
const SERVICE_NAMES: Record<string, string> = {
  anthropic: 'Claude, from Anthropic',
  openai: 'OpenAI',
  google: 'Gemini, from Google',
  ollama: 'the model on this machine',
  lmstudio: 'LM Studio on this machine',
  'openai-compatible': 'your own AI server',
};

export function serviceName(provider: string | null | undefined): string {
  if (!provider) return 'none';
  return SERVICE_NAMES[provider] ?? provider;
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

/**
 * Whether Pare can be offered at all. When no assistant is attached, every
 * Pare button is hidden and the plain way to do the same thing shows in its
 * place. Until the status has loaded, Pare is not offered, so nobody taps a
 * button that then says it is not set up.
 */
export function usePareOn(): boolean {
  const { data } = useAiStatus();
  return !!data && data.state !== 'unavailable';
}
