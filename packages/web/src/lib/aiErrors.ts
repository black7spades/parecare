import { ApiError } from '../api/client';
import { AI_WARMING_MESSAGE } from './aiStatus';

export function describeAiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 402) return 'The AI assistant requires an upgraded plan.';
    // A model on this machine that has not finished downloading is not a
    // fault; say it is still getting ready, in the same words as elsewhere.
    if (err.code === 'AI_MODEL_PREPARING') return AI_WARMING_MESSAGE;
    if (err.code === 'AI_NOT_CONFIGURED' || /api key/i.test(err.message)) {
      return 'Pare is switched off here, so this was not done. Everything else works without it.';
    }
    return err.message;
  }
  return 'Something went wrong talking to the assistant.';
}
