import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import {
  CONDITION_LOG_TYPES,
  conditionLogTypeLabel,
  type ConditionLogEntry,
  type MedicalCondition,
} from '../../../lib/care';

/**
 * The tracking thread for one condition under Current health. A sprained
 * ankle in March
 * that still hurts in July is not a single fact: it is a run of notes, a
 * couple of appointments, a scan and a course of physiotherapy. This keeps
 * that run together under the condition, while every appointment and therapy
 * stays exactly where it already lives, in Appointments and Treatments.
 */

const selectClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/** Add a note to the condition's own log. */
function LogForm({
  profileId,
  conditionId,
  onSaved,
}: {
  profileId: string;
  conditionId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [entryType, setEntryType] = useState('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  const save = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/conditions/${conditionId}/log`, {
        entry_type: entryType,
        title: title.trim() || null,
        body: body.trim(),
        occurred_at: new Date(occurredAt).toISOString(),
      }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setEntryType('note');
      setOpen(false);
      onSaved();
    },
  });

  if (!open) {
    return (
      <Button size="xs" variant="secondary" className="mt-2" onClick={() => setOpen(true)}>
        Add to the log
      </Button>
    );
  }

  return (
    <form
      className="mt-2 space-y-2 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) save.mutate();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="block text-xs font-medium text-ink mb-1">Kind</span>
          <select className={selectClass} value={entryType} onChange={(e) => setEntryType(e.target.value)}>
            {CONDITION_LOG_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-ink mb-1">When</span>
          <input
            type="datetime-local"
            className={selectClass}
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </label>
      </div>
      <Input label="Heading" value={title} onChange={(e) => setTitle(e.target.value)} hint="Optional, e.g. Ultrasound result" />
      <label className="block">
        <span className="block text-xs font-medium text-ink mb-1">What happened</span>
        <textarea
          className={selectClass}
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Still sore when he puts weight through it, worse going down stairs."
          required
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="submit" size="xs" loading={save.isPending} disabled={!body.trim()}>Save</Button>
      </div>
    </form>
  );
}

/** One entry in the condition's log, editable in place. */
function LogRow({
  profileId,
  conditionId,
  entry,
  canEdit,
  onChanged,
}: {
  profileId: string;
  conditionId: string;
  entry: ConditionLogEntry;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(entry.body);

  const update = useMutation({
    mutationFn: () => api.patch(`/care-profiles/${profileId}/conditions/${conditionId}/log/${entry.id}`, { body: body.trim() }),
    onSuccess: () => { setEditing(false); onChanged(); },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/care-profiles/${profileId}/conditions/${conditionId}/log/${entry.id}`),
    onSuccess: onChanged,
  });

  return (
    <li className="border-l-2 border-border pl-3 py-1.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-surface-2 text-muted text-[10px]">{conditionLogTypeLabel(entry.entry_type)}</span>
            <span className="text-xs text-muted">{format(new Date(entry.occurred_at), 'd MMM yyyy, HH:mm')}</span>
            {entry.author_name ? <span className="text-xs text-muted">by {entry.author_name}</span> : null}
          </div>
          {entry.title ? <p className="text-sm font-medium text-ink mt-0.5">{entry.title}</p> : null}
          {editing ? (
            <div className="mt-1 space-y-2">
              <textarea className={selectClass} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="xs" variant="ghost" onClick={() => { setEditing(false); setBody(entry.body); }}>Cancel</Button>
                <Button size="xs" loading={update.isPending} onClick={() => update.mutate()}>Save</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink whitespace-pre-wrap mt-0.5">{entry.body}</p>
          )}
        </div>
        {canEdit && !editing ? (
          <div className="flex items-center gap-1 shrink-0">
            <Button size="xs" variant="ghost" aria-label="Edit this log entry" title="Edit" onClick={() => setEditing(true)}><PencilIcon /></Button>
            <Button size="xs" variant="ghost-danger" aria-label="Delete this log entry" title="Delete" onClick={() => remove.mutate()}><TrashIcon /></Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Everything that came out of this condition, in one place: its own log, the
 * appointments booked for it, and the therapies being done for it.
 */
export function ConditionTracking({
  profileId,
  condition,
  canEdit,
  onChanged,
}: {
  profileId: string;
  condition: MedicalCondition;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const log = condition.log_entries ?? [];
  const appointments = condition.appointments ?? [];
  const treatments = condition.treatments ?? [];
  const documents = condition.documents ?? [];

  return (
    <>
      <div className="border-t border-border pt-3">
        <h4 className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">
          Tracking log
          <span className="font-normal text-muted ml-1 normal-case">
            How this one thing is going, kept apart from the general care log
          </span>
        </h4>
        {log.length === 0 ? (
          <p className="text-xs text-muted">Nothing logged for this yet.</p>
        ) : (
          <ul className="space-y-1">
            {log.map((e) => (
              <LogRow key={e.id} profileId={profileId} conditionId={condition.id} entry={e} canEdit={canEdit} onChanged={onChanged} />
            ))}
          </ul>
        )}
        {canEdit ? <LogForm profileId={profileId} conditionId={condition.id} onSaved={onChanged} /> : null}
      </div>

      <div className="border-t border-border pt-3">
        <h4 className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">
          Appointments for this
          <span className="font-normal text-muted ml-1 normal-case">
            Booked under this condition, and marked with it on the calendar
          </span>
        </h4>
        {appointments.length === 0 ? (
          <p className="text-xs text-muted">
            None booked for this yet.{' '}
            <Link to="../appointments" className="text-primary hover:underline">Make an appointment</Link>{' '}
            and choose this condition to tie it here.
          </p>
        ) : (
          <ul className="space-y-1">
            {appointments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink">{a.title}</span>
                {a.provider_name ? <span className="text-xs text-muted">with {a.provider_name}</span> : null}
                <span className="text-xs text-muted">{format(new Date(a.starts_at), 'd MMM yyyy, HH:mm')}</span>
                <span className="badge bg-surface-2 text-muted text-[10px] capitalize">{a.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <h4 className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">
          Documents for this
          <span className="font-normal text-muted ml-1 normal-case">
            Scan reports, medical certificates, referrals, also in Documents
          </span>
        </h4>
        {documents.length === 0 ? (
          <p className="text-xs text-muted">
            None filed for this yet.{' '}
            <Link to="../documents" className="text-primary hover:underline">Upload a document</Link>{' '}
            and choose this condition to file it here.
          </p>
        ) : (
          <ul className="space-y-1">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink">{d.label}</span>
                <span className="text-xs text-muted">{format(new Date(d.created_at), 'd MMM yyyy')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <h4 className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">
          Therapies for this
          <span className="font-normal text-muted ml-1 normal-case">
            Also listed under Treatments
          </span>
        </h4>
        {treatments.length === 0 ? (
          <p className="text-xs text-muted">
            None recorded for this yet.{' '}
            <Link to="../treatments" className="text-primary hover:underline">Add a treatment</Link>{' '}
            and choose this condition to tie it here.
          </p>
        ) : (
          <ul className="space-y-1">
            {treatments.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink">{t.name}</span>
                <span className="badge bg-surface-2 text-muted text-[10px]">{t.active ? 'Active' : 'Stopped'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
