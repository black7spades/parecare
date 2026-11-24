import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { ContactPicker, contactProblem, contactPayload, emptyContact, type PickedContact } from '../../../components/ContactPicker';
import { PersonPicker } from '../../../components/PersonPicker';
import { DocumentAttach } from '../../../components/DocumentAttach';
import { useNextStepTypes } from '../../../lib/nextSteps';
import { REPEAT_CHOICES } from '../../../lib/repeat';
import { browserTimeZone } from '../../../lib/datetime';
import { personKey, type CareProfile, type Task } from '../../../lib/care';
import { noticeFiled, refreshContacts } from '../../../stores/notice';

const selectClass =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const pad = (n: number) => String(n).padStart(2, '0');

/** Everything the task form asks for, one value per field. */
export interface TaskDraft {
  title: string;
  who: PickedContact;
  kindId: string;
  conditionId: string;
  notes: string;
  goal: string;
  dueDate: string;
  /** Blank means any time that day. */
  dueTime: string;
  repeat: string;
  /** personKey of who it is assigned to, or empty for anyone. */
  assignee: string;
  documentIds: string[];
  alsoIds: string[];
}

export const newTaskDraft = (init: Partial<TaskDraft> = {}): TaskDraft => ({
  title: '', who: emptyContact, kindId: '', conditionId: '', notes: '', goal: '', dueDate: '', dueTime: '',
  repeat: 'once', assignee: '', documentIds: [], alsoIds: [], ...init,
});

export function draftFromTask(t: Task): TaskDraft {
  const d = new Date(t.next_due_at);
  return {
    title: t.title,
    who: t.provider_id ? { providerId: t.provider_id, name: t.provider?.name ?? t.provider_name ?? '', providerType: '', phone: '' } : emptyContact,
    kindId: t.next_step_type_id ?? '',
    conditionId: t.medical_condition_id ?? '',
    notes: t.body ?? '',
    goal: t.desired_outcome ?? '',
    dueDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    dueTime: t.all_day ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    repeat: t.repeat ?? t.reminder_type ?? 'once',
    assignee: t.assigned_account_id ? personKey({ account_id: t.assigned_account_id }) : t.assigned_to ? personKey({ circle_member_id: t.assigned_to }) : '',
    documentIds: (t.documents ?? []).map((x) => x.id),
    alsoIds: [],
  };
}

/** What is missing, in the words shown beside Save. */
export function taskMissing(d: TaskDraft): { title?: string; dueDate?: string; who?: string; sentence: string } {
  const out: { title?: string; dueDate?: string; who?: string } = {};
  if (!d.title.trim()) out.title = 'Say what needs doing, e.g. Book a neurologist.';
  if (!d.dueDate) out.dueDate = 'Pick the day it is due.';
  const who = contactProblem(d.who);
  if (who) out.who = who;
  const parts = [out.title ? 'what needs doing' : null, out.dueDate ? 'a due date' : null].filter(Boolean);
  const sentence = [parts.length ? `This task needs ${parts.join(' and ')}.` : '', who ?? ''].filter(Boolean).join(' ');
  return { ...out, sentence };
}

/** The draft as the tasks API takes it. */
export function taskBody(d: TaskDraft) {
  const assign = d.assignee.startsWith('a:')
    ? { assigned_account_id: d.assignee.slice(2), assigned_to: null }
    : d.assignee.startsWith('m:')
      ? { assigned_to: d.assignee.slice(2), assigned_account_id: null }
      : { assigned_to: null, assigned_account_id: null };
  return {
    title: d.title.trim(),
    body: d.notes.trim() || null,
    ...(d.dueTime
      ? { next_due_at: new Date(`${d.dueDate}T${d.dueTime}`).toISOString(), all_day: false }
      : { due_on: d.dueDate }),
    tz: browserTimeZone() ?? null,
    repeat: d.repeat,
    desired_outcome: d.goal.trim() || null,
    ...contactPayload(d.who),
    next_step_type_id: d.kindId || null,
    medical_condition_id: d.conditionId || null,
    ...assign,
    document_ids: d.documentIds,
  };
}

export interface JoinedInfo {
  id: string;
  title: string;
  previous: Record<string, unknown>;
  note_id: string | null;
  document_ids: string[];
  /** Whose details it now has, when it had none. */
  name?: string | null;
}

/**
 * Said when a new booking joined the open task already doing it, with the
 * way to keep them apart.
 */
export function JoinedNotice({
  profileId,
  joined,
  create,
  onDone,
}: {
  profileId: string;
  joined: JoinedInfo;
  /** The task as it would have been made on its own. */
  create: Record<string, unknown>;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const separate = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/reminders/${joined.id}/separate`, {
        previous: joined.previous,
        note_id: joined.note_id,
        document_ids: joined.document_ids,
        create,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['appointments', profileId] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'They could not be kept apart. Try again in a moment.'),
  });
  return (
    <div className="card flex flex-wrap items-center gap-3" role="status">
      <p className="flex-1 text-sm text-ink">
        You already had “{joined.title}”.{' '}
        {joined.name ? `It now has ${joined.name}'s details, so there is one task for this booking.` : 'The new details are added to it, so there is one task for this booking.'}
      </p>
      <Button size="sm" variant="ghost" loading={separate.isPending} onClick={() => separate.mutate()}>Keep them separate</Button>
      <Button size="sm" variant="ghost" onClick={onDone}>Dismiss</Button>
      {error ? <p className="w-full text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

/**
 * The task form's fields, in order: what needs doing, who with, what kind,
 * what it is for, notes, what done looks like, when, repeats, who does it,
 * documents, and other profiles. Used by New task and by Edit.
 */
export function TaskFields({
  profileId,
  value,
  onChange,
  errors = {},
  task,
  otherProfiles = [],
  idPrefix = 'task',
}: {
  profileId: string;
  value: TaskDraft;
  onChange: (next: TaskDraft) => void;
  errors?: { title?: string; dueDate?: string };
  /** The task being edited, for what was worked out from its words. */
  task?: Task | null;
  otherProfiles?: Array<CareProfile & { relationship: string | null }>;
  idPrefix?: string;
}) {
  const set = (patch: Partial<TaskDraft>) => onChange({ ...value, ...patch });
  const { data: kindData } = useNextStepTypes(profileId);
  const kinds = kindData?.types ?? [];
  const { data: conditionData } = useQuery({
    queryKey: ['conditions', profileId],
    queryFn: () => api.get<{ conditions: { id: string; name: string }[] }>(`/care-profiles/${profileId}/conditions`),
  });
  const conditions = conditionData?.conditions ?? [];
  const [shareOpen, setShareOpen] = useState(false);
  const inferred = new Set(task?.inferred_fields ?? []);
  const whoInferred = !!task && inferred.has('provider_id') && value.who.providerId === (task.provider_id ?? '') && !!task.provider;
  const kindInferred = !!task && inferred.has('next_step_type_id') && value.kindId === (task.next_step_type_id ?? '');

  return (
    <div className="space-y-3">
      <Input
        id={`${idPrefix}-title`}
        label="Task"
        value={value.title}
        onChange={(e) => set({ title: e.target.value })}
        placeholder="e.g. Book a neurologist"
        error={errors.title}
      />
      <div>
        <ContactPicker id={`${idPrefix}-who`} profileId={profileId} value={value.who} onChange={(who) => set({ who })} />
        {whoInferred ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">
              Linked to {task!.provider!.name}{task!.provider!.role_label ? `, ${task!.provider!.role_label}` : ''}, from the title.
            </span>
            <Button type="button" size="xs" variant="ghost" onClick={() => set({ who: emptyContact })}>Change</Button>
          </div>
        ) : null}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-kind`} className="block text-sm font-medium text-ink mb-1">What kind of task</label>
        <select id={`${idPrefix}-kind`} className={selectClass} value={value.kindId} onChange={(e) => set({ kindId: e.target.value })}>
          <option value="">Just a task</option>
          {kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        {kindInferred ? <p className="mt-1 text-xs text-muted">Worked out from the title. Change it if it is wrong.</p> : null}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-condition`} className="block text-sm font-medium text-ink mb-1">What it is for</label>
        <select id={`${idPrefix}-condition`} className={selectClass} value={value.conditionId} onChange={(e) => set({ conditionId: e.target.value })}>
          <option value="">Not for a particular condition</option>
          {conditions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <Textarea
        id={`${idPrefix}-notes`}
        label="Notes"
        value={value.notes}
        onChange={(e) => set({ notes: e.target.value })}
        rows={2}
        hint="Phone numbers and links in notes can be tapped."
      />
      <Textarea
        id={`${idPrefix}-goal`}
        label="What done looks like"
        value={value.goal}
        onChange={(e) => set({ goal: e.target.value })}
        rows={2}
        placeholder="e.g. Appointment booked before Christmas"
      />
      <div className="grid grid-cols-2 gap-2">
        <Input id={`${idPrefix}-date`} label="Due date" type="date" value={value.dueDate} onChange={(e) => set({ dueDate: e.target.value })} error={errors.dueDate} />
        <Input
          id={`${idPrefix}-time`}
          label="Time"
          type="time"
          value={value.dueTime}
          onChange={(e) => set({ dueTime: e.target.value })}
          hint="Leave the time blank for any time that day."
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-repeat`} className="block text-sm font-medium text-ink mb-1">Repeats</label>
        <select id={`${idPrefix}-repeat`} className={selectClass} value={value.repeat} onChange={(e) => set({ repeat: e.target.value })}>
          {REPEAT_CHOICES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <PersonPicker id={`${idPrefix}-assignee`} label="Assign to" profileId={profileId} value={value.assignee} onChange={(assignee) => set({ assignee })} />
      <DocumentAttach profileId={profileId} idPrefix={`${idPrefix}-doc`} label="Documents" value={value.documentIds} onChange={(documentIds) => set({ documentIds })} />
      {otherProfiles.length > 0 && !task ? (
        <div className="rounded-sm border border-border">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full !justify-between"
            aria-expanded={shareOpen}
            onClick={() => setShareOpen((v) => !v)}
          >
            <span>
              Also add to other profiles
              {value.alsoIds.length > 0 ? <span className="text-primary"> · {value.alsoIds.length}</span> : null}
            </span>
            <span aria-hidden="true">{shareOpen ? '▲' : '▼'}</span>
          </Button>
          {shareOpen ? (
            <div className="max-h-40 overflow-y-auto border-t border-border px-3 py-2 space-y-1">
              <p className="text-xs text-muted mb-1">For a shared trip like the same vet or doctor visit. Each profile gets its own copy.</p>
              {otherProfiles.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    checked={value.alsoIds.includes(p.id)}
                    onChange={() => set({ alsoIds: value.alsoIds.includes(p.id) ? value.alsoIds.filter((x) => x !== p.id) : [...value.alsoIds, p.id] })}
                  />
                  <span className="text-ink">{p.preferred_name ?? p.full_name}</span>
                  {p.relationship ? <span className="text-xs text-muted">Your {p.relationship}</span> : null}
                </label>
              ))}
              {value.alsoIds.length > 0 ? (
                <p className="text-xs text-muted pt-1">The assignee applies to this profile only; copies are left unassigned.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface SavedTask {
  reminder: Task;
  joined_into?: JoinedInfo | null;
  filed?: Array<{ id: string; name: string }>;
  created?: { profile_id: string }[];
  skipped?: { profile_id: string; reason: 'no_access' | 'view_only' }[];
}

/** Edit a task, in a window over the list. */
export function TaskEditor({
  profileId,
  task,
  focus,
  onClose,
  onSaved,
}: {
  profileId: string;
  task: Task;
  /** A box to start in, e.g. who-with from "Add who it is with". */
  focus?: 'who';
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TaskDraft>(() => draftFromTask(task));
  const [tried, setTried] = useState(false);
  const [error, setError] = useState('');
  const missing = taskMissing(draft);
  useEffect(() => {
    if (focus === 'who') window.setTimeout(() => document.getElementById('edit-task-who')?.focus(), 50);
  }, [focus]);

  const save = useMutation({
    mutationFn: () => {
      const body = taskBody(draft);
      return api.patch<SavedTask>(`/care-profiles/${profileId}/reminders/${task.id}`, body);
    },
    onSuccess: (res) => {
      noticeFiled(profileId, res?.filed);
      refreshContacts(queryClient);
      onSaved();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The task did not save. Check your connection and try again.'),
  });

  return (
    <Modal open onClose={onClose} title="Edit task" wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          setError('');
          if (missing.title) document.getElementById('edit-task-title')?.focus();
          else if (missing.dueDate) document.getElementById('edit-task-date')?.focus();
          else if (missing.who) document.getElementById('edit-task-who')?.focus();
          else save.mutate();
        }}
      >
        <TaskFields profileId={profileId} value={draft} onChange={setDraft} errors={tried ? missing : {}} task={task} idPrefix="edit-task" />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {tried && missing.sentence ? <p className="text-sm text-red-600" role="alert">{missing.sentence}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}
