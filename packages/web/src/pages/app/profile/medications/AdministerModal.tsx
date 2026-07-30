import { medStatusDescription } from '../../../../lib/care';
import { format } from 'date-fns';
import { MED_STATUSES } from '../../../../lib/care';
import { SELECT, localNow } from './shared';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Input, Textarea } from '../../../../components/ui/Input';
import { Modal } from '../../../../components/ui/Modal';
import type { MedicationRecord } from '../../../../lib/care';

// Outcomes that don't require an explanatory note. Anything else (refused,
// omitted, held) makes the Notes field compulsory.
const NOTE_OPTIONAL_OUTCOMES = new Set(['given', 'self_administered']);

export function AdministerModal({ profileId, med, personName, scheduledFor, initialWhen, maxWhen, onClose, onSaved }: { profileId: string; med: MedicationRecord; personName: string; scheduledFor?: string; initialWhen?: string; maxWhen?: string; onClose: () => void; onSaved: () => void }) {
  const [when, setWhen] = useState(initialWhen ?? localNow());
  const [status, setStatus] = useState('given');
  const [doseGiven, setDoseGiven] = useState(med.dose ?? '');
  const [routeGiven, setRouteGiven] = useState(med.route ?? '');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const notesRequired = !NOTE_OPTIONAL_OUTCOMES.has(status);

  const mutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/medications/${med.id}/administrations`, {
      administered_at: new Date(when).toISOString(),
      scheduled_for: scheduledFor ?? null,
      status,
      dose_given: doseGiven || null,
      route_given: routeGiven || null,
      notes: notes.trim() || null,
      // Person, medication and documentation are guaranteed by context and set
      // server-side; time is the recorded moment; dose and route are recorded.
      right_dose: !!doseGiven.trim(),
      right_route: !!routeGiven.trim(),
      right_time: true,
    }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to record'),
  });

  const submit = () => {
    if (maxWhen && when > maxWhen) {
      setError('You cannot log a dose in the future.');
      return;
    }
    if (notesRequired && !notes.trim()) {
      setError(`A note is required when the outcome is "${MED_STATUSES.find((s) => s.value === status)?.label}".`);
      return;
    }
    setError('');
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title={`${personName} · ${format(new Date(when), 'd MMM yyyy')}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {/* The medication being logged, under the person + date heading. */}
        <div className="border-b border-border pb-3">
          <p className="text-base font-semibold text-ink">{med.name}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Dose" value={doseGiven} onChange={(e) => setDoseGiven(e.target.value)} placeholder="e.g. 500 mg" />
          <Input label="Given by (route)" value={routeGiven} onChange={(e) => setRouteGiven(e.target.value)} placeholder="e.g. Oral" />
        </div>

        <div>
          <label htmlFor="admin-when" className="block text-sm font-medium text-ink mb-1">Time</label>
          <input id="admin-when" type="datetime-local" className={`${SELECT} w-full`} value={when} max={maxWhen} onChange={(e) => setWhen(e.target.value)} required />
        </div>

        <div>
          <label htmlFor="admin-status" className="block text-sm font-medium text-ink mb-1">Outcome</label>
          <select id="admin-status" className={`${SELECT} w-full`} value={status} onChange={(e) => setStatus(e.target.value)}>
            {MED_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">{medStatusDescription(status)}</p>
        </div>

        <Textarea
          label={notesRequired ? 'Notes (required)' : 'Notes'}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder={notesRequired ? 'Explain why the dose was not given as prescribed' : 'Anything worth recording'}
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Log dose</Button>
        </div>
      </form>
    </Modal>
  );
}
