import { create } from 'zustand';

/**
 * Deleting with Undo instead of "are you sure". A delete is held back for a
 * few seconds: the rows vanish from the list at once, a bar offers Undo, and
 * only when the time runs out is the delete sent. Undo simply puts the rows
 * back. Works for every kind of record without any of them needing a way to
 * restore from the server.
 */

const HOLD_MS = 8000;

interface PendingDelete {
  key: number;
  message: string;
  ids: string[];
  commit: () => Promise<unknown>;
  onCommitted?: () => void;
  timer: number;
}

interface UndoState {
  pending: PendingDelete | null;
  hidden: Set<string>;
  error: string;
  deferDelete: (d: { message: string; ids: string[]; commit: () => Promise<unknown>; onCommitted?: () => void }) => void;
  undo: () => void;
  flush: () => void;
  clearError: () => void;
}

let nextKey = 1;

export const useUndoStore = create<UndoState>((set, get) => {
  const send = (p: PendingDelete) => {
    window.clearTimeout(p.timer);
    p.commit()
      .then(() => p.onCommitted?.())
      .catch(() => {
        set({ error: `${p.message.replace(/\.$/, '')} did not go through, so it is back in the list. Try again in a moment.` });
      })
      .finally(() => {
        set((s) => {
          const hidden = new Set(s.hidden);
          for (const id of p.ids) hidden.delete(id);
          return { hidden };
        });
      });
  };

  return {
    pending: null,
    hidden: new Set(),
    error: '',
    deferDelete: (d) => {
      // A second delete sends the first straight away; only one Undo at a time.
      const prev = get().pending;
      if (prev) send(prev);
      const key = nextKey++;
      const timer = window.setTimeout(() => {
        const p = get().pending;
        if (p && p.key === key) {
          set({ pending: null });
          send(p);
        }
      }, HOLD_MS);
      set((s) => {
        const hidden = new Set(s.hidden);
        for (const id of d.ids) hidden.add(id);
        return { pending: { ...d, key, timer }, hidden, error: '' };
      });
    },
    undo: () => {
      const p = get().pending;
      if (!p) return;
      window.clearTimeout(p.timer);
      set((s) => {
        const hidden = new Set(s.hidden);
        for (const id of p.ids) hidden.delete(id);
        return { pending: null, hidden };
      });
    },
    flush: () => {
      const p = get().pending;
      if (!p) return;
      set({ pending: null });
      send(p);
    },
    clearError: () => set({ error: '' }),
  };
});

// Leaving the page sends anything still waiting, so a delete is never lost.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => useUndoStore.getState().flush());
}

/** Rows held back by a pending delete, to leave out of a list. */
export function useHiddenIds(): Set<string> {
  return useUndoStore((s) => s.hidden);
}
