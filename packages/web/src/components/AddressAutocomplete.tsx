import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

/** The structured pieces a picked address breaks into, each its own field. */
export interface StructuredAddress {
  line1: string;
  line2: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
}

interface Suggestion {
  place_id: number | string;
  display_name: string;
  address?: Record<string, string>;
  /** A place already in the person's own directory, with its parts ready. */
  fromDirectory?: StructuredAddress;
  /** Found only outside the person's own country. */
  elsewhere?: boolean;
}

interface DirectoryPlace {
  id: string;
  name: string;
  address: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  address_suburb?: string | null;
  address_state?: string | null;
  address_postcode?: string | null;
  address_country?: string | null;
}

/**
 * The country to look in first, from the browser's language setting
 * ("en-AU" means Australia), so a search for a local clinic is not buried
 * under places of the same name overseas.
 */
function homeCountry(): string | null {
  const tags = [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  for (const t of tags) {
    const region = t.split('-')[1];
    if (region && /^[A-Za-z]{2}$/.test(region)) return region.toLowerCase();
  }
  return null;
}

/** Places already filed with an address: found here before the map is asked. */
async function searchDirectory(q: string): Promise<Suggestion[]> {
  try {
    const res = await api.get<{ providers: DirectoryPlace[] }>(`/providers/search?q=${encodeURIComponent(q)}`);
    // The place whose name best matches comes first, and each address once:
    // the doctors at a hub share its address, so the hub stands for them.
    const needle = q.toLowerCase();
    const rank = (n: string) => (n.toLowerCase() === needle ? 0 : n.toLowerCase().startsWith(needle) ? 1 : n.toLowerCase().includes(needle) ? 2 : 3);
    const seen = new Set<string>();
    return res.providers
      .filter((p) => p.address)
      .sort((a, b) => rank(a.name) - rank(b.name))
      .filter((p) => {
        const key = (p.address ?? '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4)
      .map((p) => ({
        place_id: `dir-${p.id}`,
        display_name: `${p.name}, ${p.address}`,
        fromDirectory: {
          line1: p.address_line1 ?? '',
          line2: p.address_line2 ?? '',
          suburb: p.address_suburb ?? '',
          state: p.address_state ?? '',
          postcode: p.address_postcode ?? '',
          country: p.address_country ?? '',
        },
      }));
  } catch {
    return [];
  }
}

async function searchMap(q: string, structured: boolean, signal: AbortSignal): Promise<Suggestion[]> {
  const ask = async (country: string | null) => {
    const params = new URLSearchParams({ q, format: 'json', addressdetails: structured ? '1' : '0', limit: '6' });
    if (country) params.set('countrycodes', country);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      signal,
      headers: { 'Accept-Language': navigator.language },
    });
    return res.ok ? ((await res.json()) as Suggestion[]) : [];
  };
  const country = homeCountry();
  const local = await ask(country);
  if (local.length > 0 || !country) return local;
  // Nothing at home: offer what is overseas, marked as such, in case the
  // address really is abroad.
  return (await ask(null)).map((s) => ({ ...s, elsewhere: true }));
}

interface AddressAutocompleteProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * When given, the finder requests structured address detail and calls
   * this with the broken-out parts on pick, so a segmented form can fill
   * each field. The free-text `onChange` still fires for the raw box.
   */
  onPickStructured?: (parts: StructuredAddress) => void;
}

/** Map Nominatim's address object to our segmented fields. */
function toStructured(a: Record<string, string> | undefined): StructuredAddress {
  const g = (...keys: string[]) => {
    for (const k of keys) if (a?.[k]) return a[k];
    return '';
  };
  const houseAndRoad = [g('house_number'), g('road')].filter(Boolean).join(' ');
  return {
    line1: houseAndRoad || g('building', 'amenity', 'shop'),
    line2: g('building', 'amenity') && houseAndRoad ? g('building', 'amenity') : '',
    suburb: g('suburb', 'city', 'town', 'village', 'hamlet', 'municipality'),
    state: g('state', 'province', 'region'),
    postcode: g('postcode'),
    country: g('country'),
  };
}

export function AddressAutocomplete({ label, value, onChange, placeholder = 'Start typing an address…', onPickStructured }: AddressAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // Whether the map found nothing in the person's own country.
  const notHere = searched && !suggestions.some((s) => !s.fromDirectory && !s.elsewhere);
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
      setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const [mine, map] = await Promise.all([
          searchDirectory(q.trim()),
          searchMap(q.trim(), !!onPickStructured, controller.signal).catch(() => [] as Suggestion[]),
        ]);
        if (controller.signal.aborted) return;
        setSuggestions([...mine, ...map]);
        setHighlight(0);
        setSearched(true);
      } catch {
        // aborted or network error
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const pick = (s: Suggestion) => {
    if (s.fromDirectory) {
      onChange(s.fromDirectory.line1 || s.display_name);
      if (onPickStructured) onPickStructured(s.fromDirectory);
      setOpen(false);
      setSuggestions([]);
      return;
    }
    onChange(s.display_name);
    if (onPickStructured) onPickStructured(toStructured(s.address));
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
            pick(suggestions[highlight]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && suggestions.length > 0 ? (
        <ul className="absolute left-0 top-full mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-border bg-card shadow-lg z-20">
          {notHere ? (
            <li className="px-3 py-2 text-sm text-ink border-b border-border">
              Not found on the map here. Some places, like shopping centres and new buildings, are missing from it.{' '}
              {onPickStructured ? 'Type the address into the boxes below instead.' : 'Type the address in yourself instead.'}
            </li>
          ) : null}
          {suggestions.map((s, i) => (
            <li key={s.place_id}>
              {s.elsewhere && !suggestions[i - 1]?.elsewhere ? (
                <span className="block px-3 pt-2 pb-1 text-xs text-muted">Elsewhere in the world</span>
              ) : null}
              <button
                type="button"
                className={`w-full text-left px-3 py-1.5 text-sm ${i === highlight ? 'bg-primary-50 text-primary' : 'text-ink hover:bg-surface-2'}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(s)}
              >
                <span className="block">{s.display_name}</span>
                {s.fromDirectory ? <span className="block text-xs text-muted">In your directory</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && searched && !loading && suggestions.length === 0 && value.trim().length >= 3 ? (
        <div className="absolute left-0 top-full mt-1 w-full rounded-md border border-border bg-card shadow-lg z-20 px-3 py-2 text-sm text-ink">
          Not found on the map here. Some places, like shopping centres and new buildings, are missing from it.{' '}
          {onPickStructured ? 'Type the address into the boxes below instead.' : 'Type the address in yourself instead.'}
        </div>
      ) : null}
      {loading && open ? (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      ) : null}
    </div>
  );
}
