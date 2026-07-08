import { ApiError } from '../api/client';

export function describeAiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 402) return 'The AI assistant requires an upgraded plan.';
    if (err.code === 'AI_NOT_CONFIGURED' || /api key/i.test(err.message)) {
      return 'The AI assistant is not configured on this server. Ask the admin to set AI_PROVIDER (Anthropic, OpenAI, Gemini, Ollama, or LM Studio).';
    }
    return err.message;
  }
  return 'Something went wrong talking to the assistant.';
}
