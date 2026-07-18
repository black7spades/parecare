import { ApiError } from '../api/client';
import { Button } from './ui/Button';

/**
 * Shown when the message tone guard asks for a revision on any communications
 * surface (messages, questions, memory book). It states the reason kindly and,
 * where the guard offered one, a calm rewrite the person can use or work from.
 */

export interface ToneBlock {
  reason: string;
  suggestion: string;
}

/** Pull a tone-guard block out of a failed request, or null if it was not one. */
export function extractToneBlock(err: unknown): ToneBlock | null {
  if (err instanceof ApiError && err.code === 'TONE_REVISION_NEEDED') {
    return {
      reason: String(err.data?.['reason'] ?? err.message),
      suggestion: String(err.data?.['suggestion'] ?? ''),
    };
  }
  return null;
}

export function ToneBlockNotice({
  careName,
  block,
  onUseRewrite,
  onDismiss,
}: {
  careName: string;
  block: ToneBlock;
  /** Provide only where a single field can take the rewrite (e.g. a message). */
  onUseRewrite?: (text: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-500/40 dark:bg-amber-900/20">
      <p className="font-medium text-amber-800 dark:text-amber-200">Let's keep this focused on {careName}'s care</p>
      <p className="mt-0.5 text-amber-800/90 dark:text-amber-100/90">{block.reason}</p>
      {block.suggestion ? (
        <div className="mt-2 rounded border border-amber-200 bg-white/70 px-2.5 py-2 text-ink dark:border-amber-500/30 dark:bg-black/20">
          <p className="text-[11px] uppercase tracking-wide text-muted mb-1">Suggested rewrite</p>
          <p className="whitespace-pre-wrap">{block.suggestion}</p>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {block.suggestion && onUseRewrite ? (
          <Button size="xs" variant="secondary" onClick={() => onUseRewrite(block.suggestion)}>
            Use this rewrite
          </Button>
        ) : null}
        <Button size="xs" variant="ghost" onClick={onDismiss}>
          {onUseRewrite ? 'Edit my message' : 'OK, I will edit it'}
        </Button>
      </div>
    </div>
  );
}
