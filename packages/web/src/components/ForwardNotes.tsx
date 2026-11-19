import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../api/client';
import { useHiddenIds, useUndoStore } from '../stores/undo';
import type { NextStep } from '../lib/nextSteps';
import { Button } from './ui/Button';
import { Textarea } from './ui/Input';
import { Modal } from './ui/Modal';

/**
 * Forwarding what was noted at one appointment to another. A forwarded piece
 * shows greyed at the source with where it went; its copy shows at the
 * other end with who it is from. Sent to a next step not booked yet, it waits
 * and lands when that step is booked.
 */

export type ForwardPart = 'outcome' | 'details' | 'note';

/** Something this appointment passed on. */
export interface SentForward {
  id: string;
  part: ForwardPart;
  source_note_id: string | null;
  to_label: string;
  to_appointment_id: string | null;
  to_reminder_id: string | null;
  /** Waiting on a next step that is not booked yet. */
  waiting: boolean;
  forwarded_at: string;
}

/** Where a forwarded copy came from. */
export interface ForwardedFrom {
  label: string;
  on: string;
  appointment_id: string | null;
}

/** The parts of an appointment the forwarding forms need. */
export interface ForwardSource {
  id: string;
  title: string;
  starts_at: string;
  provider_name: string | null;
  outcome?: string | null;
  notes: string | null;
  next_steps?: NextStep[];
  forwarded?: SentForward[];
}

interface AddedNote {
  id: string;
  body: string;
  created_at: string;
  author_name: string | null;
  forwarded_to?: SentForward[];
  forwarded_from?: ForwardedFrom | null;
}

/** One piece that could be sent. */
export interface ForwardCandidate {
  key: string;
  part: ForwardPart;
  noteId: string | null;
  label: string;
  text: string;
}

/** What is ticked, and the text as trimmed if it was. */
export type PickState = Record<string, { on: boolean; body?: string }>;

export const appointmentRecordLink = (profileId: string, id: string) => `/app/${profileId}/appointments?record=${id}`;

/** The pieces of an appointment that can be forwarded: what happened, its notes box, and each added note. */
export function useForwardCandidates(profileId: string, source: ForwardSource, outcomeText?: string) {
  const { data } = useQuery({
    queryKey: ['record-extras', profileId, 'appointments', source.id],
    queryFn: () => api.get<{ notes: AddedNote[] }>(`/care-profiles/${profileId}/records/appointments/${source.id}`),
  });
  return useMemo(() => {
    const out: ForwardCandidate[] = [];
    const outcome = (outcomeText ?? source.outcome ?? '').trim();
    if (outcome) out.push({ key: 'outcome', part: 'outcome', noteId: null, label: 'What happened', text: outcome });
    if (source.notes?.trim()) out.push({ key: 'details', part: 'details', noteId: null, label: 'Notes', text: source.notes.trim() });
    for (const n of [...(data?.notes ?? [])].reverse()) {
      out.push({
        key: `note:${n.id}`,
        part: 'note',
        noteId: n.id,
        label: `Note from ${n.author_name ?? 'someone'}, ${format(new Date(n.created_at), 'd MMM')}`,
        text: n.body,
      });
    }
    return out;
  }, [data, outcomeText, source.outcome, source.notes]);
}

/** The ticked pieces, ready to send. */
export function pickedItems(candidates: ForwardCandidate[], picks: PickState) {
  return candidates
    .filter((c) => picks[c.key]?.on)
    .map((c) => ({ part: c.part, note_id: c.noteId, body: (picks[c.key]?.body ?? c.text).trim() }))
    .filter((i) => i.body);
}

/**
 * Tick which pieces go. A ticked piece opens so the text can be trimmed to
 * just the part that matters; the original stays as it was.
 */
export function NotePicker({
  candidates,
  picks,
  onChange,
  idPrefix,
}: {
  candidates: ForwardCandidate[];
  picks: PickState;
  onChange: (next: PickState) => void;
  idPrefix: string;
}) {
  if (candidates.length === 0) {
    return <p className="text-sm text-muted">Nothing noted yet. Write what happened above, or add a note to this appointment, and it can go too.</p>;
  }
  const allOn = candidates.every((c) => picks[c.key]?.on);
  return (
    <div className="space-y-2">
      {candidates.length > 1 ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            onChange(Object.fromEntries(candidates.map((c) => [c.key, { ...picks[c.key], on: !allOn }])))
          }
        >
          {allOn ? 'Untick all' : 'Tick all'}
        </Button>
      ) : null}
      <ul className="space-y-2">
        {candidates.map((c) => {
          const pick = picks[c.key];
          const id = `${idPrefix}-${c.key}`;
          return (
            <li key={c.key} className="rounded-md border border-border px-3 py-2">
              <label htmlFor={id} className="flex items-start gap-2">
                <input
                  id={id}
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={!!pick?.on}
                  onChange={() => onChange({ ...picks, [c.key]: { ...pick, on: !pick?.on } })}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted">{c.label}</span>
                  {!pick?.on ? <span className="block text-sm text-ink line-clamp-2 break-words">{c.text}</span> : null}
                </span>
              </label>
              {pick?.on ? (
                <Textarea
                  aria-label={`What to send from ${c.label}`}
                  className="mt-2"
                  rows={Math.min(6, Math.max(2, Math.ceil((pick.body ?? c.text).length / 70)))}
                  value={pick.body ?? c.text}
                  onChange={(e) => onChange({ ...picks, [c.key]: { on: true, body: e.target.value } })}
                  hint="Trim it to just what they need. The original stays as it is."
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const invalidateForwards = (queryClient: ReturnType<typeof useQueryClient>, profileId: string) => {
  void queryClient.invalidateQueries({ queryKey: ['appointments', profileId] });
  void queryClient.invalidateQueries({ queryKey: ['record-extras', profileId] });
};

/**
 * "Forwarded to Dr Patel on 19 Nov", or "Waiting to go to Referral once it is
 * booked", with Take back. Taking back removes the copy at the other end too,
 * with a few seconds to Undo.
 */
export function ForwardTags({ profileId, forwards, canEdit }: { profileId: string; forwards: SentForward[]; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const hidden = useHiddenIds();
  const shown = forwards.filter((f) => !hidden.has(f.id));
  if (shown.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {shown.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span>
            {f.waiting ? 'Waiting to go to ' : 'Forwarded to '}
            {f.to_appointment_id ? (
              <Link to={appointmentRecordLink(profileId, f.to_appointment_id)} className="text-primary hover:underline">{f.to_label}</Link>
            ) : (
              f.to_label
            )}
            {f.waiting ? `, sent ${format(new Date(f.forwarded_at), 'd MMM')}. It lands on the appointment once booked.` : ` on ${format(new Date(f.forwarded_at), 'd MMM yyyy')}`}
          </span>
          {canEdit ? (
            <Button
              size="xs"
              variant="ghost-danger"
              onClick={() =>
                deferDelete({
                  message: `Took back what went to ${f.to_label}.`,
                  ids: [f.id],
                  commit: () => api.delete(`/care-profiles/${profileId}/appointments/forwards/${f.id}`),
                  onCommitted: () => invalidateForwards(queryClient, profileId),
                })
              }
            >
              Take back
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** "From Dr Smith on 19 Nov", on a copy that arrived from another appointment. */
export function ForwardedFromTag({ profileId, from }: { profileId: string; from: ForwardedFrom }) {
  return (
    <p className="text-xs text-muted">
      From{' '}
      {from.appointment_id ? (
        <Link to={appointmentRecordLink(profileId, from.appointment_id)} className="text-primary hover:underline">{from.label}</Link>
      ) : (
        from.label
      )}{' '}
      on {format(new Date(from.on), 'd MMM yyyy')}
    </p>
  );
}

/** A field's text, greyed once it has been forwarded, with where it went. */
export function ForwardedText({
  profileId,
  text,
  forwards,
  canEdit,
}: {
  profileId: string;
  text: string;
  forwards: SentForward[];
  canEdit: boolean;
}) {
  const hidden = useHiddenIds();
  const live = forwards.filter((f) => !hidden.has(f.id));
  return (
    <>
      <span className={live.length ? 'text-muted' : undefined}>{text}</span>
      <ForwardTags profileId={profileId} forwards={live} canEdit={canEdit} />
    </>
  );
}

const stepLabel = (s: NextStep) => (s.title === s.type_name ? s.type_name : `${s.type_name}: ${s.title}`);
const appointmentLabel = (a: ForwardSource) =>
  `${a.provider_name ? `${a.title} with ${a.provider_name}` : a.title}, ${format(new Date(a.starts_at), 'd MMM yyyy')}`;

/**
 * Forward all or some of an appointment's notes: to an appointment already
 * booked, to a next step not booked yet (they land when it is), or to a new
 * appointment booked there and then.
 */
export function ForwardNotesModal({
  profileId,
  source,
  appointments,
  initialNoteId,
  onClose,
  onBookNew,
}: {
  profileId: string;
  source: ForwardSource;
  appointments: ForwardSource[];
  /** Opened from one note's Forward button: only that note starts ticked. */
  initialNoteId?: string | null;
  onClose: () => void;
  /** Book a new appointment, then send these to it. */
  onBookNew: (items: ReturnType<typeof pickedItems>) => void;
}) {
  const queryClient = useQueryClient();
  const candidates = useForwardCandidates(profileId, source);
  const [picks, setPicks] = useState<PickState | null>(null);
  const effectivePicks: PickState =
    picks ?? Object.fromEntries(candidates.map((c) => [c.key, { on: initialNoteId ? c.noteId === initialNoteId : true }]));

  // Next steps that are still to be booked, from any appointment, this one first.
  const waitingSteps = useMemo(() => {
    const own = (source.next_steps ?? []).filter((s) => s.books && !s.completed && !s.led_to);
    const others = appointments
      .filter((a) => a.id !== source.id)
      .flatMap((a) => (a.next_steps ?? []).filter((s) => s.books && !s.completed && !s.led_to));
    return [...own, ...others];
  }, [appointments, source]);
  const others = useMemo(
    () =>
      appointments
        .filter((a) => a.id !== source.id)
        .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()),
    [appointments, source.id]
  );
  const [target, setTarget] = useState(() => (waitingSteps[0] ? `step:${waitingSteps[0].id}` : ''));
  const [error, setError] = useState('');
  const items = pickedItems(candidates, effectivePicks);

  const send = useMutation({
    mutationFn: () => {
      const [kind, id] = target.split(':');
      return api.post(`/care-profiles/${profileId}/appointments/${source.id}/forward`, {
        items,
        ...(kind === 'step' ? { to_reminder_id: id } : { to_appointment_id: id }),
      });
    },
    onSuccess: () => {
      invalidateForwards(queryClient, profileId);
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The notes did not go. Check your connection and try again.'),
  });

  return (
    <Modal open onClose={onClose} title="Forward notes" wide>
      <div className="space-y-5">
        <p className="text-sm text-muted">From {appointmentLabel(source)}</p>

        <div>
          <p className="text-sm font-medium text-ink mb-2">What to send</p>
          <NotePicker candidates={candidates} picks={effectivePicks} onChange={setPicks} idPrefix="fwd" />
        </div>

        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1">Send to</span>
          <select
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Choose where they go</option>
            {waitingSteps.length > 0 ? (
              <optgroup label="Not booked yet, they land once it is">
                {waitingSteps.map((s) => (
                  <option key={s.id} value={`step:${s.id}`}>{stepLabel(s)}</option>
                ))}
              </optgroup>
            ) : null}
            {others.length > 0 ? (
              <optgroup label="Appointments">
                {others.map((a) => (
                  <option key={a.id} value={`appt:${a.id}`}>{appointmentLabel(a)}</option>
                ))}
              </optgroup>
            ) : null}
            <option value="new">A new appointment</option>
          </select>
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={send.isPending}
            disabled={items.length === 0 || !target}
            onClick={() => (target === 'new' ? onBookNew(items) : send.mutate())}
          >
            {target === 'new' ? 'Book it and send' : 'Send'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
