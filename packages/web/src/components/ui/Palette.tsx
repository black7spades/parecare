import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A command-palette surface: a search field over grouped, keyboard-navigable
 * rows. The profile switcher's proven listbox behaviour (arrow keys, Enter,
 * Escape, highlight reset, outside-click) lives here now, with the things it
 * lacked: a portal, a focus trap, focus restored to wherever you were, and its
 * own Escape handling. Deliberately not built on Modal, whose document-level
 * Escape closes every dialog at once and whose title id collides when two are
 * open.
 */
export interface PaletteItem {
  id: string;
  content: ReactNode;
  onSelect: () => void;
}

export interface PaletteGroup {
  key: string;
  heading?: string;
  items: PaletteItem[];
}

interface PaletteProps {
  open: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  placeholder?: string;
  groups: PaletteGroup[];
  /** Shown when there are no rows at all. */
  empty?: ReactNode;
  /** A quiet hint row beneath the list. */
  footer?: ReactNode;
  /** Names the dialog and its field for a screen reader. */
  label: string;
}

export function Palette({ open, onClose, query, onQueryChange, placeholder, groups, empty, footer, label }: PaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [highlight, setHighlight] = useState(0);

  // Every selectable row, flattened across groups, for keyboard movement.
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Remember what had focus, focus the field on open, put focus back on close.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      restoreRef.current?.focus?.();
    };
  }, [open]);

  // Reset the highlight whenever the result set changes.
  useEffect(() => {
    setHighlight(0);
  }, [query, items.length]);

  // Keep the highlighted row in view as it moves.
  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-pi="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  if (!open) return null;

  const move = (delta: number) => {
    if (items.length === 0) return;
    setHighlight((h) => (h + delta + items.length) % items.length);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); items[highlight]?.onSelect(); }
    else if (e.key === 'Tab') { e.preventDefault(); inputRef.current?.focus(); }
  };

  let flatIndex = -1;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 px-4 pt-[12vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
      >
        <div className="border-b border-border p-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={label}
            aria-autocomplete="list"
            enterKeyHint="go"
            className="w-full rounded-md bg-surface px-3 py-2 text-sm text-ink placeholder-muted focus:outline-none"
          />
        </div>
        <div ref={listRef} role="listbox" aria-label={label} className="max-h-[55vh] overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted">{empty ?? 'Nothing matches that.'}</div>
          ) : (
            groups.map((g) =>
              g.items.length === 0 ? null : (
                <div key={g.key}>
                  {g.heading ? (
                    <p className="px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted">{g.heading}</p>
                  ) : null}
                  {g.items.map((it) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    return (
                      <div
                        key={it.id}
                        data-pi={idx}
                        role="option"
                        aria-selected={idx === highlight}
                        onMouseEnter={() => setHighlight(idx)}
                        onMouseDown={(e) => { e.preventDefault(); it.onSelect(); }}
                        className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm ${idx === highlight ? 'bg-surface-2' : ''}`}
                      >
                        {it.content}
                      </div>
                    );
                  })}
                </div>
              ),
            )
          )}
        </div>
        {footer ? <div className="border-t border-border px-3 py-1.5 text-xs text-muted">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
