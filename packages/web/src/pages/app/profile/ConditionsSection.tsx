import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { conditionStatusLabel, type MedicalCondition } from '../../../lib/care';

/**
 * The person's conditions, front and centre on the overview. Typing offers
 * suggestions from the shared condition catalogue, which covers common
 * conditions across all life stages; anything not in it yet can be added
 * as typed, joins the catalogue, and is suggested to everyone from then
 * on. A person can have as many conditions as apply. Statuses, dates and
 * the treatments managing each condition live on the care plan page.
 */
export function ConditionsSection({ profileId, canEdit }: { profileId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['conditions', profileId],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profileId}/conditions`),
  });
  const conditions = data?.conditions ?? [];

  const { data: suggestionData } = useQuery({
    queryKey: ['condition-catalogue', search],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>(`/condition-catalogue?search=${encodeURIComponent(search)}`),
    enabled: canEdit && search.trim().length > 0,
  });
  const existingNames = new Set(conditions.map((c) => c.name.toLowerCase()));
  const suggestions = (suggestionData?.items ?? []).filter((s) => !existingNames.has(s.name.toLowerCase())).slice(0, 8);
  const trimmed = search.trim();
  const exactMatch = suggestions.some((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  // The choices offered: catalogue matches, plus "add as typed" when new.
  const options = [...suggestions.map((s) => s.name), ...(trimmed && !exactMatch && !existingNames.has(trimmed.toLowerCase()) ? [trimmed] : [])];

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });

  const addMutation = useMutation({
    mutationFn: (name: string) => api.post(`/care-profiles/${profileId}/conditions`, { name }),
    onSuccess: () => {
      setSearch('');
      setOpen(false);
      setError('');
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to add condition'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/conditions/${id}`),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to remove condition'),
  });

  useEffect(() => {
    setHighlight(0);
  }, [search]);

  // Close the suggestion list when clicking elsewhere.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const add = (name: string) => {
    if (!name.trim() || addMutation.isPending) return;
    addMutation.mutate(name.trim());
  };

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-ink">Conditions</h3>
        <Link to="plan" className="text-xs text-primary hover:underline">
          Details on the care plan
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {conditions.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-sm text-ink"
            title={[conditionStatusLabel(c.status), c.is_temporary ? 'expected to pass' : null].filter(Boolean).join(', ')}
          >
            {c.name}
            {c.status === 'resolved' ? <span className="text-xs text-muted">resolved</span> : null}
            {canEdit ? (
              <button
                type="button"
                aria-label={`Remove ${c.name}`}
                onClick={() => removeMutation.mutate(c.id)}
                className="text-muted hover:text-red-600 leading-none"
              >
                ✕
              </button>
            ) : null}
          </span>
        ))}
        {conditions.length === 0 && !canEdit ? <p className="text-sm text-muted">No conditions recorded.</p> : null}
        {canEdit ? (
          <div className="relative" ref={boxRef}>
            <input
              type="text"
              role="combobox"
              aria-expanded={open && options.length > 0}
              aria-label="Add a condition"
              placeholder={conditions.length === 0 ? 'Add a condition, e.g. Autism' : 'Add another…'}
              className="w-44 rounded-md border border-border bg-card px-2.5 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOpen(true);
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
                  if (options[highlight]) add(options[highlight]);
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
                        onClick={() => add(name)}
                      >
                        {isNew ? (
                          <>
                            Add "{name}" as a new condition
                          </>
                        ) : (
                          name
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
