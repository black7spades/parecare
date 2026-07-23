import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Avatar } from '../ui/Avatar';
import { UsersIcon } from '../ui/icons';

interface SwitcherProfile {
  id: string;
  kind: 'person' | 'pet';
  full_name: string;
  preferred_name: string | null;
  relationship: string | null;
  photo_url: string | null;
  photo_color: string | null;
}

const profileName = (p: SwitcherProfile) => p.preferred_name || p.full_name;

/**
 * A search-and-switch control in the centre of the top bar for moving straight
 * between the people and pets in your care, without first going back to the
 * All people list. Type to filter, then pick from the results; the current
 * profile is marked and listed first.
 */
export function ProfileSwitcher({ activeProfileId }: { activeProfileId: string | null }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: SwitcherProfile[] }>('/care-profiles/summary'),
  });
  const profiles = data?.profiles ?? [];

  const active = profiles.find((p) => p.id === activeProfileId) ?? null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ranked = [...profiles].sort((a, b) => {
      // Keep the current profile at the top, then order by name.
      if (a.id === activeProfileId) return -1;
      if (b.id === activeProfileId) return 1;
      return profileName(a).localeCompare(profileName(b));
    });
    if (!q) return ranked;
    return ranked.filter((p) => {
      const hay = `${p.full_name} ${p.preferred_name ?? ''} ${p.relationship ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [profiles, query, activeProfileId]);

  // Close on outside click or Escape, and reset the search each time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  const choose = (p: SwitcherProfile) => {
    setOpen(false);
    navigate(`/app/${p.id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = results[highlight];
      if (pick) choose(pick);
    }
  };

  // Nothing to switch between until there is more than one profile in reach.
  if (profiles.length === 0) return null;

  return (
    <div ref={containerRef} className="relative w-full max-w-xs">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-surface hover:bg-surface-2 text-sm text-ink transition-colors"
        title="Switch person"
      >
        {active ? (
          <Avatar
            accountId={active.id}
            name={active.full_name}
            avatarUrl={active.photo_url}
            color={active.photo_color}
            fetchPath={`/care-profiles/${active.id}/photo`}
            size={20}
          />
        ) : (
          <span className="text-muted shrink-0">
            <UsersIcon size={16} />
          </span>
        )}
        <span className="truncate flex-1 text-left">{active ? profileName(active) : 'Switch person'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-muted shrink-0">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-1/2 -translate-x-1/2 mt-1.5 w-72 max-w-[85vw] rounded-lg border border-border bg-card shadow-lg z-40 overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search people and pets…"
              aria-label="Search people and pets"
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <ul role="listbox" className="max-h-80 overflow-y-auto py-1">
            {results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">No one matches that search.</li>
            ) : (
              results.map((p, i) => {
                const isActive = p.id === activeProfileId;
                return (
                  <li key={p.id} role="option" aria-selected={isActive}>
                    <button
                      type="button"
                      onClick={() => choose(p)}
                      onMouseEnter={() => setHighlight(i)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                        i === highlight ? 'bg-surface-2' : ''
                      }`}
                    >
                      <Avatar
                        accountId={p.id}
                        name={p.full_name}
                        avatarUrl={p.photo_url}
                        color={p.photo_color}
                        fetchPath={`/care-profiles/${p.id}/photo`}
                        size={26}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-ink">{profileName(p)}</span>
                        {p.relationship ? (
                          <span className="block truncate text-xs text-muted capitalize">{p.relationship}</span>
                        ) : null}
                      </span>
                      {isActive ? <span className="text-xs text-primary shrink-0">Current</span> : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
