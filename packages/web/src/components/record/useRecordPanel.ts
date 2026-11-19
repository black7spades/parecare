import { useCallback, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/** Clicks on these inside a row do their own thing and never open the record. */
const INTERACTIVE = 'button, a, input, select, textarea, label, summary, [role="button"], [data-no-open]';

/**
 * Makes every row of a list open its record in the record panel.
 *
 * The open record lives in the address as ?record=<id>, so the back button
 * closes it and a link opens straight to it. Spread rowProps(id) onto a row:
 * a click anywhere that is not already a control opens the record, and Enter
 * does the same from the keyboard.
 */
export function useRecordPanel<T>(rows: T[], getId: (row: T) => string) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  // Where in the browser's history the list was when this panel opened it,
  // so closing only steps back when that lands on the list itself.
  const openedAt = useRef<number | null>(null);
  const openId = params.get('record');
  const current = openId ? rows.find((r) => getId(r) === openId) ?? null : null;

  const open = useCallback(
    (id: string) => {
      // Already open (a second click): swap the record in place rather than
      // stacking another step that Close would have to undo.
      const alreadyOpen = new URLSearchParams(window.location.search).has('record');
      if (!alreadyOpen) openedAt.current = historyIndex();
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('record', id);
        return next;
      }, { replace: alreadyOpen });
    },
    [setParams]
  );

  const close = useCallback(() => {
    // Opened from this list and nothing has happened since: step back, so
    // Back after closing leaves the page. If anything else was opened from
    // inside the panel, stepping back would only reopen a record, so the
    // panel is closed where it stands instead.
    const at = openedAt.current;
    openedAt.current = null;
    const now = historyIndex();
    if (at !== null && now !== null && now === at + 1) {
      navigate(-1);
      return;
    }
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('record');
        return next;
      },
      { replace: true }
    );
  }, [navigate, setParams]);

  const rowProps = useCallback(
    (id: string) => ({
      onClick: (e: MouseEvent<HTMLElement>) => {
        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
        if (window.getSelection()?.toString()) return; // selecting text, not opening
        open(id);
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) open(id);
      },
      tabIndex: 0,
      'data-record-row': '',
    }),
    [open]
  );

  return { current, openId, open, close, rowProps };
}

/** React Router's position in the browser history, when it is known. */
function historyIndex(): number | null {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : null;
}

/** The class a clickable row gets, so it reads as something to open. */
export const RECORD_ROW_CLASS = 'cursor-pointer hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2';
