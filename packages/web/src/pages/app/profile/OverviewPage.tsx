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
  POA_TYPES,
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

  const [confirmText, setConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const archiveMutation = useMutation({
    mutationFn: () => api.delete(`/care-profiles/${profile.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
      navigate('/app');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/care-profiles/${profile.id}/permanent`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      navigate('/app');
    },
    onError: (err) => setDeleteError(err instanceof Error ? err.message : 'Failed to delete'),
  });

  const nameMatches = confirmText.trim().toLowerCase() === profile.full_name.trim().toLowerCase();
  const closeArchive = () => {
    setArchiveOpen(false);
    setConfirmText('');
    setDeleteError('');
  };

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
          ) : isOwner ? (
            <SetPoaInline profileId={profile.id} members={circleData?.members ?? []} />
          ) : (
            <p className="text-sm text-muted">No power of attorney recorded yet.</p>
          )}
          {profile.notes ? <p className="text-sm whitespace-pre-wrap border-t border-border pt-3">{profile.notes}</p> : null}
      </div>

      <CareLog profileId={profile.id} />

      <div className="pt-4 border-t border-border">
        <Button variant="ghost" size="sm" onClick={() => setArchiveOpen(true)}>
          Archive or delete this profile
        </Button>
      </div>

      <Modal open={archiveOpen} onClose={closeArchive} title="Archive or delete profile">
        <p className="text-sm text-muted mb-4">
          Archiving hides {profile.preferred_name ?? profile.full_name}'s profile and its records from your
          dashboard. Nothing is deleted, and you can bring it back later.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={closeArchive}>
            Cancel
          </Button>
          <Button variant="secondary" loading={archiveMutation.isPending} onClick={() => archiveMutation.mutate()}>
            Archive
          </Button>
        </div>

        {isOwner ? (
          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-sm font-medium text-ink mb-1">Delete permanently</p>
            <p className="text-sm text-muted mb-3">
              This cannot be undone. It removes {profile.preferred_name ?? profile.full_name} and everything recorded
              for them: journeys, care log, tasks, medications, documents and the care circle. To confirm, type their
              full name <span className="font-medium text-ink">{profile.full_name}</span> below.
            </p>
            <Input
              aria-label="Type the full name to confirm deletion"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={profile.full_name}
            />
            {deleteError ? <p className="mt-2 text-sm text-red-600">{deleteError}</p> : null}
            <div className="mt-3 flex justify-end">
              <Button
                variant="danger"
                loading={deleteMutation.isPending}
                disabled={!nameMatches}
                onClick={() => {
                  setDeleteError('');
                  deleteMutation.mutate();
                }}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/**
 * Name a power of attorney right here, without leaving the overview. The
 * user picks one of the people already in the care circle and the kind of
 * authority they hold: two separate choices, so each stays its own data
 * point. Activating it and finer edits still live on the care circle
 * screen. Only shown to the profile owner, who is the one allowed to set it.
 */
function SetPoaInline({ profileId, members }: { profileId: string; members: CircleMember[] }) {
  const queryClient = useQueryClient();
  const [memberId, setMemberId] = useState('');
  const [poaType, setPoaType] = useState<string>(POA_TYPES[0].value);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.patch(`/care-profiles/${profileId}/circle/${memberId}`, { poa_type: poaType }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['circle', profileId] });
      setMemberId('');
      setError('');
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not set the power of attorney.'),
  });

  if (members.length === 0) {
    return (
      <p className="text-sm text-muted">
        No power of attorney recorded yet. Add someone to the{' '}
        <Link to="circle" className="text-primary hover:underline">
          care circle
        </Link>{' '}
        first, then you can name them here.
      </p>
    );
  }

  const selectClass =
    'rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">No power of attorney recorded yet. Name one of the people in the care circle:</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Who</span>
          <select
            aria-label="Who holds power of attorney"
            className={selectClass}
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
          >
            <option value="">Choose a person</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
                {m.relationship ? ` — ${m.relationship}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Kind of authority</span>
          <select
            aria-label="Kind of power of attorney"
            className={selectClass}
            value={poaType}
            onChange={(e) => setPoaType(e.target.value)}
          >
            {POA_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          disabled={!memberId || mutation.isPending}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Set
        </Button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
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

