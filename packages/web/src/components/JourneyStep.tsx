import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { PersonPicker } from './PersonPicker';
import { CONTACT_LINK } from './ContactStrip';
import { bookingHref } from '../lib/booking';
import { REPEAT_CHOICES, repeatLabel, type RepeatChoice } from '../lib/repeat';
import { parseDateOnly } from '../lib/datetime';
import { useNoticeStore } from '../stores/notice';
import type { ChecklistItem } from '../lib/care';
import {
  RECORD_ACTIONS,
  appointmentTypeForStep,
  bookingTitleFromStep,
  journeyPageHref,
  JOURNEY_PAGES,
  type JourneyItemTask,
} from '../lib/journeyActions';

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** "Tue 3 Dec" for a task's due date; a whole day reads as the day only. */
export function dueLabel(task: Pick<JourneyItemTask, 'next_due_at' | 'all_day'>): string {
  const at = new Date(task.next_due_at);
  return task.all_day ? format(at, 'EEE d MMM yyyy') : format(at, "EEE d MMM yyyy, h:mmaaa");
}

/**
 * The one thing a journey step does, by its kind: Book it, Add a task,
 * Upload, Call the number, add the record it is about, or open the page it
 * happens on. Once done, it says what was done instead.
 */
export function StepAction({
  profileId,
  item,
  canAct,
  onUpload,
  onSetTask,
  onDone,
  doneLoading,
  fundingManager,
}: {
  profileId: string;
  item: ChecklistItem;
  canAct: boolean;
  /** Who keeps the funding plan, when the viewer cannot: funding steps say so instead of offering a form they cannot use. */
  fundingManager?: string | null;
  onUpload: (item: ChecklistItem) => void;
  onSetTask: (item: ChecklistItem) => void;
  /** Tick the step off, for a call made or a page visited. */
  onDone: (item: ChecklistItem) => void;
  doneLoading?: boolean;
}) {
  const navigate = useNavigate();
  const action = item.action;

  // What was done from the step, said plainly.
  const appt = item.appointment;
  const doc = item.documents?.[item.documents.length - 1];
  const rec = item.linked_record;
  const after = appt ? (
    appt.starts_at ? (
      <span className="text-xs text-muted">
        Booked for{' '}
        <Link to={`/app/${profileId}/appointments?record=${appt.id}`} className={CONTACT_LINK}>
          {format(new Date(appt.starts_at), appt.all_day ? 'EEE d MMM yyyy' : "EEE d MMM yyyy, h:mmaaa")}
        </Link>
      </span>
    ) : (
      <span className="text-xs text-muted">
        Saved as not booked yet.{' '}
        <Link to={`/app/${profileId}/appointments?book=${appt.id}`} className={CONTACT_LINK}>Add the date</Link>
      </span>
    )
  ) : doc ? (
    <span className="text-xs text-muted">
      Uploaded <Link to={`/app/${profileId}/documents?doc=${doc.id}`} className={CONTACT_LINK}>{doc.label}</Link>
    </span>
  ) : rec ? (
    <span className="text-xs text-muted">
      Added <Link to={rec.path} className={CONTACT_LINK}>{rec.label}</Link>
    </span>
  ) : null;

  if (after && (item.completed || action !== 'task')) return after;
  if (item.completed || !canAct || !action) return after;

  const done = (
    <Button size="xs" variant="ghost" loading={doneLoading} onClick={() => onDone(item)}>
      Done
    </Button>
  );

  if (action === 'book') {
    const contact = item.action_contact;
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="secondary"
          onClick={() =>
            navigate(
              bookingHref(profileId, {
                provider: contact?.source === 'contact' ? contact.id : null,
                title: bookingTitleFromStep(item.title),
                type: appointmentTypeForStep(item.title, item.description),
                fromTask: item.task && !item.task.completed ? item.task.id : null,
                fromJourneyItem: item.id,
              })
            )
          }
        >
          Book it
        </Button>
        {contact ? <span className="text-xs text-muted">With {contact.name}</span> : null}
      </span>
    );
  }

  if (action === 'task') {
    if (item.task) return null;
    return (
      <Button size="xs" variant="secondary" onClick={() => onSetTask(item)}>
        Add a task
      </Button>
    );
  }

  if (action === 'upload') {
    return (
      <Button size="xs" variant="secondary" onClick={() => onUpload(item)}>
        Upload
      </Button>
    );
  }

  if (action === 'call') {
    const phone = item.action_phone ?? item.action_contact?.phone ?? null;
    const name = item.action_contact_name ?? item.action_contact?.name ?? null;
    if (!phone) {
      // No number to call yet: it can still be a task with a date.
      return (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">No number on file for this yet.</span>
          {item.task ? null : (
            <Button size="xs" variant="secondary" onClick={() => onSetTask(item)}>
              Add a task
            </Button>
          )}
        </span>
      );
    }
    return (
      <span className="flex flex-wrap items-center gap-2">
        <a href={telHref(phone)} className={`text-sm ${CONTACT_LINK}`} aria-label={`Call ${name ?? ''} on ${phone}`.replace('  ', ' ')}>
          {name ? `${name} ${phone}` : phone}
        </a>
        {item.action_url ? (
          <a href={item.action_url} target="_blank" rel="noopener noreferrer" className={`text-sm ${CONTACT_LINK}`}>
            {name ? `${name} website` : 'Their website'}
          </a>
        ) : null}
        {done}
      </span>
    );
  }

  if (action === 'open') {
    const href = journeyPageHref(profileId, item.action_page ?? null);
    const label = JOURNEY_PAGES.find((p) => p.value === item.action_page)?.button ?? 'Open';
    if (!href) return null;
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Link to={href} className={`text-sm ${CONTACT_LINK}`}>{label}</Link>
        {done}
      </span>
    );
  }

  if (action === 'funding' && fundingManager !== undefined && fundingManager !== null) {
    return <span className="text-xs text-muted">{fundingManager} adds the funding plan, because the budgets are the household's money.</span>;
  }
  const rec2 = RECORD_ACTIONS[action];
  if (rec2) {
    const q = new URLSearchParams({ ...rec2.params, from_journey_item: item.id });
    return (
      <Button size="xs" variant="secondary" onClick={() => navigate(`/app/${profileId}/${rec2.page}?${q.toString()}`)}>
        {rec2.button}
      </Button>
    );
  }
  return null;
}

/**
 * Below a step: when it is due, who is doing it and how it repeats, from
 * its task, with Change. A step with no task offers "Set a date".
 */
export function StepTaskLine({ profileId, item, canAct, onSetTask }: { profileId: string; item: ChecklistItem; canAct: boolean; onSetTask: (item: ChecklistItem) => void }) {
  const t = item.task;
  if (!t) {
    // "Add a task" is already the step's own button; a done step or a milestone with nothing to do needs no date.
    if (!canAct || item.completed || item.action === 'task' || !item.action) return null;
    if (item.action === 'call' && !(item.action_phone ?? item.action_contact?.phone)) return null;
    return (
      <Button size="xs" variant="ghost" onClick={() => onSetTask(item)}>
        Set a date
      </Button>
    );
  }
  // A repeating task ticked for this round stays open with its next date.
  const roundDone = item.completed && !t.completed && t.repeat !== 'once';
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {roundDone ? (
        <span>
          Done for this round. Next due <span className="text-ink">{dueLabel(t)}</span>
        </span>
      ) : (
        <span>
          Due <span className="text-ink">{dueLabel(t)}</span>
        </span>
      )}
      <span>
        Who is doing it <span className="text-ink">{t.assigned_name ?? 'Anyone'}</span>
      </span>
      <span>
        Repeats <span className="text-ink">{repeatLabel(t.repeat)}</span>
      </span>
      <Link to={`/app/${profileId}/tasks?record=${t.id}`} className={CONTACT_LINK}>
        Open the task
      </Link>
      {canAct && !item.completed ? (
        <Button size="xs" variant="ghost" onClick={() => onSetTask(item)}>
          Change
        </Button>
      ) : null}
    </span>
  );
}

const keyOf = (t: JourneyItemTask | null | undefined) =>
  t?.assigned_account_id ? `a:${t.assigned_account_id}` : t?.assigned_to ? `m:${t.assigned_to}` : '';

const toDateInput = (t: JourneyItemTask | null | undefined, fallback: string | undefined) => {
  if (t) return format(new Date(t.next_due_at), 'yyyy-MM-dd');
  return fallback && parseDateOnly(fallback) ? fallback : '';
};

/**
 * Give a step its task: Due, Who is doing it, Repeats. Saving always
 * answers: a missing date is named beside Save.
 */
export function StepTaskModal({ profileId, item, onClose }: { profileId: string; item: ChecklistItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const notice = useNoticeStore((s) => s.show);
  const [due, setDue] = useState(() => toDateInput(item.task, item.default_due_on));
  const [who, setWho] = useState(() => keyOf(item.task));
  const [repeat, setRepeat] = useState<RepeatChoice>(() => item.task?.repeat ?? item.repeat ?? 'once');
  const [missing, setMissing] = useState('');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.post<{ item: ChecklistItem; task_id: string }>(`/care-profiles/${profileId}/checklists/${item.id}/task`, {
        due_on: due,
        assigned_account_id: who.startsWith('a:') ? who.slice(2) : null,
        assigned_to: who.startsWith('m:') ? who.slice(2) : null,
        repeat,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    onSuccess: () => {
      const d = parseDateOnly(due);
      notice({ message: `${item.task ? 'Task changed' : 'Task added'} for ${d ? format(d, 'EEE d MMM yyyy') : due}.` });
      void queryClient.invalidateQueries({ queryKey: ['journey-checklist'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['journeys', profileId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The task did not save. Try again in a moment.'),
  });

  return (
    <Modal open onClose={onClose} title={item.title}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!due) {
            setMissing('Pick the day it is due.');
            document.getElementById('step-due')?.focus();
            return;
          }
          setMissing('');
          save.mutate();
        }}
      >
        <p className="text-xs text-muted">
          A task reminds whoever is doing it, and shows on Tasks. Ticking the task ticks this step too.
        </p>
        <div>
          <label htmlFor="step-due" className="block text-sm font-medium text-ink mb-1">Due</label>
          <input
            id="step-due"
            type="date"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={due}
            onChange={(e) => {
              setDue(e.target.value);
              if (e.target.value) setMissing('');
            }}
          />
        </div>
        <PersonPicker id="step-who" label="Who is doing it" profileId={profileId} value={who} onChange={(k) => setWho(k)} />
        <div>
          <label htmlFor="step-repeat" className="block text-sm font-medium text-ink mb-1">Repeats</label>
          <select
            id="step-repeat"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as RepeatChoice)}
          >
            {REPEAT_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {missing ? <p className="text-sm text-red-600 mr-auto" role="alert">{missing}</p> : null}
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
