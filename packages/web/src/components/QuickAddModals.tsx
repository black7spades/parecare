import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { CrossIcon } from './ui/icons';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { CatalogueCombo } from './CatalogueCombo';
import { CONDITION_CATEGORIES, type MedicalCondition, type Provider } from '../lib/care';
import { EmergencyContactAdd } from './EmergencyContactsEditor';

/**
 * Small dialogs that record a fact right where it is shown missing: the
 * emergency sheet, the overview, a health alert. Each one writes to the
 * same record its full page manages, so nothing new is invented and the
 * user is never sent away mid-task to type something in.
 */

/**
 * Cancel and Save. Save always answers: with a box still empty it says which
 * one in a sentence beside the button, rather than greying out.
 */
function Footer({
  onClose,
  onSave,
  saving,
  missing,
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  /** What is still needed, as a sentence, or null when ready. */
  missing: string | null;
}) {
  const [said, setSaid] = useState('');
  return (
    <div className="space-y-2">
      {said ? <p className="text-sm text-red-600 text-right" role="alert">{said}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          loading={saving}
          onClick={() => {
            if (missing) {
              setSaid(missing);
              return;
            }
            setSaid('');
            onSave();
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/** Add a GP to the profile's providers. */
export function GpModal(props: { profileId: string; open: boolean; onClose: () => void; onSaved?: () => void }) {
  return <MainContactModal {...props} providerType="gp" title="Add their GP" namePlaceholder="e.g. Dr Priya Nair" placePlaceholder="e.g. Northside Family Practice" />;
}

/** Add their pharmacy, where repeats are ordered from. */
export function PharmacyModal(props: { profileId: string; open: boolean; onClose: () => void; onSaved?: () => void }) {
  return <MainContactModal {...props} providerType="pharmacy" title="Add a pharmacy" namePlaceholder="e.g. Terry White Chemmart Box Hill" />;
}

/** Add a main contact of one kind (a GP, a pharmacy) to the profile's contacts. */
function MainContactModal({
  profileId,
  open,
  onClose,
  onSaved,
  providerType,
  title,
  namePlaceholder,
  placePlaceholder,
}: {
  profileId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  providerType: 'gp' | 'pharmacy';
  title: string;
  namePlaceholder: string;
  placePlaceholder?: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ provider: Provider }>(`/care-profiles/${profileId}/providers`, {
        provider_type: providerType,
        name: name.trim(),
        ...(providerType === 'gp' ? { organisation: organisation.trim() || null } : { kind: 'organisation' }),
        phone: phone.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['medications', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['health-alerts'] });
      setName('');
      setOrganisation('');
      setPhone('');
      onSaved?.();
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'That was not saved. Try again.'),
  });

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={namePlaceholder} />
        {providerType === 'gp' ? (
          <Input label="Practice" value={organisation} onChange={(e) => setOrganisation(e.target.value)} placeholder={placePlaceholder} />
        ) : null}
        <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Footer onClose={onClose} onSave={() => mutation.mutate()} saving={mutation.isPending} missing={name.trim() ? null : 'Write their name, then save.'} />
      </div>
    </Modal>
  );
}

/**
 * Choose someone to call in an emergency, right where it is shown missing:
 * You, someone in the care circle, a contact, or someone not in PareCare.
 */
export function EmergencyContactModal({
  profileId,
  open,
  onClose,
  onSaved,
  ownerRelationship,
}: {
  profileId: string;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  ownerRelationship?: string | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Choose who to call">
      <EmergencyContactAdd
        profileId={profileId}
        ownerRelationship={ownerRelationship}
        onCancel={onClose}
        onAdded={() => {
          onSaved?.();
          onClose();
        }}
      />
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
        <Footer onClose={onClose} onSave={() => mutation.mutate()} saving={mutation.isPending} missing={name.trim() ? null : 'Write the name, then save.'} />
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
        <Footer onClose={onClose} onSave={() => mutation.mutate()} saving={mutation.isPending} missing={name.trim() ? null : 'Write the name, then save.'} />
      </div>
    </Modal>
  );
}
