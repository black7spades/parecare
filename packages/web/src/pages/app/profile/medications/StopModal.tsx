import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { format } from '../../../../lib/dateFormat';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Input, Textarea } from '../../../../components/ui/Input';
import { Modal } from '../../../../components/ui/Modal';
import { STOP_REASONS, type MedicationRecord, type StopReason } from '../../../../lib/care';
import { SELECT } from './shared';

/**
 * Stop a medicine: the last day it was taken, why it stopped and anything
 * else in their words. It comes off the active list and the stop is kept in
 * its history. Undo is offered straight after, never a "sure?" box.
 */
export function StopModal({
  profileId,
  med,
  initialReason = '',
  initialDay,
  onClose,
  onStopped,
}: {
  profileId: string;
  med: MedicationRecord;
  initialReason?: StopReason | '';
  /** The last day taken, e.g. the last day of the course. */
  initialDay?: string | null;
  onClose: () => void;
  onStopped: (changeId: string | null) => void;
}) {
  const [day, setDay] = useState(initialDay || format(new Date(), 'yyyy-MM-dd'));
  const [reason, setReason] = useState<StopReason | ''>(initialReason);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ change_id: string | null }>(`/care-profiles/${profileId}/medications/${med.id}/stop`, {
        stopped_on: day || null,
        stop_reason: reason || null,
        stop_notes: notes.trim() || null,
      }),
    onSuccess: (r) => onStopped(r.change_id),
    onError: (err) => setError(err instanceof Error ? err.message : `${med.name} was not stopped. Check your connection and try again.`),
  });
  return (
    <Modal open onClose={onClose} title={`Stop ${med.name}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Stop it always answers: the last day is the one thing it needs.
          if (!day) {
            setError('Pick the last day it was taken, then stop it.');
            document.getElementById('stop-med-day')?.focus();
            return;
          }
          setError('');
          mutation.mutate();
        }}
      >
        <Input id="stop-med-day" type="date" label="Last day taken" value={day} onChange={(e) => setDay(e.target.value)} />
        <div>
          <label htmlFor="stop-med-reason" className="block text-sm font-medium text-ink mb-1">Why it stopped</label>
          <select id="stop-med-reason" className={`${SELECT} w-full`} value={reason} onChange={(e) => setReason(e.target.value as StopReason | '')}>
            <option value="">Choose one</option>
            {STOP_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <Textarea id="stop-med-notes" label="In their words" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Dr Okafor stopped it at the review" />
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending}>Stop it</Button>
        </div>
      </form>
    </Modal>
  );
}
