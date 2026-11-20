import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Input, Textarea } from '../../../../components/ui/Input';
import { Modal } from '../../../../components/ui/Modal';
import { ContactPicker, emptyContact, type PickedContact } from '../../../../components/ContactPicker';
import { DOSE_MEASURES, type MedicationRecord } from '../../../../lib/care';
import { TimeField } from './TimeField';

/**
 * A carer records a change the doctor or pharmacist asked for: a new dose,
 * new times, or both, with why and who said so. It goes in the medicine's
 * history like any other change. Adding or deleting medicines stays with
 * the person who manages the profile.
 */
export function RecordChangeModal({ profileId, med, onClose, onSaved }: { profileId: string; med: MedicationRecord; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(med.dose_amount ?? '');
  const [measure, setMeasure] = useState(med.dose_unit ?? '');
  const startTimes = med.as_needed ? [] : med.schedule_times ?? [];
  const [times, setTimes] = useState<string[]>(startTimes);
  const [why, setWhy] = useState('');
  const [saidBy, setSaidBy] = useState<PickedContact>(emptyContact);
  const [error, setError] = useState('');

  const doseMoved = amount.trim() !== (med.dose_amount ?? '') || measure.trim() !== (med.dose_unit ?? '');
  const timesMoved = [...times].sort().join(',') !== [...startTimes].sort().join(',');

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/care-profiles/${profileId}/medications/${med.id}`, {
        ...(doseMoved ? { dose_amount: amount.trim() || null, dose_unit: measure.trim() || null } : {}),
        ...(timesMoved && !med.as_needed ? { schedule_times: times } : {}),
        change_reason: why.trim(),
        // Who said so: a contact picked, or a new name filed in Contacts.
        ...(saidBy.providerId
          ? { change_source_provider_id: saidBy.providerId }
          : saidBy.name.trim()
            ? { change_source_provider_name: saidBy.name.trim(), change_source_provider_type: saidBy.providerType.trim() || null, change_source_provider_phone: saidBy.phone.trim() || null }
            : {}),
      }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'The change was not saved. Try again.'),
  });

  const submit = () => {
    if (!doseMoved && !timesMoved) {
      setError('Change the dose amount, the measure or a time, then save the change.');
      document.getElementById('change-amount')?.focus();
      return;
    }
    if (!why.trim()) {
      setError('Say why it changed, e.g. Dr Zhang lowered it at the GP round.');
      document.getElementById('change-why')?.focus();
      return;
    }
    setError('');
    save.mutate();
  };

  return (
    <Modal open onClose={onClose} title={`Record a change to ${med.name}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="change-amount" label="New dose amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 25" />
          <Input id="change-measure" label="Dose measure" value={measure} onChange={(e) => setMeasure(e.target.value)} placeholder="e.g. mg" list="change-measures" />
          <datalist id="change-measures">
            {DOSE_MEASURES.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
        {!med.as_needed ? (
          <div>
            <p className="block text-sm font-medium text-ink mb-1">New times</p>
            <div className="flex flex-wrap items-center gap-2">
              {times.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <TimeField value={t} onChange={(v) => setTimes((prev) => prev.map((x, j) => (j === i ? v : x)))} />
                  <Button type="button" size="xs" variant="ghost" aria-label={`Remove ${t}`} title="Remove" onClick={() => setTimes((prev) => prev.filter((_, j) => j !== i))}>Remove</Button>
                </span>
              ))}
              <Button type="button" size="xs" variant="secondary" onClick={() => setTimes((prev) => [...prev, '08:00'])}>Add a time</Button>
            </div>
          </div>
        ) : null}
        <Textarea id="change-why" label="Why did it change?" value={why} onChange={(e) => setWhy(e.target.value)} rows={2} placeholder="e.g. Dr Zhang lowered it at the GP round" />
        <ContactPicker id="change-said-by" label="Who said so?" profileId={profileId} value={saidBy} onChange={setSaidBy} defaultType="gp" hint="The doctor or pharmacist who asked for it, if there was one." />
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save the change</Button>
        </div>
      </form>
    </Modal>
  );
}
