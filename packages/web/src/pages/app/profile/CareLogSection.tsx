import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { LOG_ENTRY_TYPES, SENTIMENTS, entryTypeLabel, sentimentEmoji, sentimentLabel, type CareLogEntry } from '../../../lib/care';

/**
 * The care log: everything that happened, filterable by kind, words and
 * dates, sortable oldest or newest first, and collapsible by day, month or
 * year. Entries can be ticked individually or all at once for bulk edits
 * (moving them to another kind) and bulk deletes, and each entry can be
 * edited or deleted on its own.
 */

const selectClass =
  'rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

type GroupBy = 'day' | 'month' | 'year';

const GROUP_LABELS: Record<GroupBy, string> = { day: 'Day', month: 'Month', year: 'Year' };

function groupKey(occurredAt: string, groupBy: GroupBy): string {
  const d = new Date(occurredAt);
  if (groupBy === 'day') return format(d, 'yyyy-MM-dd');
  if (groupBy === 'month') return format(d, 'yyyy-MM');
  return format(d, 'yyyy');
}

function groupLabel(key: string, groupBy: GroupBy): string {
  if (groupBy === 'day') return format(new Date(`${key}T12:00:00`), 'EEEE d MMMM yyyy');
  if (groupBy === 'month') return format(new Date(`${key}-15T12:00:00`), 'MMMM yyyy');
  return key;
}

export function CareLogSection({ profileId, canEdit }: { profileId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();

  // Add-entry form
  const [entryType, setEntryType] = useState('observation');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState('');

  // Filters, sort and grouping
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<'desc' | 'asc'>('desc');
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Selection and bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkType, setBulkType] = useState('');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [editing, setEditing] = useState<CareLogEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CareLogEntry | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ limit: '500', sort });
  if (typeFilter.length > 0) params.set('types', typeFilter.join(','));
  if (debouncedQ) params.set('q', debouncedQ);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data, isLoading } = useQuery({
    queryKey: ['care-log', profileId, sort, typeFilter.join(','), debouncedQ, from, to],
    queryFn: () => api.get<{ entries: CareLogEntry[]; total: number }>(`/care-profiles/${profileId}/log?${params.toString()}`),
  });
  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;

  const groups = useMemo(() => {
    const map = new Map<string, CareLogEntry[]>();
    for (const entry of entries) {
      const key = groupKey(entry.occurred_at, groupBy);
      const arr = map.get(key) ?? [];
      arr.push(entry);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [entries, groupBy]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['care-log', profileId] });

  const addMutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/log`, {
        entry_type: entryType,
        title: title.trim() || null,
        body: body.trim(),
      }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setFormError('');
      invalidate();
      // The tone is read in the background, so refresh shortly after to pick
      // up the analysed sentiment once it lands.
      setTimeout(invalidate, 4000);
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : 'Failed to add entry'),
  });

  // Set or clear a person's own rating on one entry.
  const setSentiment = useMutation({
    mutationFn: (vars: { id: string; sentiment: number | null }) =>
      api.patch(`/care-profiles/${profileId}/log/${vars.id}`, { sentiment: vars.sentiment }),
    onSuccess: invalidate,
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Failed to set the tone'),
  });

  const editMutation = useMutation({
    mutationFn: (entry: { id: string; entry_type: string; title: string | null; body: string; occurred_at: string }) =>
      api.patch(`/care-profiles/${profileId}/log/${entry.id}`, {
        entry_type: entry.entry_type,
        title: entry.title,
        body: entry.body,
        occurred_at: entry.occurred_at,
      }),
    onSuccess: () => {
      setEditing(null);
      setActionError('');
      invalidate();
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/log/${id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      setActionError('');
      invalidate();
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Failed to delete'),
  });

  const bulkTypeMutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/log/bulk-update`, { ids: [...selected], patch: { entry_type: bulkType } }),
    onSuccess: () => {
      setSelected(new Set());
      setBulkType('');
      setActionError('');
      invalidate();
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Failed to update entries'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/log/bulk-delete`, { ids: [...selected] }),
    onSuccess: () => {
      setSelected(new Set());
      setConfirmBulkDelete(false);
      setActionError('');
      invalidate();
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Failed to delete entries'),
  });

  const toggleType = (value: string) =>
    setTypeFilter((prev) => (prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]));

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hasFilters = typeFilter.length > 0 || debouncedQ !== '' || from !== '' || to !== '';

  return (
    <div className="card">
      <h2 className="text-base font-semibold text-ink mb-4">Care log</h2>

      {canEdit ? (
        <form
          className="space-y-3 mb-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) addMutation.mutate();
          }}
        >
          <div className="flex gap-2">
            <select aria-label="Entry type" className={selectClass} value={entryType} onChange={(e) => setEntryType(e.target.value)}>
              {LOG_ENTRY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <div className="flex-1">
              <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <Textarea placeholder="What happened?" value={body} onChange={(e) => setBody(e.target.value)} rows={2} required />
          {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={addMutation.isPending} disabled={!body.trim()}>
              Add entry
            </Button>
          </div>
        </form>
      ) : null}

      {/* Filters, sort and grouping */}
      <div className="space-y-2 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Search the care log"
            placeholder="Search entries…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-48"
          />
          <Input aria-label="Show entries from this date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-muted">to</span>
          <Input aria-label="Show entries up to this date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <select aria-label="Sort order" className={selectClass} value={sort} onChange={(e) => setSort(e.target.value as 'asc' | 'desc')}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
          <select aria-label="Group entries by" className={selectClass} value={groupBy} onChange={(e) => { setGroupBy(e.target.value as GroupBy); setCollapsed(new Set()); }}>
            {(Object.keys(GROUP_LABELS) as GroupBy[]).map((g) => (
              <option key={g} value={g}>
                By {GROUP_LABELS[g].toLowerCase()}
              </option>
            ))}
          </select>
          {hasFilters ? (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => {
                setTypeFilter([]);
                setQ('');
                setFrom('');
                setTo('');
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LOG_ENTRY_TYPES.map((t) => {
            const active = typeFilter.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleType(t.value)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                  active ? 'border-primary bg-primary-50 text-primary font-medium' : 'border-border text-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selection and bulk actions */}
      {canEdit && entries.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
          <Button size="xs" variant="ghost" onClick={() => setSelected(new Set(entries.map((e) => e.id)))}>
            Select all
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
            Select none
          </Button>
          {selected.size > 0 ? (
            <>
              <span className="text-muted">{selected.size} selected</span>
              <select aria-label="Change the kind of the selected entries" className={selectClass} value={bulkType} onChange={(e) => setBulkType(e.target.value)}>
                <option value="">Change kind to…</option>
                {LOG_ENTRY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="secondary" disabled={!bulkType} loading={bulkTypeMutation.isPending} onClick={() => bulkTypeMutation.mutate()}>
                Apply
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmBulkDelete(true)}>
                Delete selected
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {actionError ? <p className="mb-2 text-sm text-red-600">{actionError}</p> : null}

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">
          {hasFilters
            ? 'Nothing matches these filters.'
            : 'No entries yet. Log visits, calls, and decisions so the whole family stays up to date.'}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map(([key, groupEntries]) => {
            const isCollapsed = collapsed.has(key);
            return (
              <div key={key} className="rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => toggleGroup(key)}
                  aria-expanded={!isCollapsed}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2 transition-colors"
                >
                  <span>
                    {groupLabel(key, groupBy)}
                    <span className="ml-2 text-xs font-normal text-muted">
                      {groupEntries.length} {groupEntries.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </span>
                  <span aria-hidden className="text-muted">{isCollapsed ? '▸' : '▾'}</span>
                </button>
                {!isCollapsed ? (
                  <ul className="border-t border-border divide-y divide-border">
                    {groupEntries.map((entry) => (
                      <li key={entry.id} className="flex gap-3 px-3 py-3">
                        {canEdit ? (
                          <input
                            type="checkbox"
                            aria-label={`Select entry ${entry.title ?? entryTypeLabel(entry.entry_type)}`}
                            className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                            checked={selected.has(entry.id)}
                            onChange={() => toggleSelected(entry.id)}
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="badge bg-primary-50 text-primary text-xs">{entryTypeLabel(entry.entry_type)}</span>
                            <span className="text-xs text-muted">{format(new Date(entry.occurred_at), 'd MMM yyyy, HH:mm')}</span>
                            <SentimentControl
                              entry={entry}
                              canEdit={canEdit}
                              onSet={(sentiment) => setSentiment.mutate({ id: entry.id, sentiment })}
                            />
                          </div>
                          {entry.title ? <p className="text-sm font-medium text-ink">{entry.title}</p> : null}
                          <p className="text-sm text-ink whitespace-pre-wrap">{entry.body}</p>
                        </div>
                        {canEdit ? (
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <Button size="xs" variant="ghost" aria-label="Edit log entry" title="Edit" onClick={() => { setActionError(''); setEditing(entry); }}>
                              <PencilIcon />
                            </Button>
                            <Button size="xs" variant="ghost-danger" aria-label="Delete log entry" title="Delete" onClick={() => { setActionError(''); setConfirmDelete(entry); }}>
                              <TrashIcon />
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
          {total > entries.length ? (
            <p className="text-xs text-muted">
              Showing the most recent {entries.length} of {total} entries. Narrow the filters to find older ones.
            </p>
          ) : null}
        </div>
      )}

      {editing ? (
        <EditEntryModal
          entry={editing}
          saving={editMutation.isPending}
          error={actionError}
          onClose={() => setEditing(null)}
          onSave={(values) => editMutation.mutate({ id: editing.id, ...values })}
        />
      ) : null}

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete this entry">
        <p className="text-sm text-muted mb-4">
          Delete "{confirmDelete?.title ?? confirmDelete?.body.slice(0, 80)}"? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button variant="danger" loading={deleteMutation.isPending} onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}>
            Delete
          </Button>
        </div>
      </Modal>

      <Modal open={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)} title="Delete selected entries">
        <p className="text-sm text-muted mb-4">
          Delete {selected.size} {selected.size === 1 ? 'entry' : 'entries'} from the care log? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmBulkDelete(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={bulkDeleteMutation.isPending} onClick={() => bulkDeleteMutation.mutate()}>
            Delete {selected.size === 1 ? 'entry' : 'entries'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/**
 * The emotional tone of an entry: an emoji read from the note by the
 * assistant, or set by a carer. Read-only viewers see the emoji; anyone who
 * can edit gets a small picker to set or correct it. A carer's choice always
 * wins over the analysed one.
 */
function SentimentControl({
  entry,
  canEdit,
  onSet,
}: {
  entry: CareLogEntry;
  canEdit: boolean;
  onSet: (sentiment: number | null) => void;
}) {
  const has = entry.sentiment != null;
  const source =
    entry.sentiment_source === 'manual' ? 'set by a carer' : entry.sentiment_source === 'ai' ? 'read by Pare' : '';
  const title = has ? `Tone: ${sentimentLabel(entry.sentiment as number)}${source ? ` · ${source}` : ''}` : 'No tone recorded yet';

  if (!canEdit) {
    return has ? (
      <span title={title} aria-label={title} className="text-sm leading-none">
        {sentimentEmoji(entry.sentiment as number)}
      </span>
    ) : null;
  }

  return (
    <select
      aria-label="Tone for this entry"
      title={title}
      className="rounded border border-border bg-card px-1 py-0.5 text-xs text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      value={has ? String(entry.sentiment) : ''}
      onChange={(e) => onSet(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">Tone…</option>
      {SENTIMENTS.map((s) => (
        <option key={s.value} value={s.value}>
          {s.emoji} {s.label}
        </option>
      ))}
    </select>
  );
}

/** Edit one entry: its kind, title, what happened, and when it happened. */
function EditEntryModal({
  entry,
  saving,
  error,
  onClose,
  onSave,
}: {
  entry: CareLogEntry;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (values: { entry_type: string; title: string | null; body: string; occurred_at: string }) => void;
}) {
  const [entryType, setEntryType] = useState(entry.entry_type as string);
  const [title, setTitle] = useState(entry.title ?? '');
  const [body, setBody] = useState(entry.body);
  const [occurredAt, setOccurredAt] = useState(format(new Date(entry.occurred_at), "yyyy-MM-dd'T'HH:mm"));

  return (
    <Modal open onClose={onClose} title="Edit care log entry">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          onSave({
            entry_type: entryType,
            title: title.trim() || null,
            body: body.trim(),
            occurred_at: new Date(occurredAt).toISOString(),
          });
        }}
      >
        <div>
          <label htmlFor="edit-entry-type" className="block text-sm font-medium text-ink mb-1">
            Kind of entry
          </label>
          <select id="edit-entry-type" className={`${selectClass} w-full`} value={entryType} onChange={(e) => setEntryType(e.target.value)}>
            {LOG_ENTRY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
        <Textarea label="What happened" value={body} onChange={(e) => setBody(e.target.value)} rows={3} required />
        <Input label="When it happened" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} required />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!body.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
