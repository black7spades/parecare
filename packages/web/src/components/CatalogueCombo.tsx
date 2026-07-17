import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * A dropdown backed by a shared catalogue endpoint: typing filters the
 * established list, and anything not listed yet can be picked as typed
 * (it joins the catalogue when saved, so it is offered to everyone from
 * then on). Replaces free-text boxes wherever values should come from a
 * source database.
 */
export function CatalogueCombo({
  endpoint,
  ariaLabel,
  placeholder,
  exclude = [],
  onPick,
  allowNew = true,
  keepValue = false,
  initial = '',
  widthClass = 'w-48',
}: {
  /** Catalogue URL, e.g. "/option-catalogue?category=allergen". */
  endpoint: string;
  ariaLabel: string;
  placeholder?: string;
  /** Values already in use, kept out of the suggestions. */
  exclude?: string[];
  onPick: (name: string) => void;
  /** Offer adding the typed value when it is not listed. */
  allowNew?: boolean;
  /** Keep the picked value in the box (for edit-in-place) instead of clearing. */
  keepValue?: boolean;
  initial?: string;
  widthClass?: string;
}) {
  const [search, setSearch] = useState(initial);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['catalogue', endpoint, search],
    queryFn: () =>
      api.get<{ items: { id: string; name: string }[] }>(
        `${endpoint}${endpoint.includes('?') ? '&' : '?'}search=${encodeURIComponent(search.trim())}`
      ),
    enabled: open,
  });
  const excluded = new Set(exclude.map((v) => v.toLowerCase()));
  const suggestions = (data?.items ?? []).filter((s) => !excluded.has(s.name.toLowerCase())).slice(0, 8);
  const trimmed = search.trim();
  const exactMatch = suggestions.some((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  const options = [
    ...suggestions.map((s) => s.name),
    ...(allowNew && trimmed && !exactMatch && !excluded.has(trimmed.toLowerCase()) ? [trimmed] : []),
  ];

  useEffect(() => {
    setHighlight(0);
  }, [search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pick = (name: string) => {
    if (!name.trim()) return;
    onPick(name.trim());
    setSearch(keepValue ? name.trim() : '');
    setOpen(false);
  };

  return (
    <div className={`relative ${widthClass}`} ref={boxRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
          // In edit-in-place mode the typed text IS the value: correcting a
          // misspelt name must stick even when no suggestion is clicked.
          if (keepValue) onPick(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (options[highlight]) pick(options[highlight]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && options.length > 0 ? (
        <ul className="absolute left-0 top-full mt-1 w-64 max-h-56 overflow-y-auto rounded-md border border-border bg-card shadow-lg z-20">
          {options.map((name, i) => {
            const isNew = i >= suggestions.length;
            return (
              <li key={`${name}-${isNew}`}>
                <button
                  type="button"
                  className={`w-full text-left px-3 py-1.5 text-sm ${i === highlight ? 'bg-primary-50 text-primary' : 'text-ink hover:bg-surface-2'}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(name)}
                >
                  {isNew ? `Add "${name}"` : name}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A multi-valued field shown as removable chips with a catalogue-backed
 * dropdown to add more. One field, many values of the same kind.
 */
export function OptionChips({
  label,
  category,
  values,
  onChange,
  canEdit,
  addLabel,
}: {
  label: string;
  category: string;
  values: string[];
  onChange: (values: string[]) => void;
  canEdit: boolean;
  addLabel?: string;
}) {
  return (
    <div>
      <span className="block text-sm font-medium text-ink mb-1">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {values.map((v) => (
          <span key={v} className="badge bg-surface-2 text-ink text-xs flex items-center gap-1">
            {v}
            {canEdit ? (
              <button
                type="button"
                aria-label={`Remove ${v}`}
                className="text-muted hover:text-red-600"
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                ✕
              </button>
            ) : null}
          </span>
        ))}
        {values.length === 0 && !canEdit ? <span className="text-sm text-muted">None recorded.</span> : null}
        {canEdit ? (
          <CatalogueCombo
            endpoint={`/option-catalogue?category=${category}`}
            ariaLabel={`Add to ${label.toLowerCase()}`}
            placeholder={addLabel ?? 'Add…'}
            exclude={values}
            onPick={(name) => {
              if (!values.includes(name)) onChange([...values, name]);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
