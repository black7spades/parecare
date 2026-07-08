import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api, ApiError } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useAuthStore } from '../../../stores/auth';
import type { ChecklistItem, ChecklistNote } from '../../../lib/care';
import {
  matchingLifeStages,
  type CareJourney,
  type CareJourneyPhase,
  type JourneyTemplateFull,
  type JourneyTemplateSummary,
  type LifeStage,
} from '../../../lib/journeys';

/**
 * A person's care journeys: one card per journey, each with its own
 * forward-only phase strip and the checklist of the selected phase.
 * Several journeys can run at once, because a diagnosis does not pause
 * a life.
 */
export function JourneysSection({
  profileId,
  careName,
  dateOfBirth,
  dueDate,
}: {
  profileId: string;
  careName: string;
  dateOfBirth: string | null;
  dueDate?: string | null;
}) {
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['journeys', profileId],
    queryFn: () => api.get<{ journeys: CareJourney[] }>(`/care-profiles/${profileId}/journeys`),
  });
  const journeys = data?.journeys ?? [];
  const active = journeys.filter((j) => j.status === 'active' || j.status === 'paused');
  const past = journeys.filter((j) => j.status === 'completed' || j.status === 'handed_over');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">{careName ? `${careName}'s care journeys` : 'Care journeys'}</h2>
        <Button size="sm" variant="secondary" onClick={() => setEnrolOpen(true)}>
          Add a journey
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : active.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-sm text-muted mb-3">
            No journey underway. A journey gives {careName || 'this person'} phases to move through and a checklist for
            each one, from the library or built from scratch.
          </p>
          <Button size="sm" onClick={() => setEnrolOpen(true)}>
            Choose a journey
          </Button>
        </div>
      ) : (
        active.map((j) => <JourneyCard key={j.id} profileId={profileId} journey={j} />)
      )}

      {past.length > 0 ? (
        <div>
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowPast((v) => !v)}>
            {showPast ? 'Hide past journeys' : `Past journeys (${past.length})`}
          </button>
          {showPast ? (
            <div className="mt-3 space-y-4">
              {past.map((j) => (
                <JourneyCard key={j.id} profileId={profileId} journey={j} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <EnrolModal
        open={enrolOpen}
        onClose={() => setEnrolOpen(false)}
        profileId={profileId}
        dateOfBirth={dateOfBirth}
        dueDate={dueDate}
      />
    </div>
  );
}

function JourneyCard({ profileId, journey }: { profileId: string; journey: CareJourney }) {
  const queryClient = useQueryClient();
  const isSuperAdmin = useAuthStore((s) => s.account?.role) === 'super_admin';
  const currentPhase = journey.phases.find((p) => p.state === 'current');
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [target, setTarget] = useState<CareJourneyPhase | null>(null);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [addPhaseOpen, setAddPhaseOpen] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [error, setError] = useState('');

  const selected = journey.phases.find((p) => p.id === selectedPhaseId) ?? currentPhase ?? journey.phases[0];
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['journeys', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['care-profile', profileId] });
  };

  const moveMutation = useMutation({
    mutationFn: (phase_id: string) => api.post(`/care-profiles/${profileId}/journeys/${journey.id}/set-phase`, { phase_id }),
    onSuccess: () => {
      setTarget(null);
      setError('');
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['journey-checklist'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not change the phase.'),
  });

  const statusMutation = useMutation({
    mutationFn: (status: 'active' | 'paused' | 'completed') =>
      api.patch(`/care-profiles/${profileId}/journeys/${journey.id}`, { status }),
    onSuccess: invalidate,
  });

  const addPhaseMutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/journeys/${journey.id}/phases`, { name: newPhaseName.trim() }),
    onSuccess: () => {
      setAddPhaseOpen(false);
      setNewPhaseName('');
      invalidate();
    },
  });

  const ended = journey.status === 'completed' || journey.status === 'handed_over';
  const currentIndex = journey.phases.findIndex((p) => p.state === 'current');
  const onLastPhase = currentIndex >= 0 && currentIndex === journey.phases.length - 1;
  const targetIndex = target ? journey.phases.findIndex((p) => p.id === target.id) : -1;
  const goingBack = target !== null && currentIndex >= 0 && targetIndex < currentIndex;

  return (
    <div className={`card ${ended ? 'opacity-80' : ''}`}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-ink truncate">{journey.name}</h3>
          {journey.status === 'paused' ? <span className="badge bg-amber-50 text-amber-700 text-xs">Paused</span> : null}
          {journey.status === 'completed' ? <span className="badge bg-surface-2 text-muted text-xs">Completed</span> : null}
          {journey.status === 'handed_over' ? (
            <span className="badge bg-surface-2 text-muted text-xs">Handed over</span>
          ) : null}
        </div>
        {!ended ? (
          <div className="flex items-center gap-2 text-xs">
            {journey.handovers.length > 0 && onLastPhase ? (
              <Button size="sm" onClick={() => setHandoverOpen(true)}>
                Where next
              </Button>
            ) : null}
            {journey.status === 'paused' ? (
              <button type="button" className="text-primary hover:underline" onClick={() => statusMutation.mutate('active')}>
                Resume
              </button>
            ) : (
              <button type="button" className="text-muted hover:text-ink" onClick={() => statusMutation.mutate('paused')}>
                Pause
              </button>
            )}
            <button type="button" className="text-muted hover:text-ink" onClick={() => statusMutation.mutate('completed')}>
              Mark complete
            </button>
          </div>
        ) : null}
      </div>

      <ol className="flex flex-wrap items-center gap-y-2 mb-3">
        {journey.phases.map((phase, i) => {
          const locked = phase.state === 'locked';
          const isSelected = selected?.id === phase.id;
          const clickable = !ended && (phase.state === 'upcoming' || (locked && isSuperAdmin));
          return (
            <li key={phase.id} className="flex items-center">
              <button
                type="button"
                title={
                  locked
                    ? `Locked${phase.locked_at ? ` ${format(new Date(phase.locked_at), 'd MMM yyyy')}` : ''}${isSuperAdmin ? '. Click to reopen' : ''}`
                    : phase.description ?? undefined
                }
                onClick={() => {
                  setSelectedPhaseId(phase.id);
                  if (clickable && phase.state !== 'current') setTarget(phase);
                }}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ${
                  phase.state === 'current'
                    ? 'bg-primary text-white font-medium'
                    : locked
                      ? 'bg-primary-50 text-primary'
                      : 'bg-surface-2 text-muted hover:text-ink'
                } ${isSelected && phase.state !== 'current' ? 'ring-1 ring-primary' : ''}`}
              >
                <span
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                    phase.state === 'current'
                      ? 'bg-card text-primary'
                      : locked
                        ? 'bg-primary text-white'
                        : 'bg-card text-muted border border-border'
                  }`}
                >
                  {locked ? '🔒' : i + 1}
                </span>
                {phase.name}
                {phase.task_count > 0 ? (
                  <span className="text-[10px] opacity-75">
                    {phase.tasks_done}/{phase.task_count}
                  </span>
                ) : null}
              </button>
              {i < journey.phases.length - 1 ? <span className="mx-1 text-border select-none">›</span> : null}
            </li>
          );
        })}
        {!ended ? (
          <li>
            <button
              type="button"
              className="ml-1 rounded-full px-2 py-1 text-xs text-muted hover:text-ink"
              title="Add a phase to this journey only"
              onClick={() => setAddPhaseOpen(true)}
            >
              + phase
            </button>
          </li>
        ) : null}
      </ol>

      {selected ? <PhaseChecklist profileId={profileId} phase={selected} readOnly={ended} /> : null}

      <Modal open={target !== null} onClose={() => setTarget(null)} title={goingBack ? 'Reopen an earlier phase' : 'Move to this phase'}>
        <p className="text-sm text-muted mb-4">
          {goingBack ? (
            <>
              Reopen <span className="font-medium text-ink">{target?.name}</span> for editing? This moves the journey
              back so records can be corrected.
            </>
          ) : (
            <>
              Move to <span className="font-medium text-ink">{target?.name}</span>? Earlier phases are locked as a
              record, and this phase's checklist opens.
            </>
          )}
        </p>
        {error ? <p className="text-sm text-red-600 mb-3">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setTarget(null)}>
            Cancel
          </Button>
          <Button loading={moveMutation.isPending} onClick={() => target && moveMutation.mutate(target.id)}>
            {goingBack ? 'Reopen phase' : 'Move forward'}
          </Button>
        </div>
      </Modal>

      <Modal open={addPhaseOpen} onClose={() => setAddPhaseOpen(false)} title="Add a phase">
        <p className="text-sm text-muted mb-3">
          This adds a phase to this journey only. The library version is unchanged.
        </p>
        <Input label="Phase name" value={newPhaseName} onChange={(e) => setNewPhaseName(e.target.value)} />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setAddPhaseOpen(false)}>
            Cancel
          </Button>
          <Button loading={addPhaseMutation.isPending} disabled={!newPhaseName.trim()} onClick={() => addPhaseMutation.mutate()}>
            Add phase
          </Button>
        </div>
      </Modal>

      <HandoverModal
        open={handoverOpen}
        onClose={() => setHandoverOpen(false)}
        profileId={profileId}
        journey={journey}
      />
    </div>
  );
}

/** The labelled paths a journey can hand over to, chosen by a human. */
function HandoverModal({
  open,
  onClose,
  profileId,
  journey,
}: {
  open: boolean;
  onClose: () => void;
  profileId: string;
  journey: CareJourney;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (to_template_id: string) =>
      api.post(`/care-profiles/${profileId}/journeys/${journey.id}/handover`, { to_template_id }),
    onSuccess: () => {
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['journeys', profileId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not hand over.'),
  });
  return (
    <Modal open={open} onClose={onClose} title="Where next">
      <p className="text-sm text-muted mb-4">
        This journey can hand over to another. The current journey is kept as a completed record and the new one starts
        with its own phases and checklist. Nothing happens automatically; this is your choice.
      </p>
      <div className="space-y-2">
        {journey.handovers.map((h) => (
          <button
            key={h.id}
            type="button"
            className="w-full rounded-md border border-border bg-card p-3 text-left hover:border-primary transition-colors"
            onClick={() => mutation.mutate(h.to_template_id)}
          >
            <p className="text-sm font-medium text-ink">{h.label}</p>
            <p className="text-xs text-muted">Starts: {h.to_template_name}</p>
          </button>
        ))}
      </div>
      {error ? <p className="text-sm text-red-600 mt-3">{error}</p> : null}
      <div className="flex justify-end mt-4">
        <Button variant="ghost" onClick={onClose}>
          Not yet
        </Button>
      </div>
    </Modal>
  );
}

/**
 * The checklist of one journey phase. A ticked box asks for the story:
 * the date it really happened and a note, which is how the Memory Book
 * achievements database gets its memories.
 */
function PhaseChecklist({ profileId, phase, readOnly }: { profileId: string; phase: CareJourneyPhase; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState('');
  const [openNotesId, setOpenNotesId] = useState<string | null>(null);

  const listKey = ['journey-checklist', profileId, phase.id];
  const { data, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => api.get<{ items: ChecklistItem[] }>(`/care-profiles/${profileId}/checklists?journey_phase_id=${phase.id}`),
  });
  const items = data?.items ?? [];
  const locked = phase.state === 'locked';

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: listKey });
    void queryClient.invalidateQueries({ queryKey: ['journeys', profileId] });
    void queryClient.invalidateQueries({ queryKey: ['achievements', profileId] });
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api.patch(`/care-profiles/${profileId}/checklists/${id}`, { completed }),
    onSuccess: (_data, vars) => {
      if (vars.completed) setOpenNotesId(vars.id);
      invalidate();
    },
  });

  const milestoneMutation = useMutation({
    mutationFn: ({ id, is_milestone }: { id: string; is_milestone: boolean }) =>
      api.patch(`/care-profiles/${profileId}/checklists/${id}`, { is_milestone }),
    onSuccess: invalidate,
  });

  const addMutation = useMutation({
    mutationFn: (title: string) =>
      api.post(`/care-profiles/${profileId}/checklists`, { care_journey_phase_id: phase.id, title }),
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
  const disabled = readOnly || locked;

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-ink">
          {phase.name}
          {locked ? ' · locked record' : phase.state === 'upcoming' ? ' · upcoming' : ''}
        </p>
        {items.length > 0 ? (
          <span className="text-xs text-muted">
            {done} of {items.length} done
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">Nothing on this phase's checklist yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 group">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                checked={item.completed}
                disabled={disabled && !item.completed}
                onChange={(e) => !disabled && toggleMutation.mutate({ id: item.id, completed: e.target.checked })}
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${item.completed ? 'line-through text-muted' : 'text-ink'}`}>
                  {item.title}
                  {item.is_milestone ? (
                    <span className="ml-1" title="Milestone: celebrated in the Memory Book timeline">
                      ⭐
                    </span>
                  ) : null}
                </p>
                {item.description ? <p className="text-xs text-muted">{item.description}</p> : null}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline mt-0.5"
                    onClick={() => setOpenNotesId((v) => (v === item.id ? null : item.id))}
                  >
                    {item.note_count > 0 ? `Notes (${item.note_count})` : 'Add a note'}
                  </button>
                  {!disabled ? (
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-ink mt-0.5"
                      title="A milestone is celebrated in the Memory Book timeline. Everything completed still lands in the achievements record."
                      onClick={() => milestoneMutation.mutate({ id: item.id, is_milestone: !item.is_milestone })}
                    >
                      {item.is_milestone ? 'Unmark milestone' : 'Mark as milestone'}
                    </button>
                  ) : null}
                </div>
                {openNotesId === item.id ? <ItemNotesThread profileId={profileId} itemId={item.id} /> : null}
              </div>
              {!disabled && !item.completed ? (
                <button
                  type="button"
                  aria-label={`Delete ${item.title}`}
                  className="text-muted hover:text-red-600 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-sm px-1"
                  onClick={() => deleteMutation.mutate(item.id)}
                >
                  ✕
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!disabled ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newTitle.trim()) addMutation.mutate(newTitle.trim());
          }}
        >
          <div className="flex-1">
            <Input placeholder="Add a goal or task for this phase…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" loading={addMutation.isPending} disabled={!newTitle.trim()}>
            Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** Note thread with an optional photo: the memory attached to the record. */
export function ItemNotesThread({ profileId, itemId }: { profileId: string; itemId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['checklist-notes', itemId],
    queryFn: () => api.get<{ notes: (ChecklistNote & { photo_url?: string | null })[] }>(`/care-profiles/${profileId}/checklists/${itemId}/notes`),
  });
  const notes = data?.notes ?? [];

  const addMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('body', draft.trim());
      if (photo) form.append('photo', photo);
      return api.upload(`/care-profiles/${profileId}/checklists/${itemId}/notes`, form);
    },
    onSuccess: () => {
      setDraft('');
      setPhoto(null);
      if (fileInput.current) fileInput.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['checklist-notes', itemId] });
      void queryClient.invalidateQueries({ queryKey: ['journey-checklist'] });
      void queryClient.invalidateQueries({ queryKey: ['checklist', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['achievements', profileId] });
    },
  });

  return (
    <div className="mt-2 rounded-md border border-border bg-card p-2.5 space-y-2">
      {isLoading ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted">
          No notes yet. This is where the story lives: when it happened, who was there, what it was like. Add a photo
          if there is one.
        </p>
      ) : (
        notes.map((n) => (
          <div key={n.id}>
            <p className="text-xs text-muted">
              {n.author_name ?? 'Someone'} · {format(new Date(n.created_at), 'd MMM yyyy, HH:mm')}
            </p>
            <p className="text-sm text-ink whitespace-pre-wrap">{n.body}</p>
            {n.photo_url ? <NotePhoto profileId={profileId} itemId={itemId} noteId={n.id} /> : null}
          </div>
        ))
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) addMutation.mutate();
        }}
      >
        <Input
          aria-label="Add a note"
          placeholder="e.g. We did it on Saturday morning, the whole circle came…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            aria-label="Attach a photo to the note"
            className="flex-1 text-xs text-muted file:mr-2 file:rounded-md file:border-0 file:bg-primary-50 file:px-2 file:py-1 file:text-xs file:text-primary hover:file:bg-primary-100"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          <Button type="submit" size="sm" variant="secondary" loading={addMutation.isPending} disabled={!draft.trim()}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}

function NotePhoto({ profileId, itemId, noteId }: { profileId: string; itemId: string; noteId: string }) {
  const { data: src } = useQuery({
    queryKey: ['note-photo', noteId],
    queryFn: async () => URL.createObjectURL(await api.blob(`/care-profiles/${profileId}/checklists/${itemId}/notes/${noteId}/photo`)),
    staleTime: Infinity,
  });
  if (!src) return <div className="mt-1 h-24 w-32 rounded-md bg-surface-2 animate-pulse" />;
  return <img src={src} alt="Note photo" className="mt-1 max-h-48 rounded-md object-cover" />;
}

/**
 * Choosing a journey: suggestions for the person's life stages first,
 * the whole library behind them. Any journey can be applied to anyone;
 * the stage only orders the menu.
 */
function EnrolModal({
  open,
  onClose,
  profileId,
  dateOfBirth,
  dueDate,
}: {
  open: boolean;
  onClose: () => void;
  profileId: string;
  dateOfBirth: string | null;
  dueDate?: string | null;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data: stagesData } = useQuery({
    queryKey: ['life-stages'],
    queryFn: () => api.get<{ stages: LifeStage[] }>(`/life-stages`),
    enabled: open,
  });
  const { data: templatesData } = useQuery({
    queryKey: ['journey-templates'],
    queryFn: () => api.get<{ templates: JourneyTemplateSummary[] }>(`/journey-templates`),
    enabled: open,
  });
  const { data: previewData } = useQuery({
    queryKey: ['journey-template', previewId],
    queryFn: () => api.get<{ template: JourneyTemplateFull }>(`/journey-templates/${previewId}`),
    enabled: !!previewId,
  });

  const stages = useMemo(() => stagesData?.stages ?? [], [stagesData]);
  const templates = useMemo(() => templatesData?.templates ?? [], [templatesData]);
  const matched = useMemo(
    () => matchingLifeStages(stages, { date_of_birth: dateOfBirth, due_date: dueDate }),
    [stages, dateOfBirth, dueDate]
  );
  const matchedIds = new Set(matched.map((s) => s.id));

  const filtered = templates.filter(
    (t) =>
      !search.trim() ||
      t.name.toLowerCase().includes(search.trim().toLowerCase()) ||
      (t.description ?? '').toLowerCase().includes(search.trim().toLowerCase())
  );
  const suggested = filtered.filter((t) => t.life_stage_ids.some((id) => matchedIds.has(id)));
  const rest = filtered.filter((t) => !t.life_stage_ids.some((id) => matchedIds.has(id)));

  const enrolMutation = useMutation({
    mutationFn: (template_id: string) => api.post(`/care-profiles/${profileId}/journeys`, { template_id }),
    onSuccess: () => {
      onClose();
      setPreviewId(null);
      void queryClient.invalidateQueries({ queryKey: ['journeys', profileId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not start the journey.'),
  });

  const preview = previewData?.template;

  const templateRow = (t: JourneyTemplateSummary) => (
    <button
      key={t.id}
      type="button"
      className={`w-full rounded-md border p-2.5 text-left transition-colors ${
        previewId === t.id ? 'border-primary bg-primary-50' : 'border-border bg-card hover:border-primary'
      }`}
      onClick={() => setPreviewId(t.id)}
    >
      <p className="text-sm font-medium text-ink">{t.name}</p>
      <p className="text-xs text-muted line-clamp-2">{t.description}</p>
      <p className="text-xs text-muted mt-0.5">
        {t.phase_count} phases · {t.task_count} checklist items
      </p>
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title="Choose a journey" wide>
      <div className="space-y-3">
        <Input placeholder="Search the journey library…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2 max-h-96 overflow-y-auto pr-1">
          <div className="space-y-2">
            {matched.length > 0 && suggested.length > 0 ? (
              <>
                <p className="text-xs font-medium text-muted uppercase tracking-wide">
                  Suggested for {matched.map((s) => s.name.toLowerCase()).join(', ')}
                </p>
                {suggested.map(templateRow)}
              </>
            ) : null}
            {rest.length > 0 ? (
              <>
                <p className="text-xs font-medium text-muted uppercase tracking-wide pt-1">
                  {suggested.length > 0 ? 'Everything else' : 'The whole library'}
                </p>
                {rest.map(templateRow)}
              </>
            ) : null}
            {filtered.length === 0 ? <p className="text-sm text-muted">Nothing matches that search.</p> : null}
          </div>
          <div className="rounded-md border border-border bg-surface p-3 h-fit sticky top-0">
            {preview ? (
              <>
                <p className="text-sm font-semibold text-ink">{preview.name}</p>
                <p className="text-xs text-muted mb-2">{preview.description}</p>
                <ol className="space-y-1 mb-3">
                  {preview.phases.map((p, i) => (
                    <li key={p.id ?? i} className="text-xs text-ink">
                      <span className="text-muted">{i + 1}.</span> {p.name}
                      <span className="text-muted"> · {p.tasks.length} items</span>
                    </li>
                  ))}
                </ol>
                {error ? <p className="text-xs text-red-600 mb-2">{error}</p> : null}
                <Button size="sm" className="w-full" loading={enrolMutation.isPending} onClick={() => enrolMutation.mutate(preview.id)}>
                  Start this journey
                </Button>
                <p className="text-xs text-muted mt-2">
                  The journey becomes this person's own copy. Phases and items can be renamed, added or removed for
                  them without changing the library.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted">Select a journey to see its phases before starting it.</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
