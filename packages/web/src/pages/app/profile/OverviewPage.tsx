import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { PoaBadge } from '../../../components/PoaBadge';
import { RelationshipSelect } from '../../../components/RelationshipSelect';
import { JourneysSection } from './JourneysSection';
import { useProfile } from './ProfileLayout';
import {
  LOG_ENTRY_TYPES,
  entryTypeLabel,
  type CareLogEntry,
  type CircleMember,
} from '../../../lib/care';

export function OverviewPage() {
  const { profile, careName, relationship, isOwner } = useProfile();
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

  const isPet = profile.kind === 'pet';
  const detailLine = [
    isPet ? profile.breed : null,
    profile.pronouns,
    profile.date_of_birth ? `Born ${format(new Date(profile.date_of_birth), 'd MMM yyyy')}` : null,
    isPet ? null : profile.primary_language,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-6">
      <JourneysSection
        profileId={profile.id}
        careName={careName}
        dateOfBirth={profile.date_of_birth}
        dueDate={profile.due_date}
      />

      <div className="card space-y-3">
          {detailLine ? <p className="text-sm text-muted">{detailLine}</p> : null}
          <RelationshipRow profileId={profile.id} relationship={relationship} isOwner={isOwner} />
          {isPet ? (
            <PetDetails
              species={profile.species}
              breed={profile.breed}
              desexed={profile.desexed}
              microchip={profile.microchip_number}
            />
          ) : poaHolders.length > 0 ? (
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

      <CareLog profileId={profile.id} />

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

/** A pet's structured facts, each on its own labelled line. */
function PetDetails({
  species,
  breed,
  desexed,
  microchip,
}: {
  species: string | null;
  breed: string | null;
  desexed: boolean;
  microchip: string | null;
}) {
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (species) rows.push({ label: 'Species', value: species });
  if (breed) rows.push({ label: 'Breed', value: breed });
  rows.push({ label: 'Desexed', value: desexed ? 'Yes' : 'No' });
  if (microchip) rows.push({ label: 'Microchip', value: microchip });
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted">{r.label}</dt>
          <dd className="min-w-0 flex-1 text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
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

/** Shows and edits what THIS viewer calls the person ("Your Oma"). */
function RelationshipRow({
  profileId,
  relationship,
  isOwner,
}: {
  profileId: string;
  relationship: string | null;
  isOwner: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(relationship ?? '');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const value = draft.trim() || null;
      return isOwner
        ? api.patch(`/care-profiles/${profileId}`, { owner_relationship: value })
        : api.patch(`/care-profiles/${profileId}/circle/me/relationship`, { relationship: value });
    },
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['care-profile', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  return (
    <div className="text-sm">
      <span className="text-muted">To you: </span>
      <span className="text-ink font-medium">{relationship ?? 'not set'}</span>{' '}
      <button
        type="button"
        className="text-xs text-primary hover:underline"
        onClick={() => {
          setDraft(relationship ?? '');
          setError('');
          setOpen(true);
        }}
      >
        change
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Who are they to you?">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            The app will use this everywhere it talks about them, so it reads the way your family speaks.
          </p>
          <RelationshipSelect value={draft} onChange={setDraft} />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

