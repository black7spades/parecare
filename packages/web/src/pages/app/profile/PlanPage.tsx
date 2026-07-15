import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { CatalogueCombo, OptionChips } from '../../../components/CatalogueCombo';
import { useProfile } from './ProfileLayout';
import {
  CONDITION_STATUSES,
  RELATIONSHIPS,
  conditionStatusLabel,
  providerTypeLabel,
  type Allergy,
  type CareDocument,
  type CarePlan,
  type CircleMember,
  type EmergencyContact,
  type MedicalCondition,
  type MedicationRecord,
  type Provider,
  type Treatment,
} from '../../../lib/care';

/**
 * The care plan is a data-surfacing page: every fact on it lives in its
 * own source table (allergies, conditions, medications, treatments,
 * providers, documents) or in the plan's own lists, and is shown in
 * sortable, filterable, collapsible tables. The only entry that happens
 * here is through those tables, and every value picked comes from a
 * shared catalogue dropdown, never a free-text box. Entry that belongs
 * elsewhere (medications, treatments, the GP, directive documents) is
 * done on its own page and only surfaced here.
 */

const EMPTY_PLAN: CarePlan = {
  dietary_requirements: [],
  mobility_aids: [],
  communication_needs: [],
  advance_care_directive: false,
  advance_care_directive_location: null,
  emergency_contacts: [],
};

const SECTIONS = ['allergies', 'conditions', 'treatments', 'needs', 'gp', 'directive', 'contacts'] as const;
type SectionId = (typeof SECTIONS)[number];

const selectClass =
  'rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function PlanPage() {
  const { profile, canEdit } = useProfile();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Record<SectionId, boolean>>(
    Object.fromEntries(SECTIONS.map((s) => [s, true])) as Record<SectionId, boolean>
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['care-plan', profile.id],
    queryFn: () => api.get<{ plan: CarePlan | null }>(`/care-profiles/${profile.id}/plan`),
  });

  const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const plan: CarePlan = useMemo(() => {
    const p = { ...EMPTY_PLAN, ...(data?.plan ?? {}) };
    return {
      ...p,
      dietary_requirements: asArray<string>(p.dietary_requirements),
      mobility_aids: asArray<string>(p.mobility_aids),
      communication_needs: asArray<string>(p.communication_needs),
      emergency_contacts: asArray<EmergencyContact>(p.emergency_contacts),
    };
  }, [data]);

  // Every change saves straight away; there is no page-wide form to submit.
  const saveMutation = useMutation({
    mutationFn: (next: CarePlan) => api.put(`/care-profiles/${profile.id}/plan`, next),
    onSuccess: () => {
      setError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void queryClient.invalidateQueries({ queryKey: ['care-plan', profile.id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });
  const savePlan = (patch: Partial<CarePlan>) => saveMutation.mutate({ ...plan, ...patch });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;

  const setAll = (value: boolean) =>
    setOpen(Object.fromEntries(SECTIONS.map((s) => [s, value])) as Record<SectionId, boolean>);
  const toggle = (id: SectionId) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Care plan</h2>
          <p className="text-sm text-muted">Medical and day-to-day information everyone in the circle can rely on. Changes save straight away.</p>
        </div>
        <div className="flex items-center gap-3">
          {saved ? <span className="text-sm text-primary">Saved ✓</span> : null}
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            Expand all
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAll(false)}>
            Collapse all
          </Button>
          <Link to="../emergency">
            <Button type="button" variant="secondary" size="sm">
              Emergency sheet
            </Button>
          </Link>
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Section id="allergies" title="Allergies" subtitle="What they must not be given, and what happens if they are." open={open.allergies} onToggle={toggle} accent>
        <AllergiesTable profileId={profile.id} canEdit={canEdit} />
      </Section>

      <Section
        id="conditions"
        title="Conditions"
        subtitle={
          <>
            What they live with. The treatments managing each condition are tied on the{' '}
            <Link to="../medications" className="text-primary hover:underline">
              Treatments page
            </Link>
            .
          </>
        }
        open={open.conditions}
        onToggle={toggle}
      >
        <ConditionsTable profileId={profile.id} canEdit={canEdit} />
      </Section>

      <Section
        id="treatments"
        title="Medications and treatments"
        subtitle={
          <>
            Surfaced from the{' '}
            <Link to="../medications" className="text-primary hover:underline">
              Treatments page
            </Link>
            , where they are managed.
          </>
        }
        open={open.treatments}
        onToggle={toggle}
      >
        <MedicationsTables profileId={profile.id} />
      </Section>

      <Section id="needs" title="Day-to-day needs" subtitle="Each need is picked from a shared list; anything not listed joins it when you add it." open={open.needs} onToggle={toggle}>
        <div className="space-y-4">
          <OptionChips
            label="Dietary requirements"
            category="dietary_requirement"
            values={plan.dietary_requirements}
            onChange={(v) => savePlan({ dietary_requirements: v })}
            canEdit={canEdit}
            addLabel="Add, e.g. Low salt"
          />
          <OptionChips
            label="Mobility aids"
            category="mobility_aid"
            values={plan.mobility_aids}
            onChange={(v) => savePlan({ mobility_aids: v })}
            canEdit={canEdit}
            addLabel="Add, e.g. Walking frame"
          />
          <OptionChips
            label="Communication needs"
            category="communication_need"
            values={plan.communication_needs}
            onChange={(v) => savePlan({ communication_needs: v })}
            canEdit={canEdit}
            addLabel="Add, e.g. Wears hearing aids"
          />
        </div>
      </Section>

      <Section
        id="gp"
        title="GP"
        subtitle={
          <>
            Surfaced from the{' '}
            <Link to="../providers" className="text-primary hover:underline">
              Providers page
            </Link>
            , where the GP is managed.
          </>
        }
        open={open.gp}
        onToggle={toggle}
      >
        <GpTable profileId={profile.id} canEdit={canEdit} />
      </Section>

      <Section
        id="directive"
        title="Advance care directive"
        subtitle={
          <>
            The document itself lives in{' '}
            <Link to="../documents" className="text-primary hover:underline">
              Documents
            </Link>
            .
          </>
        }
        open={open.directive}
        onToggle={toggle}
      >
        <DirectiveSection profileId={profile.id} plan={plan} savePlan={savePlan} canEdit={canEdit} />
      </Section>

      <Section id="contacts" title="Emergency contacts" subtitle="Who to call first, picked from the care circle and providers." open={open.contacts} onToggle={toggle}>
        <EmergencyContactsTable
          profileId={profile.id}
          contacts={plan.emergency_contacts}
          onChange={(v) => savePlan({ emergency_contacts: v })}
          canEdit={canEdit}
        />
      </Section>
    </div>
  );
}

/** A collapsible card section with a toggle header. */
function Section({
  id,
  title,
  subtitle,
  open,
  onToggle,
  accent = false,
  children,
}: {
  id: SectionId;
  title: string;
  /** May contain links, so it renders outside the toggle button. */
  subtitle: React.ReactNode;
  open: boolean;
  onToggle: (id: SectionId) => void;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`card ${accent ? 'border-l-4 border-l-red-500' : ''}`}>
      <button
        type="button"
        className="w-full flex items-start justify-between gap-2 text-left"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span aria-hidden className="text-muted mt-0.5">
          {open ? '▾' : '▸'}
        </span>
      </button>
      <p className="text-sm text-muted">{subtitle}</p>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

/** Column-header sorting state shared by the tables below. */
interface Sort {
  key: string;
  dir: 'asc' | 'desc';
}

function nextSort(sort: Sort, key: string): Sort {
  if (sort.key !== key) return { key, dir: 'asc' };
  return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(b) - Number(a);
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
}

function sortRows<T>(rows: T[], sort: Sort, pick: (row: T, key: string) => unknown): T[] {
  const sorted = [...rows].sort((a, b) => compareValues(pick(a, sort.key), pick(b, sort.key)));
  return sort.dir === 'asc' ? sorted : sorted.reverse();
}

function Th({ label, sortKey, sort, onSort }: { label: string; sortKey: string; sort: Sort; onSort: (s: Sort) => void }) {
  const active = sort.key === sortKey;
  return (
    <th className="py-1.5 pr-3 text-left font-medium text-muted">
      <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => onSort(nextSort(sort, sortKey))}>
        {label}
        <span aria-hidden className={active ? 'text-primary' : 'opacity-30'}>
          {active && sort.dir === 'desc' ? '↓' : '↑'}
        </span>
      </button>
    </th>
  );
}

function FilterInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Input
      aria-label={label}
      placeholder="Filter…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-40"
    />
  );
}

/**
 * The allergy table. Substance and reaction each come from a shared list
 * (which grows with anything new picked here), never a free-text box.
 */
function AllergiesTable({ profileId, canEdit }: { profileId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [sort, setSort] = useState<Sort>({ key: 'substance', dir: 'asc' });
  const [filter, setFilter] = useState('');
  const [newSubstance, setNewSubstance] = useState('');
  const [newReaction, setNewReaction] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editReaction, setEditReaction] = useState('');

  const { data } = useQuery({
    queryKey: ['allergies', profileId],
    queryFn: () => api.get<{ allergies: Allergy[] }>(`/care-profiles/${profileId}/allergies`),
  });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['allergies', profileId] });

  const addMutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/allergies`, { substance: newSubstance, reaction: newReaction || null }),
    onSuccess: () => {
      setNewSubstance('');
      setNewReaction('');
      invalidate();
    },
  });
  const updateMutation = useMutation({
    mutationFn: (input: { id: string; reaction: string | null }) =>
      api.patch(`/care-profiles/${profileId}/allergies/${input.id}`, { reaction: input.reaction }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/allergies/${id}`),
    onSuccess: invalidate,
  });

  const q = filter.trim().toLowerCase();
  const rows = sortRows(
    (data?.allergies ?? []).filter((a) => !q || a.substance.toLowerCase().includes(q) || (a.reaction ?? '').toLowerCase().includes(q)),
    sort,
    (a, key) => (key === 'substance' ? a.substance : a.reaction)
  );

  return (
    <div className="space-y-3">
      {(data?.allergies ?? []).length > 3 ? <FilterInput value={filter} onChange={setFilter} label="Filter allergies" /> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{q ? 'Nothing matches the filter.' : 'No allergies recorded.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <Th label="Allergic to" sortKey="substance" sort={sort} onSort={setSort} />
                <Th label="Reaction" sortKey="reaction" sort={sort} onSort={setSort} />
                {canEdit ? <th className="py-1.5 w-24" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-3 font-medium text-red-700 dark:text-red-300">{a.substance}</td>
                  <td className="py-2 pr-3 text-ink">
                    {editingId === a.id ? (
                      <CatalogueCombo
                        endpoint="/option-catalogue?category=allergy_reaction"
                        ariaLabel={`Reaction to ${a.substance}`}
                        initial={editReaction}
                        keepValue
                        onPick={(name) => setEditReaction(name)}
                        widthClass="w-56"
                      />
                    ) : (
                      a.reaction ?? ''
                    )}
                  </td>
                  {canEdit ? (
                    <td className="py-2 text-right whitespace-nowrap">
                      {editingId === a.id ? (
                        <>
                          <Button
                            size="xs"
                            variant="secondary"
                            className="mr-1"
                            onClick={() => updateMutation.mutate({ id: a.id, reaction: editReaction.trim() || null })}
                          >
                            Save
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="mr-1"
                            onClick={() => {
                              setEditingId(a.id);
                              setEditReaction(a.reaction ?? '');
                            }}
                          >
                            Edit
                          </Button>
                          <Button size="xs" variant="ghost-danger" onClick={() => deleteMutation.mutate(a.id)}>
                            Delete
                          </Button>
                        </>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <CatalogueCombo
            endpoint="/option-catalogue?category=allergen"
            ariaLabel="Allergic to"
            placeholder="Allergic to, e.g. Penicillin"
            exclude={(data?.allergies ?? []).map((a) => a.substance)}
            keepValue
            initial={newSubstance}
            onPick={setNewSubstance}
          />
          <CatalogueCombo
            endpoint="/option-catalogue?category=allergy_reaction"
            ariaLabel="Reaction"
            placeholder="Reaction, e.g. rash"
            keepValue
            initial={newReaction}
            onPick={setNewReaction}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!newSubstance.trim()}
            loading={addMutation.isPending}
            onClick={() => addMutation.mutate()}
          >
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The condition table, with each condition's lifecycle facts in columns. */
function ConditionsTable({ profileId, canEdit }: { profileId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' });
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<MedicalCondition | null>(null);

  const { data } = useQuery({
    queryKey: ['conditions', profileId],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profileId}/conditions`),
  });
  const conditions = data?.conditions ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['conditions', profileId] });

  const addMutation = useMutation({
    mutationFn: (name: string) => api.post(`/care-profiles/${profileId}/conditions`, { name }),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/conditions/${id}`),
    onSuccess: invalidate,
  });

  const managedBy = (c: MedicalCondition): string =>
    [...c.medications.map((m) => m.name), ...(c.treatments ?? []).map((t) => t.name)].join(', ');

  const q = filter.trim().toLowerCase();
  const rows = sortRows(
    conditions.filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        conditionStatusLabel(c.status).toLowerCase().includes(q) ||
        managedBy(c).toLowerCase().includes(q)
    ),
    sort,
    (c, key) => {
      if (key === 'name') return c.name;
      if (key === 'status') return conditionStatusLabel(c.status);
      if (key === 'temporary') return c.is_temporary;
      if (key === 'started') return c.started_on;
      if (key === 'resolved') return c.resolved_on;
      return managedBy(c);
    }
  );

  const fmtDate = (v: string | null) => (v ? format(new Date(v), 'd MMM yyyy') : '');

  return (
    <div className="space-y-3">
      {conditions.length > 3 ? <FilterInput value={filter} onChange={setFilter} label="Filter conditions" /> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{q ? 'Nothing matches the filter.' : 'No conditions recorded.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <Th label="Condition" sortKey="name" sort={sort} onSort={setSort} />
                <Th label="Status" sortKey="status" sort={sort} onSort={setSort} />
                <Th label="Temporary" sortKey="temporary" sort={sort} onSort={setSort} />
                <Th label="Started" sortKey="started" sort={sort} onSort={setSort} />
                <Th label="Resolved" sortKey="resolved" sort={sort} onSort={setSort} />
                <Th label="Managed with" sortKey="managed" sort={sort} onSort={setSort} />
                {canEdit ? <th className="py-1.5 w-24" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 pr-3 font-medium text-ink">{c.name}</td>
                  <td className="py-2 pr-3 text-ink">{conditionStatusLabel(c.status)}</td>
                  <td className="py-2 pr-3 text-ink">{c.is_temporary ? 'Yes' : ''}</td>
                  <td className="py-2 pr-3 text-ink whitespace-nowrap">{fmtDate(c.started_on)}</td>
                  <td className="py-2 pr-3 text-ink whitespace-nowrap">{fmtDate(c.resolved_on)}</td>
                  <td className="py-2 pr-3 text-muted">{managedBy(c)}</td>
                  {canEdit ? (
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button size="xs" variant="ghost" className="mr-1" onClick={() => setEditing(c)}>
                        Edit
                      </Button>
                      <Button size="xs" variant="ghost-danger" onClick={() => deleteMutation.mutate(c.id)}>
                        Delete
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit ? (
        <CatalogueCombo
          endpoint="/condition-catalogue"
          ariaLabel="Add a condition"
          placeholder="Add a condition, e.g. Asthma"
          exclude={conditions.map((c) => c.name)}
          onPick={(name) => addMutation.mutate(name)}
          widthClass="w-64"
        />
      ) : null}
      {editing ? (
        <ConditionEditModal
          profileId={profileId}
          condition={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A condition's lifecycle: whether it is expected to pass, how it stands
 * now, and when it started and cleared. One fact per field; the name comes
 * from the shared condition catalogue.
 */
function ConditionEditModal({
  profileId,
  condition,
  onClose,
  onSaved,
}: {
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
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/care-profiles/${profileId}/conditions/${condition.id}`, {
        name: name.trim(),
        is_temporary: isTemporary,
        status,
        started_on: startedOn || null,
        resolved_on: status === 'resolved' ? resolvedOn || null : null,
      }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  return (
    <Modal open onClose={onClose} title="Edit condition">
      <div className="space-y-4">
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Name</span>
          <CatalogueCombo
            endpoint="/condition-catalogue"
            ariaLabel="Condition name"
            initial={name}
            keepValue
            onPick={setName}
            widthClass="w-full"
          />
        </div>
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
          <label htmlFor="condition-status" className="block text-sm font-medium text-ink mb-1">
            Status
          </label>
          <select id="condition-status" className={`${selectClass} w-full`} value={status} onChange={(e) => setStatus(e.target.value)}>
            {CONDITION_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">{CONDITION_STATUSES.find((s) => s.value === status)?.description}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Started on" type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          {status === 'resolved' ? (
            <Input label="Resolved on" type="date" value={resolvedOn} onChange={(e) => setResolvedOn(e.target.value)} />
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" loading={mutation.isPending} disabled={!name.trim()} onClick={() => mutation.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Active medications and treatments, surfaced read-only from their own pages. */
function MedicationsTables({ profileId }: { profileId: string }) {
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' });
  const [filter, setFilter] = useState('');

  const { data: medData } = useQuery({
    queryKey: ['medications', profileId],
    queryFn: () => api.get<{ medications: MedicationRecord[] }>(`/care-profiles/${profileId}/medications`),
  });
  const { data: treatmentData } = useQuery({
    queryKey: ['treatments', profileId],
    queryFn: () => api.get<{ treatments: Treatment[] }>(`/care-profiles/${profileId}/treatments`),
  });

  const meds = medData?.medications ?? [];
  const treatments = treatmentData?.treatments ?? [];

  const schedule = (times: string[] | null, frequency: string | null, asNeeded: boolean): string => {
    if (asNeeded) return 'As needed';
    if (times && times.length > 0) return times.join(', ');
    return frequency ?? '';
  };

  const q = filter.trim().toLowerCase();
  const medRows = sortRows(
    meds.filter((m) => !q || m.name.toLowerCase().includes(q)),
    sort,
    (m, key) => {
      if (key === 'name') return m.name;
      if (key === 'dose') return m.dose;
      if (key === 'schedule') return schedule(m.schedule_times, m.frequency, m.as_needed);
      if (key === 'supply') return m.supply_remaining;
      return m.active;
    }
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {meds.length > 3 ? <FilterInput value={filter} onChange={setFilter} label="Filter medications" /> : <span />}
        <Link to="../medications" className="text-xs text-primary hover:underline">
          Manage on the Treatments page
        </Link>
      </div>
      {medRows.length === 0 ? (
        <p className="text-sm text-muted">{q ? 'Nothing matches the filter.' : 'No medications recorded.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <Th label="Medication" sortKey="name" sort={sort} onSort={setSort} />
                <Th label="Dose" sortKey="dose" sort={sort} onSort={setSort} />
                <Th label="Schedule" sortKey="schedule" sort={sort} onSort={setSort} />
                <Th label="Supply left" sortKey="supply" sort={sort} onSort={setSort} />
                <Th label="Status" sortKey="active" sort={sort} onSort={setSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {medRows.map((m) => (
                <tr key={m.id} className={m.active ? '' : 'opacity-60'}>
                  <td className="py-2 pr-3 font-medium text-ink">{m.name}</td>
                  <td className="py-2 pr-3 text-ink">{m.dose ?? ''}</td>
                  <td className="py-2 pr-3 text-ink">{schedule(m.schedule_times, m.frequency, m.as_needed)}</td>
                  <td className="py-2 pr-3 text-ink">{m.supply_remaining ?? ''}</td>
                  <td className="py-2 pr-3 text-muted">{m.active ? 'Active' : 'Stopped'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {treatments.length > 0 ? (
        <div className="overflow-x-auto">
          <p className="text-sm font-medium text-ink mb-1">Other treatments</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Treatment</th>
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Kind</th>
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Schedule</th>
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {treatments.map((t) => (
                <tr key={t.id} className={t.active ? '' : 'opacity-60'}>
                  <td className="py-2 pr-3 font-medium text-ink">{t.name}</td>
                  <td className="py-2 pr-3 text-ink capitalize">{t.category.replace(/_/g, ' ')}</td>
                  <td className="py-2 pr-3 text-ink">{schedule(t.schedule_times, t.frequency, t.as_needed)}</td>
                  <td className="py-2 pr-3 text-muted">{t.active ? 'Active' : 'Stopped'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The GP lives in the providers table, but is added and corrected right
 * here: a row of structured fields writes a GP provider without leaving
 * the page. The Providers page remains the home for everything else about
 * them.
 */
function GpTable({ profileId, canEdit }: { profileId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [practice, setPractice] = useState('');
  const [phone, setPhone] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', organisation: '', phone: '' });

  const { data } = useQuery({
    queryKey: ['providers', profileId],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profileId}/providers`),
  });
  const gps = (data?.providers ?? []).filter((p) => p.provider_type === 'gp');
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['providers', profileId] });

  const addMutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/providers`, {
        provider_type: 'gp',
        name: name.trim(),
        organisation: practice.trim() || null,
        phone: phone.trim() || null,
      }),
    onSuccess: () => {
      setName('');
      setPractice('');
      setPhone('');
      invalidate();
    },
  });
  const updateMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/care-profiles/${profileId}/providers/${id}`, {
        name: edit.name.trim(),
        organisation: edit.organisation.trim() || null,
        phone: edit.phone.trim() || null,
      }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });

  return (
    <div className="space-y-2">
      {gps.length === 0 ? (
        <p className="text-sm text-muted">No GP recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Name</th>
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Practice</th>
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Phone</th>
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Email</th>
                {canEdit ? <th className="py-1.5 w-20" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {gps.map((p) => (
                <tr key={p.id}>
                  {editingId === p.id ? (
                    <>
                      <td className="py-2 pr-3">
                        <Input aria-label="GP name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="w-36" />
                      </td>
                      <td className="py-2 pr-3">
                        <Input aria-label="GP practice" value={edit.organisation} onChange={(e) => setEdit({ ...edit, organisation: e.target.value })} className="w-36" />
                      </td>
                      <td className="py-2 pr-3">
                        <Input aria-label="GP phone" type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} className="w-32" />
                      </td>
                      <td className="py-2 pr-3 text-ink">{p.email ?? ''}</td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-3 font-medium text-ink">{p.name}</td>
                      <td className="py-2 pr-3 text-ink">{p.organisation ?? ''}</td>
                      <td className="py-2 pr-3 text-ink whitespace-nowrap">{p.phone ?? ''}</td>
                      <td className="py-2 pr-3 text-ink">{p.email ?? ''}</td>
                    </>
                  )}
                  {canEdit ? (
                    <td className="py-2 text-right whitespace-nowrap">
                      {editingId === p.id ? (
                        <>
                          <Button
                            size="xs"
                            variant="secondary"
                            className="mr-1"
                            onClick={() => edit.name.trim() && updateMutation.mutate(p.id)}
                          >
                            Save
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(p.id);
                            setEdit({ name: p.name, organisation: p.organisation ?? '', phone: p.phone ?? '' });
                          }}
                        >
                          Edit
                        </Button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <Input aria-label="GP name" placeholder={gps.length === 0 ? 'GP name' : 'Another GP'} value={name} onChange={(e) => setName(e.target.value)} className="w-40" />
          <Input aria-label="GP practice" placeholder="Practice" value={practice} onChange={(e) => setPractice(e.target.value)} className="w-40" />
          <Input aria-label="GP phone" type="tel" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-36" />
          <Button type="button" variant="secondary" size="sm" disabled={!name.trim()} loading={addMutation.isPending} onClick={() => addMutation.mutate()}>
            Add GP
          </Button>
        </div>
      ) : null}
      {gps.length > 0 ? (
        <Link to="../providers" className="text-xs text-primary hover:underline">
          Everything else about them is on the Providers page
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Whether a directive is in place, where it is kept (picked from a shared
 * list of places), and any directive documents surfaced from Documents.
 */
function DirectiveSection({
  profileId,
  plan,
  savePlan,
  canEdit,
}: {
  profileId: string;
  plan: CarePlan;
  savePlan: (patch: Partial<CarePlan>) => void;
  canEdit: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['documents', profileId],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profileId}/documents`),
  });
  const directiveDocs = (data?.documents ?? []).filter((d) => d.category === 'advance_care_directive');

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          checked={plan.advance_care_directive}
          disabled={!canEdit}
          onChange={(e) => savePlan({ advance_care_directive: e.target.checked })}
        />
        An advance care directive is in place
      </label>
      {plan.advance_care_directive ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Where it is kept:</span>
          {canEdit ? (
            <CatalogueCombo
              endpoint="/option-catalogue?category=directive_location"
              ariaLabel="Where the directive is kept"
              placeholder="e.g. With the GP"
              initial={plan.advance_care_directive_location ?? ''}
              keepValue
              onPick={(name) => savePlan({ advance_care_directive_location: name })}
              widthClass="w-56"
            />
          ) : (
            <span className="text-ink">{plan.advance_care_directive_location ?? 'Not recorded'}</span>
          )}
        </div>
      ) : null}
      {directiveDocs.length > 0 ? (
        <ul className="space-y-1">
          {directiveDocs.map((d) => (
            <li key={d.id} className="text-sm">
              <Link to="../documents" className="text-primary hover:underline">
                {d.label}
              </Link>{' '}
              <span className="text-muted">added {format(new Date(d.created_at), 'd MMM yyyy')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No directive document on file.</p>
      )}
      {canEdit ? <DirectiveUpload profileId={profileId} /> : null}
    </div>
  );
}

/**
 * Upload the directive right here. The file lands in Documents under the
 * advance care directive category, exactly as if it were uploaded there.
 */
function DirectiveUpload({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');

  const uploadMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('file', file!);
      form.append('category', 'advance_care_directive');
      form.append('label', file!.name);
      return api.upload(`/care-profiles/${profileId}/documents`, form);
    },
    onSuccess: () => {
      setFile(null);
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['documents', profileId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Upload failed'),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="file"
        aria-label="Upload the advance care directive"
        className="text-sm text-muted file:mr-2 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-ink file:cursor-pointer"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!file}
        loading={uploadMutation.isPending}
        onClick={() => uploadMutation.mutate()}
      >
        Upload directive
      </Button>
      {error ? <p className="text-sm text-red-600 w-full">{error}</p> : null}
    </div>
  );
}

/**
 * Emergency contacts as an editable table. Who to call is picked from the
 * people already in the system, the care circle and the providers, so the
 * name is never typed. The phone completes automatically for providers and
 * can be filled in for circle members.
 */
function EmergencyContactsTable({
  profileId,
  contacts,
  onChange,
  canEdit,
}: {
  profileId: string;
  contacts: EmergencyContact[];
  onChange: (v: EmergencyContact[]) => void;
  canEdit: boolean;
}) {
  const [who, setWho] = useState('');
  const [customName, setCustomName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editRelationship, setEditRelationship] = useState('');
  const [editPhone, setEditPhone] = useState('');

  const { data: circleData } = useQuery({
    queryKey: ['circle', profileId],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profileId}/circle`),
    enabled: canEdit,
  });
  const { data: providerData } = useQuery({
    queryKey: ['providers', profileId],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profileId}/providers`),
    enabled: canEdit,
  });
  const members = circleData?.members ?? [];
  const providers = providerData?.providers ?? [];

  const pickWho = (value: string) => {
    setWho(value);
    if (value === 'other') {
      setCustomName('');
      setRelationship('');
      setPhone('');
      return;
    }
    const [source, id] = value.split(':');
    if (source === 'member') {
      const m = members.find((x) => x.id === id);
      setRelationship(m?.relationship ?? '');
      setPhone('');
    } else if (source === 'provider') {
      const p = providers.find((x) => x.id === id);
      setRelationship('');
      setPhone(p?.phone ?? '');
    }
  };

  const nameOf = (value: string): string => {
    if (value === 'other') return customName.trim();
    const [source, id] = value.split(':');
    if (source === 'member') return members.find((x) => x.id === id)?.display_name ?? '';
    if (source === 'provider') return providers.find((x) => x.id === id)?.name ?? '';
    return '';
  };

  const add = () => {
    const name = nameOf(who);
    if (!name || !phone.trim()) return;
    onChange([...contacts, { name, relationship: relationship || undefined, phone: phone.trim() }]);
    setWho('');
    setCustomName('');
    setRelationship('');
    setPhone('');
  };

  return (
    <div className="space-y-3">
      {contacts.length === 0 ? (
        <p className="text-sm text-muted">No emergency contacts recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Name</th>
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Relationship</th>
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Phone</th>
                {canEdit ? <th className="py-1.5 w-24" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contacts.map((c, i) => (
                <tr key={`${c.name}-${i}`}>
                  <td className="py-2 pr-3 font-medium text-ink">{c.name}</td>
                  <td className="py-2 pr-3 text-ink">
                    {editingIndex === i ? (
                      <select
                        aria-label={`Relationship of ${c.name}`}
                        className={selectClass}
                        value={editRelationship}
                        onChange={(e) => setEditRelationship(e.target.value)}
                      >
                        <option value="">Prefer not to say</option>
                        {RELATIONSHIPS.filter((r) => r !== 'Myself').map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      c.relationship ?? ''
                    )}
                  </td>
                  <td className="py-2 pr-3 text-ink whitespace-nowrap">
                    {editingIndex === i ? (
                      <Input
                        aria-label={`Phone for ${c.name}`}
                        type="tel"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="w-40"
                      />
                    ) : (
                      c.phone
                    )}
                  </td>
                  {canEdit ? (
                    <td className="py-2 text-right whitespace-nowrap">
                      {editingIndex === i ? (
                        <>
                          <Button
                            size="xs"
                            variant="secondary"
                            className="mr-1"
                            onClick={() => {
                              onChange(
                                contacts.map((x, idx) =>
                                  idx === i ? { ...x, relationship: editRelationship || undefined, phone: editPhone.trim() } : x
                                )
                              );
                              setEditingIndex(null);
                            }}
                          >
                            Save
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => setEditingIndex(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="mr-1"
                            onClick={() => {
                              setEditingIndex(i);
                              setEditRelationship(c.relationship ?? '');
                              setEditPhone(c.phone);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost-danger"
                            onClick={() => onChange(contacts.filter((_, idx) => idx !== i))}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Who</span>
            <select aria-label="Who to contact in an emergency" className={selectClass} value={who} onChange={(e) => pickWho(e.target.value)}>
              <option value="">Choose who to call</option>
              {members.length > 0 ? (
                <optgroup label="People in the care circle">
                  {members.map((m) => (
                    <option key={m.id} value={`member:${m.id}`}>
                      {m.display_name}
                      {m.relationship ? ` — ${m.relationship}` : ''}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {providers.length > 0 ? (
                <optgroup label="Providers">
                  {providers.map((p) => (
                    <option key={p.id} value={`provider:${p.id}`}>
                      {p.name} — {providerTypeLabel(p.provider_type)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <option value="other">Someone not in PareCare</option>
            </select>
          </label>
          {who === 'other' ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Name</span>
              <Input aria-label="Emergency contact name" value={customName} onChange={(e) => setCustomName(e.target.value)} className="w-40" />
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Relationship</span>
            <select aria-label="Relationship to this person" className={selectClass} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
              <option value="">Prefer not to say</option>
              {RELATIONSHIPS.filter((r) => r !== 'Myself').map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Phone</span>
            <Input aria-label="Emergency contact phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-40" />
          </label>
          <Button type="button" variant="secondary" size="sm" disabled={!nameOf(who) || !phone.trim()} onClick={add}>
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
