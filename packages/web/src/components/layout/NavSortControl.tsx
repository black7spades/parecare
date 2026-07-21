import { useEffect, useRef, useState } from 'react';
import { CheckIcon, SortIcon } from '../ui/icons';

export interface SortOption<V extends string = string> {
  value: V;
  label: string;
}

/**
 * A compact, theme-aware "arrange" dropdown for a nav group heading. It is a
 * custom popover rather than a native <select> so the menu is painted with the
 * app's own tokens (bg-card, text-ink, border-border); those flip with the
 * `dark` class, so the control renders correctly in light, dark and
 * follow-the-device modes without a separate asset. A tick marks the active
 * option. Sanctioned as an icon-only control by the style guide (a nav sort
 * indicator), always with an aria-label.
 */
export function NavSortControl<V extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: V;
  options: SortOption<V>[];
  onChange: (v: V) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="p-1 rounded text-muted hover:text-ink hover:bg-surface-2 transition-colors"
      >
        <SortIcon size={13} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-44 rounded-md border border-border bg-card shadow-lg py-1"
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs normal-case tracking-normal transition-colors ${
                  active ? 'text-ink font-medium' : 'text-muted hover:text-ink hover:bg-surface-2'
                }`}
              >
                <span className="w-3.5 shrink-0 text-primary" aria-hidden>
                  {active ? <CheckIcon /> : null}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
