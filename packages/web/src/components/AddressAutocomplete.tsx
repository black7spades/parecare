import { useEffect, useRef, useState } from 'react';

interface Suggestion {
  place_id: number;
  display_name: string;
}

interface AddressAutocompleteProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function AddressAutocomplete({ label, value, onChange, placeholder = 'Start typing an address…' }: AddressAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputId = label?.toLowerCase().replace(/\s+/g, '-');

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = (q: string) => {
    clearTimeout(debounceRef.current);
    if (q.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: q.trim(), format: 'json', addressdetails: '0', limit: '6' });
        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
          signal: controller.signal,
          headers: { 'Accept-Language': navigator.language },
        });
        if (!res.ok) return;
        const data: Suggestion[] = await res.json();
        setSuggestions(data);
        setHighlight(0);
      } catch {
        // aborted or network error
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    setSuggestions([]);
  };

  return (
    <div ref={boxRef} className="relative">
      {label ? (
        <label htmlFor={inputId} className="block text-sm font-medium text-ink mb-1">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-label={label}
        autoComplete="off"
        placeholder={placeholder}
        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder-muted shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          search(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && open && suggestions[highlight]) {
            e.preventDefault();
            pick(suggestions[highlight].display_name);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && suggestions.length > 0 ? (
        <ul className="absolute left-0 top-full mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-border bg-card shadow-lg z-20">
          {suggestions.map((s, i) => (
            <li key={s.place_id}>
              <button
                type="button"
                className={`w-full text-left px-3 py-1.5 text-sm ${i === highlight ? 'bg-primary-50 text-primary' : 'text-ink hover:bg-surface-2'}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(s.display_name)}
              >
                {s.display_name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {loading && open ? (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      ) : null}
    </div>
  );
}
