import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { useDataView, type DataSort } from '../../../components/data/useDataView';
import { DataToolbar } from '../../../components/data/DataToolbar';
import { useAuthStore } from '../../../stores/auth';
import { useProfile } from './ProfileLayout';
import { ItemNotesThread } from './JourneysSection';
import type { MemoryEntry } from '../../../lib/care';
import type { Achievement, CareJourney } from '../../../lib/journeys';

/**
 * The Memory Book: written memories interleaved with milestone
 * achievements on a timeline. The full achievements record lives with the
 * care journey (AchievementsPage), which hands over here when someone
 * wants to write the story behind an achievement.
 */
export function MemoryBookPage() {
  const { profile } = useProfile();
  const location = useLocation();
  const personName = profile.preferred_name ?? profile.first_name ?? profile.full_name.split(' ')[0];
  // Arriving from the Achievements page with "Write the story" prefills
  // the new-memory form with that achievement.
  const arrivedWith = (location.state as { storyOf?: Achievement } | null)?.storyOf ?? null;
  const [storyOf, setStoryOf] = useState<Achievement | null>(arrivedWith);

  return (
    <div className="space-y-6">
      <BookView
        profileId={profile.id}
        personName={personName}
        storyOf={storyOf}
        onStoryDone={() => setStoryOf(null)}
      />
    </div>
  );
}

/**
 * The full sortable, filterable record of every completed checklist item
 * across every journey. Its own page in the Care profile group; writing
 * the story behind an achievement hands over to the Memory book.
 */
export function AchievementsPage() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  return (
    <AchievementsView
      profileId={profile.id}
      onWriteStory={(a) => navigate(`/app/${profile.id}/memory-book`, { state: { storyOf: a } })}
    />
  );
}

function BookView({
  profileId,
  personName,
  storyOf,
  onStoryDone,
}: {
  profileId: string;
  personName: string;
  storyOf: Achievement | null;
  onStoryDone: () => void;
}) {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.account);
  const fileInput = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState('');

  // Write the story: arriving from an achievement prefills the entry.
  useEffect(() => {
    if (storyOf) setTitle((t) => t || storyOf.title);
  }, [storyOf]);

  const { data, isLoading } = useQuery({
    queryKey: ['memory-book', profileId],
    queryFn: () => api.get<{ entries: MemoryEntry[] }>(`/care-profiles/${profileId}/memory-book`),
  });
  const entries = data?.entries ?? [];

  // Milestone achievements join the timeline between the written memories.
  const { data: milestonesData } = useQuery({
    queryKey: ['achievements', profileId, 'milestones'],
    queryFn: () => api.get<{ achievements: Achievement[] }>(`/care-profiles/${profileId}/memory-book/achievements?milestone=1`),
  });
  const milestones = milestonesData?.achievements ?? [];

  const timeline = useMemo(() => {
    const items: Array<{ date: string; entry?: MemoryEntry; achievement?: Achievement }> = [
      ...entries.map((e) => ({ date: e.created_at, entry: e })),
      ...milestones
        // An achievement whose story is written appears as the story.
        .filter((a) => !a.story_entry_id)
        .map((a) => ({ date: a.achieved_on ?? a.completed_at, achievement: a })),
    ];
    return items.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
  }, [entries, milestones]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['memory-book', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['achievements', profileId] });
  };

  const addMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (title.trim()) form.append('title', title.trim());
      form.append('body', body.trim());
      if (photo) form.append('photo', photo);
      if (storyOf) form.append('checklist_item_id', storyOf.id);
      return api.upload(`/care-profiles/${profileId}/memory-book`, form);
    },
    onSuccess: () => {
      setTitle('');
      setBody('');
      setPhoto(null);
      setError('');
      if (fileInput.current) fileInput.current.value = '';
      onStoryDone();
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save memory'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/memory-book/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <form
        className="card space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) addMutation.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-ink">{storyOf ? 'Write the story' : 'Add a memory'}</h2>
        {storyOf ? (
          <p className="text-sm text-muted -mt-2">
            The story behind <span className="font-medium text-ink">{storyOf.title}</span>
            {storyOf.achieved_on ? `, ${format(new Date(storyOf.achieved_on), 'd MMM yyyy')}` : ''}. It stays linked to
            the achievement.{' '}
            <Button size="xs" variant="ghost" onClick={onStoryDone}>
              Write a plain memory instead
            </Button>
          </p>
        ) : (
          <p className="text-sm text-muted -mt-2">
            Stories, photos and messages for {personName}.
          </p>
        )}
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The caravan trip, 1987" />
        <Textarea
          label="The memory"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          required
          placeholder="Write the story the way you'd tell it…"
        />
        <div>
          <label htmlFor="memory-photo" className="block text-sm font-medium text-ink mb-1">
            Photo
          </label>
          <input
            id="memory-photo"
            ref={fileInput}
            type="file"
            accept="image/*"
            className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:text-primary hover:file:bg-primary-100"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" loading={addMutation.isPending} disabled={!body.trim()}>
            Add to the book
          </Button>
        </div>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : timeline.length === 0 ? (
        <p className="text-sm text-muted">
          The book is empty. Memories written here and milestones ticked on any journey checklist will fill it.
        </p>
      ) : (
        <div className="space-y-4">
          {timeline.map((item) =>
            item.entry ? (
              <EntryCard
                key={`e-${item.entry.id}`}
                profileId={profileId}
                entry={item.entry}
                canDelete={item.entry.author_account_id === me?.id}
                onDelete={() => deleteMutation.mutate(item.entry!.id)}
              />
            ) : (
              <MilestoneCard key={`a-${item.achievement!.id}`} achievement={item.achievement!} />
            )
          )}
        </div>
      )}
    </div>
  );
}

function EntryCard({
  profileId,
  entry,
  canDelete,
  onDelete,
}: {
  profileId: string;
  entry: MemoryEntry;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="card group">
      {entry.photo_url ? <MemoryPhoto profileId={profileId} entryId={entry.id} alt={entry.title ?? 'Memory photo'} /> : null}
      {entry.title ? <h3 className="text-sm font-semibold text-ink mb-1">{entry.title}</h3> : null}
      {entry.checklist_item_id && entry.achievement_title ? (
        <p className="text-xs text-primary mb-1">⭐ The story of: {entry.achievement_title}</p>
      ) : null}
      <p className="text-sm text-ink whitespace-pre-wrap">{entry.body}</p>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-muted">
          {entry.author_name ?? 'Someone'} · {format(new Date(entry.created_at), 'd MMM yyyy')}
        </p>
        {canDelete ? (
          <button
            type="button"
            className="text-xs text-muted hover:text-red-600 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
            onClick={onDelete}
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MilestoneCard({ achievement }: { achievement: Achievement }) {
  const when = achievement.achieved_on ?? achievement.completed_at;
  return (
    <div className="card border-l-4 border-l-primary">
      <p className="text-sm text-ink">
        <span className="mr-1">⭐</span>
        <span className="font-medium">{achievement.title}</span>
      </p>
      <p className="text-xs text-muted mt-1">
        {[
          when ? format(new Date(when), 'd MMM yyyy') : null,
          achievement.journey_name,
          achievement.phase_name,
          achievement.recorded_by_name ? `recorded by ${achievement.recorded_by_name}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  );
}

const ACHIEVEMENT_SORTS: DataSort<Achievement>[] = [
  { key: 'achieved', label: 'By date (newest first)', compare: (a, b) => new Date(b.achieved_on ?? b.completed_at).getTime() - new Date(a.achieved_on ?? a.completed_at).getTime() },
  { key: 'title', label: 'By title (A-Z)', compare: (a, b) => a.title.localeCompare(b.title) },
  { key: 'journey', label: 'By journey', compare: (a, b) => (a.journey_name ?? '').localeCompare(b.journey_name ?? '') || a.title.localeCompare(b.title) },
  { key: 'milestone', label: 'Milestones first', compare: (a, b) => Number(b.is_milestone) - Number(a.is_milestone) || a.title.localeCompare(b.title) },
];

function AchievementsView({ profileId, onWriteStory }: { profileId: string; onWriteStory: (a: Achievement) => void }) {
  const [journeyId, setJourneyId] = useState('');
  const [milestoneOnly, setMilestoneOnly] = useState(false);
  const [photosOnly, setPhotosOnly] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (journeyId) params.set('journey_id', journeyId);
  if (milestoneOnly) params.set('milestone', '1');
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data, isLoading } = useQuery({
    queryKey: ['achievements', profileId, params.toString()],
    queryFn: () =>
      api.get<{ achievements: Achievement[] }>(
        `/care-profiles/${profileId}/memory-book/achievements${params.toString() ? `?${params}` : ''}`
      ),
  });

  const { data: journeysData } = useQuery({
    queryKey: ['journeys', profileId],
    queryFn: () => api.get<{ journeys: CareJourney[] }>(`/care-profiles/${profileId}/journeys`),
  });
  const journeys = journeysData?.journeys ?? [];

  const serverRows = useMemo(() => {
    let list = data?.achievements ?? [];
    if (photosOnly) list = list.filter((a) => a.photo_count > 0);
    return list;
  }, [data, photosOnly]);

  const dv = useDataView<Achievement>({
    rows: serverRows,
    getId: (a) => a.id,
    searchText: (a) => [a.title, a.journey_name, a.phase_name, a.recorded_by_name].filter(Boolean).join(' '),
    sorts: ACHIEVEMENT_SORTS,
  });

  const exportCsv = () => {
    const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Achievement', 'Journey', 'Phase', 'Date it happened', 'Date it was recorded', 'Recorded by', 'Milestone', 'Notes', 'Photos'];
    const lines = dv.filtered.map((a) =>
      [
        a.title,
        a.journey_name ?? '',
        a.phase_name ?? a.legacy_phase ?? '',
        a.achieved_on ? format(new Date(a.achieved_on), 'yyyy-MM-dd') : '',
        format(new Date(a.completed_at), 'yyyy-MM-dd'),
        a.recorded_by_name ?? '',
        a.is_milestone ? 'yes' : 'no',
        a.note_count,
        a.photo_count,
      ]
        .map(esc)
        .join(',')
    );
    const blob = new Blob([[header.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'achievements.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink">Achievements</h2>
            <p className="text-sm text-muted">
              Every completed checklist item, across every journey. Select one to see its whole story.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={dv.filtered.length === 0}>
            Export as CSV
          </Button>
        </div>

        <DataToolbar
          search={dv.search}
          onSearch={dv.setSearch}
          searchPlaceholder="Search achievements..."
          sorts={ACHIEVEMENT_SORTS.map((s) => ({ key: s.key, label: s.label }))}
          sortKey={dv.sortKey}
          onSort={dv.setSortKey}
          page={dv.page}
          totalPages={dv.totalPages}
          pageSize={dv.pageSize}
          totalFiltered={dv.totalFiltered}
          onPageChange={dv.setPage}
          onPageSizeChange={dv.setPageSize}
        />

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <select
            aria-label="Filter by journey"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={journeyId}
            onChange={(e) => setJourneyId(e.target.value)}
          >
            <option value="">All journeys</option>
            {journeys.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={milestoneOnly}
              onChange={(e) => setMilestoneOnly(e.target.checked)}
            />
            Milestones only
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={photosOnly}
              onChange={(e) => setPhotosOnly(e.target.checked)}
            />
            With photos
          </label>
        </div>
      </div>

      <div className="card p-0">
        {isLoading ? (
          <p className="text-sm text-muted p-4">Loading…</p>
        ) : dv.view.length === 0 ? (
          <p className="text-sm text-muted p-4">
            {serverRows.length === 0
              ? 'Nothing here yet. Tick items on any journey checklist and they land here as the record of what was done.'
              : 'No achievements match your search.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted">Achievement</th>
                <th className="px-3 py-2 text-left font-medium text-muted hidden sm:table-cell">Journey</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Date</th>
                <th className="px-3 py-2 text-left font-medium text-muted hidden sm:table-cell">Milestone</th>
              </tr>
            </thead>
            <tbody>
              {dv.view.map((a) => (
                <AchievementRow
                  key={a.id}
                  profileId={profileId}
                  achievement={a}
                  open={openId === a.id}
                  onToggle={() => setOpenId((v) => (v === a.id ? null : a.id))}
                  onWriteStory={() => onWriteStory(a)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/**
 * One achievement. The title is the link: it opens the whole record,
 * with the note, the photo, who recorded it and Write the story.
 */
function AchievementRow({
  profileId,
  achievement: a,
  open,
  onToggle,
  onWriteStory,
}: {
  profileId: string;
  achievement: Achievement;
  open: boolean;
  onToggle: () => void;
  onWriteStory: () => void;
}) {
  const when = a.achieved_on ?? a.completed_at;
  return (
    <>
      <tr className="border-b border-border last:border-0 align-top">
        <td className="px-3 py-2">
          <button type="button" className="text-left text-primary hover:underline" onClick={onToggle}>
            {a.title}
          </button>
        </td>
        <td className="px-3 py-2 text-muted hidden sm:table-cell">{a.journey_name ?? ''}</td>
        <td className="px-3 py-2 text-muted whitespace-nowrap">{when ? format(new Date(when), 'd MMM yyyy') : ''}</td>
        <td className="px-3 py-2 hidden sm:table-cell">{a.is_milestone ? '⭐' : ''}</td>
      </tr>
      {open ? (
        <tr className="border-b border-border last:border-0">
          <td colSpan={4} className="px-3 pb-3">
            <div className="rounded-md border border-border bg-surface p-3 space-y-2">
              {a.description ? <p className="text-sm text-ink">{a.description}</p> : null}
              <p className="text-xs text-muted">
                {[
                  a.journey_name,
                  a.phase_name ?? a.legacy_phase,
                  a.achieved_on ? `Happened ${format(new Date(a.achieved_on), 'd MMM yyyy')}` : null,
                  `Recorded ${format(new Date(a.completed_at), 'd MMM yyyy')}` +
                    (a.recorded_by_name ? ` by ${a.recorded_by_name}` : ''),
                  a.is_milestone ? 'Milestone' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <ItemNotesThread profileId={profileId} itemId={a.id} />
              <div>
                {a.story_entry_id ? (
                  <span className="text-xs text-muted">The story of this achievement is in the book.</span>
                ) : (
                  <Button size="xs" variant="ghost" onClick={onWriteStory}>
                    Write the story
                  </Button>
                )}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// <img> can't send the Authorization header, so fetch the photo as a blob
function MemoryPhoto({ profileId, entryId, alt }: { profileId: string; entryId: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    void api.blob(`/care-profiles/${profileId}/memory-book/${entryId}/photo`).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [profileId, entryId]);
  if (!src) return <div className="mb-3 h-40 rounded-md bg-surface-2 animate-pulse" />;
  return <img src={src} alt={alt} className="mb-3 max-h-80 rounded-md object-cover" />;
}
