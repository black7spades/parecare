import { useUndoStore } from '../stores/undo';
import { Button } from './ui/Button';

/** The bar that offers Undo after a delete, and says so if a delete failed. */
export function UndoBar() {
  const pending = useUndoStore((s) => s.pending);
  const error = useUndoStore((s) => s.error);
  const undo = useUndoStore((s) => s.undo);
  const clearError = useUndoStore((s) => s.clearError);
  if (!pending && !error) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2" role="status" aria-live="polite">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-xl">
        {pending ? (
          <>
            <span className="flex-1 text-sm text-ink">{pending.message}</span>
            <Button size="sm" variant="secondary" onClick={undo}>Undo</Button>
          </>
        ) : (
          <>
            <span className="flex-1 text-sm text-red-600">{error}</span>
            <Button size="sm" variant="ghost" onClick={clearError}>Dismiss</Button>
          </>
        )}
      </div>
    </div>
  );
}
