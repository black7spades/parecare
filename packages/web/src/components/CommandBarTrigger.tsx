import { useCommandBar } from '../stores/commandBar';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/**
 * The top-bar entry to the command bar. On a wide screen it is a labelled
 * button in the centre with the keyboard hint; on a phone, where there was no
 * switcher at all, it is a full-width pill. Both open the one bar.
 */
export function CommandBarTrigger({ variant }: { variant: 'desktop' | 'phone' }) {
  const setOpen = useCommandBar((s) => s.setOpen);
  const shape = variant === 'phone' ? 'rounded-full' : 'rounded-md';
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="Find or do anything"
      aria-label="Find or do anything"
      className={`w-full flex items-center gap-2 ${shape} border border-border bg-surface px-3 py-1.5 text-sm text-muted hover:bg-surface-2 transition-colors`}
    >
      <SearchGlyph />
      <span className="flex-1 truncate text-left">Find or do anything</span>
      {variant === 'desktop' ? (
        <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      ) : null}
    </button>
  );
}
