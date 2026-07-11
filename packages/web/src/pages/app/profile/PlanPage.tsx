import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { useProfile } from './ProfileLayout';
import { Modal } from '../../../components/ui/Modal';
import { CONDITION_STATUSES, conditionStatusLabel } from '../../../lib/care';
import type { Allergy, CarePlan, EmergencyContact, MedicalCondition, Medication } from '../../../lib/care';

const EMPTY_PLAN: CarePlan = {
  conditions: [],
  medications: [],
  dietary_requirements: [],
  mobility_aids: [],
  communication_preferences: null,
  advance_care_directive: false,
  advance_care_directive_location: null,
  gp_name: null,
  gp_practice: null,
  gp_phone: null,
  emergency_contacts: [],
};

export function PlanPage() {
  const { profile } = useProfile();
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<CarePlan>(EMPTY_PLAN);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['care-plan', profile.id],
    queryFn: () => api.get<{ plan: CarePlan | null }>(`/care-profiles/${profile.id}/plan`),
  });

  useEffect(() => {
    if (!data) return;
    const p = { ...EMPTY_PLAN, ...(data.plan ?? {}) };
    // Guard against rows written before jsonb serialisation was fixed
    const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
    setPlan({
      ...p,
      conditions: asArray<string>(p.conditions),
      medications: asArray<Medication>(p.medications),
      dietary_requirements: asArray<string>(p.dietary_requirements),
      mobility_aids: asArray<string>(p.mobility_aids),
      emergency_contacts: asArray<EmergencyContact>(p.emergency_contacts),
    });
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      // Conditions now live in their own table; never write the legacy
      // array so the two can't drift.
      const { conditions: _legacyConditions, ...rest } = plan;
      return api.put(`/care-profiles/${profile.id}/plan`, {
        ...rest,
        medications: plan.medications.filter((m) => m.name.trim()),
        emergency_contacts: plan.emergency_contacts.filter((c) => c.name.trim() && c.phone.trim()),
      });
    },
    onSuccess: () => {
      setError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void queryClient.invalidateQueries({ queryKey: ['care-plan', profile.id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save care plan'),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;

  const set = <K extends keyof CarePlan>(key: K, value: CarePlan[K]) => setPlan((p) => ({ ...p, [key]: value }));

  return (
    <form
      className="space-y-6 max-w-3xl"
      onSubmit={(e) => {
        e.preventDefault();
        saveMutation.mutate();
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Care plan</h2>
          <p className="text-sm text-muted">Medical and day-to-day information everyone in the circle can rely on.</p>
        </div>
        <div className="flex items-center gap-3">
          {saved ? <span className="text-sm text-primary">Saved ✓</span> : null}
          <Link to="../emergency">
            <Button type="button" variant="secondary">
              Emergency sheet
            </Button>
          </Link>
          <Button type="submit" loading={saveMutation.isPending}>
            Save care plan
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <AllergiesSection profileId={profile.id} />
      <ConditionsSection profileId={profile.id} />

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-ink">Health</h3>
        <MedicationsEditor medications={plan.medications} onChange={(v) => set('medications', v)} />
        <TagListEditor
          label="Dietary requirements"
          placeholder="e.g. Low salt"
          values={plan.dietary_requirements}
          onChange={(v) => set('dietary_requirements', v)}
        />
        <TagListEditor
          label="Mobility aids"
          placeholder="e.g. Walking frame"
          values={plan.mobility_aids}
          onChange={(v) => set('mobility_aids', v)}
        />
        <Textarea
          label="Communication preferences"
          placeholder="e.g. Hard of hearing on the left. Speak clearly, face to face"
          value={plan.communication_preferences ?? ''}
          onChange={(e) => set('communication_preferences', e.target.value || null)}
          rows={2}
        />
      </div>

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-ink">GP</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="GP name" value={plan.gp_name ?? ''} onChange={(e) => set('gp_name', e.target.value || null)} />
          <Input
            label="Practice"
            value={plan.gp_practice ?? ''}
            onChange={(e) => set('gp_practice', e.target.value || null)}
          />
          <Input label="Phone" value={plan.gp_phone ?? ''} onChange={(e) => set('gp_phone', e.target.value || null)} />
        </div>
      </div>

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-ink">Advance care directive</h3>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            checked={plan.advance_care_directive}
            onChange={(e) => set('advance_care_directive', e.target.checked)}
          />
          An advance care directive is in place
        </label>
        {plan.advance_care_directive ? (
          <Input
            label="Where is it kept?"
            placeholder="e.g. With the GP and a copy in Documents"
            value={plan.advance_care_directive_location ?? ''}
            onChange={(e) => set('advance_care_directive_location', e.target.value || null)}
          />
        ) : null}
      </div>

      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-ink">Emergency contacts</h3>
        <ContactsEditor contacts={plan.emergency_contacts} onChange={(v) => set('emergency_contacts', v)} />
      </div>
    </form>
  );
}

/**
 * What this person must not be given. The substance and the reaction it
 * causes are two facts, so they are two fields. Saves immediately.
 */
function AllergiesSection({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const [substance, setSubstance] = useState('');
  const [reaction, setReaction] = useState('');

  const { data } = useQuery({
    queryKey: ['allergies', profileId],
    queryFn: () => api.get<{ allergies: Allergy[] }>(`/care-profiles/${profileId}/allergies`),
  });
  const allergies = data?.allergies ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['allergies', profileId] });

  const addMutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/allergies`, {
        substance: substance.trim(),
        reaction: reaction.trim() || null,
      }),
    onSuccess: () => {
      setSubstance('');
      setReaction('');
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/allergies/${id}`),
    onSuccess: invalidate,
  });

  const add = () => {
    if (substance.trim()) addMutation.mutate();
  };

  return (
    <div className="card space-y-3 border-l-4 border-l-red-500">
      <div>
        <h3 className="text-sm font-semibold text-ink">Allergies</h3>
        <p className="text-sm text-muted">What they must not be given, and what happens if they are. Saves straight away.</p>
      </div>
      {allergies.length > 0 ? (
        <ul className="space-y-1.5">
          {allergies.map((a) => (
            <li key={a.id} className="flex items-start gap-2 group">
              <span className="badge bg-red-50 text-red-700 text-xs shrink-0">{a.substance}</span>
              <span className="text-sm text-ink flex-1">{a.reaction ?? ''}</span>
              <button
                type="button"
                aria-label={`Remove ${a.substance}`}
                className="text-muted hover:text-red-600 text-sm px-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                onClick={() => deleteMutation.mutate(a.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No allergies recorded.</p>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <Input
          aria-label="Allergic to"
          placeholder="Allergic to, e.g. Penicillin"
          value={substance}
          onChange={(e) => setSubstance(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Input
          aria-label="Reaction"
          placeholder="Reaction, e.g. red rash"
          value={reaction}
          onChange={(e) => setReaction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={add} disabled={!substance.trim()} loading={addMutation.isPending}>
          Add
        </Button>
      </div>
    </div>
  );
}

/**
 * What this person lives with. Each condition shows the medications tied
 * to it on the Medications page. Saves immediately.
 */
function ConditionsSection({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<MedicalCondition | null>(null);

  const { data } = useQuery({
    queryKey: ['conditions', profileId],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profileId}/conditions`),
  });
  const conditions = data?.conditions ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });

  const addMutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/conditions`, { name: name.trim() }),
    onSuccess: () => {
      setName('');
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/conditions/${id}`),
    onSuccess: invalidate,
  });

  const add = () => {
    if (name.trim()) addMutation.mutate();
  };

  // Everything managing this condition, medications and other treatments alike:
  // one list of the same kind of value.
  const managedBy = (c: MedicalCondition): string => {
    const names = [...c.medications.map((m) => m.name), ...(c.treatments ?? []).map((t) => t.name)];
    return names.length > 0 ? `Managed with ${names.join(', ')}` : '';
  };

  return (
    <div className="card space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-ink">Medical conditions</h3>
        <p className="text-sm text-muted">
          Conditions being lived with or passing through. Some conditions are temporary, so each carries its own
          status. Tie medications and treatments to a condition on the Treatments page and the link shows here.
          Saves straight away.
        </p>
      </div>
      {conditions.length > 0 ? (
        <ul className="space-y-1.5">
          {conditions.map((c) => (
            <li key={c.id} className="flex items-start gap-2 group">
              <span className="badge bg-surface-2 text-ink text-xs shrink-0">{c.name}</span>
              {c.status && c.status !== 'active' ? (
                <span className="badge bg-surface-2 text-muted text-xs shrink-0">{conditionStatusLabel(c.status)}</span>
              ) : null}
              {c.is_temporary ? (
                <span className="badge bg-surface-2 text-muted text-xs shrink-0" title="Expected to pass rather than long-term">Temporary</span>
              ) : null}
              <span className="text-sm text-muted flex-1">{managedBy(c)}</span>
              <button
                type="button"
                className="text-primary text-sm px-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:underline"
                onClick={() => setEditing(c)}
              >
                Edit
              </button>
              <button
                type="button"
                aria-label={`Remove ${c.name}`}
                className="text-muted hover:text-red-600 text-sm px-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                onClick={() => deleteMutation.mutate(c.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No conditions recorded.</p>
      )}
      {editing ? (
        <ConditionEditModal
          profileId={profileId}
          condition={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      ) : null}
      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            aria-label="Condition"
            placeholder="e.g. High blood pressure"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={add} disabled={!name.trim()} loading={addMutation.isPending}>
          Add
        </Button>
      </div>
    </div>
  );
}

/**
 * A condition's lifecycle: whether it is expected to pass, how it stands
 * now, and when it started and cleared. One fact per field.
 */
function ConditionEditModal({ profileId, condition, onClose, onSaved }: {
  profileId: string;
  condition: MedicalCondition;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(condition.name);
  const [isTemporary, setIsTemporary] = useState(condition.is_temporary ?? false);
  const [status, setStatus] = useState(condition.status ?? 'active');
  const [startedOn, setStartedOn] = useState(condition.started_on ?? '');
  const [resolvedOn, setResolvedOn] = useState(condition.resolved_on ?? '');
  const [notes, setNotes] = useState(condition.notes ?? '');
  const [error, setError] = useState('');

  const selectClass = 'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

  const mutation = useMutation({
    mutationFn: () => api.patch(`/care-profiles/${profileId}/conditions/${condition.id}`, {
      name: name.trim(),
      is_temporary: isTemporary,
      status,
      started_on: startedOn || null,
      resolved_on: status === 'resolved' ? resolvedOn || null : null,
      notes: notes.trim() || null,
    }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  // Not a <form>: this modal renders inside the care plan's form, and a
  // nested form is invalid HTML. The save button drives the mutation.
  return (
    <Modal open onClose={onClose} title="Edit condition">
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <label className="inline-flex items-center gap-1.5 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            checked={isTemporary}
            onChange={(e) => setIsTemporary(e.target.checked)}
          />
          Temporary: expected to pass rather than long-term
        </label>
        <div>
          <label htmlFor="condition-status" className="block text-sm font-medium text-ink mb-1">Status</label>
          <select id="condition-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            {CONDITION_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">{CONDITION_STATUSES.find((s) => s.value === status)?.description}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Started on" type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          {status === 'resolved' ? (
            <Input label="Resolved on" type="date" value={resolvedOn} onChange={(e) => setResolvedOn(e.target.value)} />
          ) : null}
        </div>
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything worth knowing about this condition" />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" loading={mutation.isPending} disabled={!name.trim()} onClick={() => mutation.mutate()}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function TagListEditor({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div>
      <span className="block text-sm font-medium text-ink mb-1">{label}</span>
      <div className="flex flex-wrap gap-2 mb-2">
        {values.map((v) => (
          <span key={v} className="badge bg-surface-2 text-ink text-xs flex items-center gap-1">
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              className="text-muted hover:text-red-600"
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            aria-label={label}
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

function MedicationsEditor({
  medications,
  onChange,
}: {
  medications: Medication[];
  onChange: (v: Medication[]) => void;
}) {
  const update = (i: number, patch: Partial<Medication>) =>
    onChange(medications.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  return (
    <div>
      <span className="block text-sm font-medium text-ink mb-1">Medications</span>
      <div className="space-y-2">
        {medications.map((m, i) => (
          <div
            key={i}
            className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 sm:items-center rounded-md border border-border p-2 sm:border-0 sm:p-0"
          >
            <Input aria-label="Medication name" placeholder="Name" value={m.name} onChange={(e) => update(i, { name: e.target.value })} />
            <Input aria-label="Dose" placeholder="Dose" value={m.dose ?? ''} onChange={(e) => update(i, { dose: e.target.value })} />
            <Input aria-label="Frequency" placeholder="Frequency" value={m.frequency ?? ''} onChange={(e) => update(i, { frequency: e.target.value })} />
            <Input aria-label="Prescriber" placeholder="Prescriber" value={m.prescriber ?? ''} onChange={(e) => update(i, { prescriber: e.target.value })} />
            <button
              type="button"
              aria-label="Remove medication"
              className="col-span-2 sm:col-span-1 justify-self-end text-muted hover:text-red-600 text-sm px-2 py-1"
              onClick={() => onChange(medications.filter((_, idx) => idx !== i))}
            >
              <span className="sm:hidden">Remove</span>
              <span className="hidden sm:inline">✕</span>
            </button>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => onChange([...medications, { name: '' }])}>
        Add medication
      </Button>
    </div>
  );
}

function ContactsEditor({
  contacts,
  onChange,
}: {
  contacts: EmergencyContact[];
  onChange: (v: EmergencyContact[]) => void;
}) {
  const update = (i: number, patch: Partial<EmergencyContact>) =>
    onChange(contacts.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  return (
    <div>
      <div className="space-y-2">
        {contacts.map((c, i) => (
          <div
            key={i}
            className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 sm:items-center rounded-md border border-border p-2 sm:border-0 sm:p-0"
          >
            <Input aria-label="Contact name" placeholder="Name" value={c.name} onChange={(e) => update(i, { name: e.target.value })} />
            <Input aria-label="Relationship" placeholder="Relationship" value={c.relationship ?? ''} onChange={(e) => update(i, { relationship: e.target.value })} />
            <Input aria-label="Contact phone" placeholder="Phone" value={c.phone} onChange={(e) => update(i, { phone: e.target.value })} />
            <button
              type="button"
              aria-label="Remove contact"
              className="col-span-2 sm:col-span-1 justify-self-end text-muted hover:text-red-600 text-sm px-2 py-1"
              onClick={() => onChange(contacts.filter((_, idx) => idx !== i))}
            >
              <span className="sm:hidden">Remove</span>
              <span className="hidden sm:inline">✕</span>
            </button>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => onChange([...contacts, { name: '', phone: '' }])}>
        Add contact
      </Button>
    </div>
  );
}
