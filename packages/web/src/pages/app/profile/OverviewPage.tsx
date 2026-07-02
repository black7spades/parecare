import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { PoaBadge } from '../../../components/PoaBadge';
import { PhasePipeline } from './PhasePipeline';
import { useProfile } from './ProfileLayout';
import {
  LOG_ENTRY_TYPES,
  entryTypeLabel,
  type CareLogEntry,
  type ChecklistItem,
  type CircleMember,
} from '../../../lib/care';

export function OverviewPage() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [archiveOpen, setArchiveOpen] = useState(false);

  const { data: circleData } = useQuery({
    queryKey: ['circle', profile.id],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profile.id}/circle`),
  });
  const poaHolders = (circleData?.members ?? []).filter((m) => m.poa_type);

  const archiveMutation = useMutation({
    mutationFn: () => api.delete(`/care-profiles/${profile.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
      navigate('/app');
    },
  });

  const detailLine = [
    profile.pronouns,
    profile.date_of_birth ? `Born ${format(new Date(profile.date_of_birth), 'd MMM yyyy')}` : null,
    profile.primary_language,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-6">
      <PhasePipeline profileId={profile.id} currentPhase={profile.current_phase} />

      {detailLine || profile.notes || poaHolders.length > 0 ? (
        <div className="card space-y-3">
          {detailLine ? <p className="text-sm text-muted">{detailLine}</p> : null}
          {poaHolders.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              {poaHolders.map((m) => (
                <span key={m.id} className="flex items-center gap-2 text-sm text-ink">
                  <span className="font-medium">{m.display_name}</span>
                  <PoaBadge type={m.poa_type} activated={m.poa_activated} />
                </span>
              ))}
              <Link to="circle" className="text-xs text-primary hover:underline">
                Manage care circle →
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted">
              No power of attorney recorded yet.{' '}
              <Link to="circle" className="text-primary hover:underline">
                Set one in the care circle
              </Link>
              .
            </p>
          )}
          {profile.notes ? <p className="text-sm whitespace-pre-wrap border-t border-border pt-3">{profile.notes}</p> : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <Checklist profileId={profile.id} phase={profile.current_phase} />
        <CareLog profileId={profile.id} />
      </div>

      <div className="pt-4 border-t border-border">
        <Button variant="ghost" size="sm" onClick={() => setArchiveOpen(true)}>
          Archive this profile
        </Button>
      </div>

      <Modal open={archiveOpen} onClose={() => setArchiveOpen(false)} title="Archive profile">
        <p className="text-sm text-muted mb-4">
          Archiving hides {profile.preferred_name ?? profile.full_name}'s profile and its records from your
          dashboard. Nothing is deleted.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setArchiveOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={archiveMutation.isPending} onClick={() => archiveMutation.mutate()}>
            Archive
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Checklist({ profileId, phase }: { profileId: string; phase: string }) {
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState('');

  const listKey = ['checklist', profileId, phase];
  const { data, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => api.get<{ items: ChecklistItem[] }>(`/care-profiles/${profileId}/checklists?phase=${phase}`),
  });
  const items = data?.items ?? [];

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['checklist', profileId] });

  const toggleMutation = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api.patch(`/care-profiles/${profileId}/checklists/${id}`, { completed }),
    onMutate: async ({ id, completed }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<{ items: ChecklistItem[] }>(listKey);
      queryClient.setQueryData<{ items: ChecklistItem[] }>(listKey, (old) =>
        old ? { items: old.items.map((i) => (i.id === id ? { ...i, completed } : i)) } : old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous);
    },
    onSettled: invalidate,
  });

  const addMutation = useMutation({
    mutationFn: (title: string) => api.post(`/care-profiles/${profileId}/checklists`, { phase, title }),
    onSuccess: () => {
      setNewTitle('');
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/checklists/${id}`),
    onSuccess: invalidate,
  });

  const done = items.filter((i) => i.completed).length;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-ink">Checklist</h2>
        {items.length > 0 ? (
          <span className="text-xs text-muted">
            {done} of {items.length} done
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No checklist items for this phase yet.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 group">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                checked={item.completed}
                onChange={(e) => toggleMutation.mutate({ id: item.id, completed: e.target.checked })}
              />
              <div className="flex-1">
                <p className={`text-sm ${item.completed ? 'line-through text-muted' : 'text-ink'}`}>{item.title}</p>
                {item.description ? <p className="text-xs text-muted">{item.description}</p> : null}
              </div>
              {item.is_custom ? (
                <button
                  type="button"
                  aria-label={`Delete ${item.title}`}
                  className="text-muted hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity text-sm"
                  onClick={() => deleteMutation.mutate(item.id)}
                >
                  ✕
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newTitle.trim()) addMutation.mutate(newTitle.trim());
        }}
      >
        <div className="flex-1">
          <Input placeholder="Add your own item…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary" loading={addMutation.isPending} disabled={!newTitle.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}

function CareLog({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const [entryType, setEntryType] = useState('observation');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['care-log', profileId],
    queryFn: () => api.get<{ entries: CareLogEntry[]; total: number }>(`/care-profiles/${profileId}/log`),
  });
  const entries = data?.entries ?? [];

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
      void queryClient.invalidateQueries({ queryKey: ['care-log', profileId] });
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : 'Failed to add entry'),
  });

  return (
    <div className="card">
      <h2 className="text-base font-semibold text-ink mb-4">Care log</h2>

      <form
        className="space-y-3 mb-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) addMutation.mutate();
        }}
      >
        <div className="flex gap-2">
          <select
            aria-label="Entry type"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={entryType}
            onChange={(e) => setEntryType(e.target.value)}
          >
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
        <Textarea
          placeholder="What happened?"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          required
        />
        {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={addMutation.isPending} disabled={!body.trim()}>
            Add entry
          </Button>
        </div>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">No entries yet. Log visits, calls, and decisions so the whole family stays up to date.</p>
      ) : (
        <ul className="space-y-4">
          {entries.map((entry) => (
            <li key={entry.id} className="border-b border-border last:border-0 pb-4 last:pb-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="badge bg-primary-50 text-primary text-xs">{entryTypeLabel(entry.entry_type)}</span>
                <span className="text-xs text-muted">{format(new Date(entry.occurred_at), 'd MMM yyyy, HH:mm')}</span>
              </div>
              {entry.title ? <p className="text-sm font-medium text-ink">{entry.title}</p> : null}
              <p className="text-sm text-ink whitespace-pre-wrap">{entry.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
