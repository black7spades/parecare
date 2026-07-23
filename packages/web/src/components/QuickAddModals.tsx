import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { CrossIcon } from './ui/icons';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { CatalogueCombo } from './CatalogueCombo';
import {
  CONDITION_CATEGORIES,
  type CarePlan,
  type EmergencyContact,
  type MedicalCondition,
  type Provider,
} from '../lib/care';

/**
 * Small dialogs that record a fact right where it is shown missing: the
 * emergency sheet, the overview, a health alert. Each one writes to the
 * same record its full page manages, so nothing new is invented and the
 * user is never sent away mid-task to type something in.
 */

function Footer({
  onClose,
  onSave,
  saving,
  disabled,
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  disabled: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button type="button" loading={saving} disabled={disabled} onClick={onSave}>
        Save
      </Button>
    </div>
  );
}

/** Add a GP to the profile's providers. */
export function GpModal({
  profileId,
  open,
  onClose,
  onSaved,
}: {
  profileId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ provider: Provider }>(`/care-profiles/${profileId}/providers`, {
        provider_type: 'gp',
        name: name.trim(),
        organisation: organisation.trim() || null,
        phone: phone.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['health-alerts'] });
      setName('');
      setOrganisation('');
      setPhone('');
      onSaved?.();
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the GP.'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add their GP">
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dr Priya Nair" />
        <Input
          label="Practice"
          value={organisation}
          onChange={(e) => setOrganisation(e.target.value)}
          placeholder="e.g. Northside Family Practice"
        />
        <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Footer onClose={onClose} onSave={() => mutation.mutate()} saving={mutation.isPending} disabled={!name.trim()} />
      </div>
    </Modal>
  );
}

/** Add one emergency contact to the care-needs record. */
export function EmergencyContactModal({
  profileId,
  open,
  onClose,
  onSaved,
}: {
  profileId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['care-plan', profileId],
    queryFn: () => api.get<{ plan: CarePlan | null }>(`/care-profiles/${profileId}/plan`),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => {
      // The care-needs record saves as a whole, so the new contact rides
      // along with everything already recorded.
      const plan = data?.plan;
      const contact: EmergencyContact = {
        name: name.trim(),
        ...(relationship.trim() ? { relationship: relationship.trim() } : {}),
        phone: phone.trim(),
      };
      const body: CarePlan = {
        dietary_requirements: plan?.dietary_requirements ?? [],
        mobility_aids: plan?.mobility_aids ?? [],
        communication_needs: plan?.communication_needs ?? [],
        advance_care_directive: plan?.advance_care_directive ?? false,
        advance_care_directive_location: plan?.advance_care_directive_location ?? null,
        emergency_contacts: [...(plan?.emergency_contacts ?? []), contact],
      };
      return api.put(`/care-profiles/${profileId}/plan`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['care-plan', profileId] });
      setName('');
      setRelationship('');
      setPhone('');
      onSaved?.();
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the contact.'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add emergency contact">
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          label="Relationship"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          placeholder="e.g. Daughter"
        />
        <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Footer
          onClose={onClose}
          onSave={() => mutation.mutate()}
          saving={mutation.isPending}
          disabled={!name.trim() || !phone.trim()}
        />
      </div>
    </Modal>
  );
}

/**
 * Record a condition with its essentials. The full detail (codes,
 * functional impact, symptoms) lives in the Conditions editor; this
 * captures the fact without sending the user away.
 */
export function ConditionModal({
  profileId,
  open,
  onClose,
  onSaved,
  defaultCategory = '',
  categories = CONDITION_CATEGORIES.filter((c) => c.value !== 'neurotype'),
  title = 'Add condition',
}: {
  profileId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  defaultCategory?: string;
  categories?: ReadonlyArray<{ value: string; label: string }>;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [category, setCategory] = useState(defaultCategory);
  const [startedOn, setStartedOn] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ condition: MedicalCondition }>(`/care-profiles/${profileId}/conditions`, {
        name: name.trim(),
        ...(category ? { category } : {}),
        ...(startedOn ? { started_on: startedOn } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['health-alerts'] });
      setName('');
      setCategory(defaultCategory);
      setStartedOn('');
      onSaved?.();
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the condition.'),
  });

  const selectClass =
    'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Condition</span>
          <CatalogueCombo
            endpoint="/condition-catalogue"
            ariaLabel="Condition"
            placeholder="e.g. Cold, Sprained ankle, Asthma"
            initial={name}
            keepValue
            onPick={setName}
            widthClass="w-full"
          />
        </div>
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1">Kind</span>
          <select aria-label="Kind of condition" className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Not sure</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <Input
          label="Started on"
          type="date"
          value={startedOn}
          onChange={(e) => setStartedOn(e.target.value)}
          hint="Leave blank if unsure."
        />
        <p className="text-xs text-muted">
          Symptoms, diagnosis codes and treatments can be added on the record afterwards.
        </p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Footer onClose={onClose} onSave={() => mutation.mutate()} saving={mutation.isPending} disabled={!name.trim()} />
      </div>
    </Modal>
  );
}

/**
 * Record a medication with its essentials: what, how strong, when.
 * Supply tracking and condition links live on the Medications page.
 */
export function MedicationModal({
  profileId,
  open,
  onClose,
  onSaved,
}: {
  profileId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [doseAmount, setDoseAmount] = useState('');
  const [doseUnit, setDoseUnit] = useState('');
  const [asNeeded, setAsNeeded] = useState(false);
  const [times, setTimes] = useState<string[]>(['08:00']);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/medications`, {
        name: name.trim(),
        dose_amount: doseAmount.trim() || null,
        dose_unit: doseUnit.trim() || null,
        as_needed: asNeeded,
        schedule_times: asNeeded ? [] : times.filter((t) => /^\d{2}:\d{2}$/.test(t)),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['medications', profileId] });
      setName('');
      setDoseAmount('');
      setDoseUnit('');
      setAsNeeded(false);
      setTimes(['08:00']);
      onSaved?.();
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the medication.'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add medication">
      <div className="space-y-4">
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Medication</span>
          <CatalogueCombo
            endpoint="/medication-catalogue"
            ariaLabel="Medication"
            placeholder="e.g. Paracetamol"
            initial={name}
            keepValue
            onPick={setName}
            widthClass="w-full"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Dose amount" value={doseAmount} onChange={(e) => setDoseAmount(e.target.value)} placeholder="e.g. 500" />
          <Input label="Dose unit" value={doseUnit} onChange={(e) => setDoseUnit(e.target.value)} placeholder="e.g. mg" />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            checked={asNeeded}
            onChange={(e) => setAsNeeded(e.target.checked)}
          />
          Taken as needed, not on a schedule
        </label>
        {!asNeeded ? (
          <div>
            <span className="block text-sm font-medium text-ink mb-1">Times each day</span>
            <div className="space-y-2">
              {times.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label={`Time ${i + 1}`}
                    type="time"
                    value={t}
                    onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))}
                    className="w-32"
                  />
                  {times.length > 1 ? (
                    <Button
                      size="xs"
                      variant="ghost-danger"
                      aria-label={`Remove time ${i + 1}`}
                      title="Remove"
                      onClick={() => setTimes(times.filter((_, j) => j !== i))}
                    >
                      <CrossIcon />
                    </Button>
                  ) : null}
                </div>
              ))}
              <Button size="xs" variant="ghost" onClick={() => setTimes([...times, '20:00'])}>
                Add time
              </Button>
            </div>
          </div>
        ) : null}
        <p className="text-xs text-muted">
          Supply tracking and the condition it treats can be added on the{' '}
          <Link to={`/app/${profileId}/medications`} className="text-primary hover:underline">
            medication record
          </Link>{' '}
          afterwards.
        </p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Footer onClose={onClose} onSave={() => mutation.mutate()} saving={mutation.isPending} disabled={!name.trim()} />
      </div>
    </Modal>
  );
}
