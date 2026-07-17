import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { PagePurpose } from '../../../components/PagePurpose';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useProfile } from './ProfileLayout';
import { ImportExport } from '../../../components/ImportExport';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import {
  DOSE_MEASURES,
  MED_ROUTES,
  MED_STATUSES,
  MED_TYPES,
  SELF_RELATIONSHIP,
  medStatusDescription,
  regimenLine,
  supplyLabel,
  totalOnHand,
  type MedicalCondition,
  type MedicationRecord,
} from '../../../lib/care';

// Domain sort/filter helpers for the reusable data view.
const earliestTime = (m: MedicationRecord): number => {
  const times = m.schedule_times ?? [];
  if (times.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...times.map((t) => { const [h, mm] = t.split(':'); return Number(h) * 60 + Number(mm); }));
};
const doseValue = (m: MedicationRecord): number => {
  const n = parseFloat(String(m.dose ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};
const byName = (a: MedicationRecord, b: MedicationRecord) => a.name.localeCompare(b.name);

const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))));

const MED_SORTS: DataSort<MedicationRecord>[] = [
  { key: 'default', label: 'Active first, then name', compare: (a, b) => (Number(b.active) - Number(a.active)) || byName(a, b) },
  { key: 'schedule', label: 'By time of day (through the day)', compare: (a, b) => (earliestTime(a) - earliestTime(b)) || byName(a, b) },
  { key: 'dose', label: 'By dose (low to high)', compare: (a, b) => (doseValue(a) - doseValue(b)) || byName(a, b) },
  { key: 'name', label: 'By name (A–Z)', compare: byName },
];

const SELECT = 'rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function MedicationsPage() {
  const { profile, access, canEdit, careName, relationship } = useProfile();
  const selfCare = relationship === SELF_RELATIONSHIP;
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<MedicationRecord | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [confirmBulkLog, setConfirmBulkLog] = useState(false);
  const [confirmSingleDelete, setConfirmSingleDelete] = useState<MedicationRecord | null>(null);
  // The management list opens expanded so the regimen is visible at a
  // glance; it can be collapsed to focus on the record below.
  const [listOpen, setListOpen] = useState(true);

  const { data } = useQuery({
    queryKey: ['medications', profile.id],
    queryFn: () => api.get<{ medications: MedicationRecord[] }>(`/care-profiles/${profile.id}/medications`),
  });
  const meds = data?.medications ?? [];
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['medications', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['med-chart', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['med-log', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['calendar-events', profile.id] });
  };

  // Managing the medication list (add/edit/delete/import, incl. bulk delete) is
  // limited to the owner and platform admins/super admins. Contributors are
  // read-only for the list but can still record administrations, so they may
  // select rows to log a dose against several medications at once.
  const canManageMeds = access === 'owner' || access === 'admin';
  const canBulkDelete = canManageMeds;
  const canAdminister = canEdit; // everyone except viewers
  const canSelect = canAdminister || canBulkDelete;

  const routeFilter: DataFilter<MedicationRecord> = {
    key: 'route',
    label: 'Route',
    options: [...new Set(meds.map((m) => m.route).filter((r): r is string => !!r))].map((r) => ({ value: r, label: r })),
    match: (m, v) => m.route === v,
  };
  const statusFilter: DataFilter<MedicationRecord> = {
    key: 'status',
    label: 'Status',
    options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }],
    match: (m, v) => (v === 'active' ? m.active : !m.active),
  };

  const dv = useDataView<MedicationRecord>({
    rows: meds,
    getId: (m) => m.id,
    searchText: (m) => [m.name, m.dose, m.route, m.frequency].filter(Boolean).join(' '),
    sorts: MED_SORTS,
    filters: [statusFilter, routeFilter],
  });

  const bulkDelete = useMutation({
    mutationFn: () => api.post<{ deleted: number }>(`/care-profiles/${profile.id}/medications/bulk`, {
      action: 'delete',
      ids: dv.selectedRows.map((m) => m.id),
    }),
    onSuccess: () => { setConfirmBulk(false); dv.clearSelection(); invalidate(); },
  });

  // Record a dose now for every selected medication in one shot.
  const bulkLog = useMutation({
    mutationFn: () => api.post<{ recorded: number }>(`/care-profiles/${profile.id}/medications/administrations/batch`, {
      entries: dv.selectedRows.map((m) => ({ medication_id: m.id, administered_at: new Date().toISOString(), status: 'given' })),
    }),
    onSuccess: () => { setConfirmBulkLog(false); dv.clearSelection(); invalidate(); },
  });

  const singleDelete = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/medications/${id}`),
    onSuccess: () => { setConfirmSingleDelete(null); invalidate(); },
  });

  const bulkSetActive = useMutation({
    mutationFn: (action: 'activate' | 'deactivate') => api.post(`/care-profiles/${profile.id}/medications/bulk`, {
      action, ids: dv.selectedRows.map((m) => m.id),
    }),
    onSuccess: () => { dv.clearSelection(); invalidate(); },
  });

  const bulkActions: ToolbarBulkAction[] = [
    ...(canAdminister ? [{ key: 'log', label: 'Record all doses', onRun: () => setConfirmBulkLog(true) }] : []),
    ...(canManageMeds ? [
      { key: 'activate', label: 'Mark active', onRun: () => bulkSetActive.mutate('activate') },
      { key: 'deactivate', label: 'Mark inactive', onRun: () => bulkSetActive.mutate('deactivate') },
    ] : []),
    ...(canBulkDelete ? [{ key: 'delete', label: 'Delete selected', destructive: true, onRun: () => setConfirmBulk(true) }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">
            <button
              type="button"
              onClick={() => setListOpen((o) => !o)}
              className="inline-flex items-center gap-2 text-left"
              aria-expanded={listOpen}
            >
              <span className={`text-muted transition-transform ${listOpen ? 'rotate-90' : ''}`} aria-hidden>▶</span>
              <span>Medications</span>
              <span className="text-xs font-normal text-muted">{meds.length} on file · {listOpen ? 'hide' : 'manage'}</span>
            </button>
            <span className="ml-2"><PagePurpose kind="entry" /></span>
          </h2>
          <p className="mt-1 text-sm text-muted">
            {careName}'s current regimen. Add, edit and organise medications here; log and review doses in the record below.
          </p>
        </div>
        {listOpen ? (
          <div className="flex flex-wrap gap-2 self-start sm:self-auto">
            <ImportExport
              basePath={`/care-profiles/${profile.id}/medications`}
              resource="medications"
              canImport={canManageMeds}
              onImported={invalidate}
              templateHeaders={['Name', 'Units per dose', 'Dose', 'Type', 'Route', 'With food', 'As needed', 'Times', 'Instructions', 'Supply in units', 'Packs on hand', 'Active']}
              templateSample={['Metformin', '1', '500 mg', 'Tablet', 'By mouth', 'true', 'false', '08:00; 20:00', 'Take with a full glass of water', '60', '2', 'true']}
            />
            {canManageMeds ? <Button onClick={() => setAddOpen(true)}>Add medication</Button> : null}
          </div>
        ) : null}
      </div>

      {listOpen ? (
        <>
          <DataToolbar
            search={dv.search}
            onSearch={dv.setSearch}
            searchPlaceholder="Search medications…"
            sorts={MED_SORTS.map((s) => ({ key: s.key, label: s.label }))}
            sortKey={dv.sortKey}
            onSort={dv.setSortKey}
            filters={[statusFilter, routeFilter].map((f) => ({ key: f.key, label: f.label, options: f.options }))}
            filterValues={dv.filterValues}
            onFilter={dv.setFilter}
            selectedCount={dv.selectedRows.length}
            bulkActions={bulkActions}
            onClearSelection={dv.clearSelection}
            page={dv.page}
            totalPages={dv.totalPages}
            pageSize={dv.pageSize}
            totalFiltered={dv.totalFiltered}
            onPageChange={dv.setPage}
            onPageSizeChange={dv.setPageSize}
          />

          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  {canSelect ? (
                    <th className="px-4 py-3 w-8">
                      <input type="checkbox" aria-label="Select all" className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={dv.allSelected} onChange={dv.toggleAll} />
                    </th>
                  ) : null}
                  <th className="px-4 py-3 font-medium">Medication</th>
                  <th className="px-4 py-3 font-medium">Unit</th>
                  <th className="px-4 py-3 font-medium">Dose</th>
                  <th className="px-4 py-3 font-medium">Route</th>
                  <th className="px-4 py-3 font-medium">Schedule</th>
                  <th className="px-4 py-3 font-medium">Packs on hand</th>
                  <th className="px-4 py-3 font-medium">Supply left</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dv.view.length === 0 ? (
                  <tr><td colSpan={canSelect ? 9 : 8} className="px-4 py-8 text-center text-muted">{meds.length === 0 ? 'No medications recorded yet.' : 'No medications match your search or filters.'}</td></tr>
                ) : dv.view.map((m) => {
                  // What's on hand overall: loose units plus unopened packs.
                  const remaining = totalOnHand(m);
                  return (
                  <tr key={m.id} className={`border-b border-border last:border-0 ${m.active ? '' : 'opacity-60'}`}>
                    {canSelect ? (
                      <td className="px-4 py-3">
                        <input type="checkbox" aria-label={`Select ${m.name}`} className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                          checked={dv.selected.has(m.id)} onChange={() => dv.toggle(m.id)} />
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <div data-testid="med-name" className="font-medium text-ink">{m.name}{m.active ? '' : ' (inactive)'}</div>
                      {m.condition_name ? <div className="text-xs text-muted">For {m.condition_name}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-muted">{m.units_per_dose != null ? fmtNum(m.units_per_dose) : '—'}</td>
                    <td className="px-4 py-3 text-muted">{m.dose || '—'}</td>
                    <td className="px-4 py-3 text-muted">{m.route || '—'}</td>
                    <td className="px-4 py-3 text-muted">
                      <div>{regimenLine(m) || '—'}</div>
                      {m.as_needed ? (
                        <div className="text-xs">As needed</div>
                      ) : m.schedule_times?.length ? (
                        <div className="text-xs">{m.schedule_times.join(', ')}</div>
                      ) : null}
                      {m.instructions ? <div className="text-xs">{m.instructions}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-muted">{m.packs_on_hand != null ? fmtNum(m.packs_on_hand) : '—'}</td>
                    <td className="px-4 py-3">
                      {remaining == null ? (
                        <span className="text-muted">—</span>
                      ) : remaining <= 0 ? (
                        <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">Out of stock</span>
                      ) : (
                        <span className={`text-ink ${m.supply != null && remaining <= m.supply * 0.15 ? 'text-amber-700 dark:text-amber-300 font-medium' : ''}`}>
                          {supplyLabel(remaining, m)} left
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                      {canManageMeds ? <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>Edit</Button> : null}
                      {canManageMeds ? <Button size="sm" variant="danger" onClick={() => setConfirmSingleDelete(m)}>Delete</Button> : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className="pt-2">
        <p className="text-sm text-muted">
          Looking for dose logging? The{' '}
          <Link to="../mar" className="text-primary hover:underline">Medication record</Link>{' '}
          is under Management, where each dose given is logged and reviewed.
        </p>
      </div>

      {addOpen ? <MedicationForm profileId={profile.id} selfCare={selfCare} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); invalidate(); }} /> : null}
      {editing ? <MedicationForm profileId={profile.id} med={editing} selfCare={selfCare} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} /> : null}

      <Modal open={confirmBulk} onClose={() => setConfirmBulk(false)} title="Delete medications">
        <p className="text-sm text-muted mb-4">
          Permanently delete <span className="font-medium text-ink">{dv.selectedRows.length}</span> selected
          medication{dv.selectedRows.length === 1 ? '' : 's'}? Their administration history is removed too. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmBulk(false)}>Cancel</Button>
          <Button variant="danger" loading={bulkDelete.isPending} onClick={() => bulkDelete.mutate()}>Delete {dv.selectedRows.length}</Button>
        </div>
      </Modal>

      <Modal open={confirmSingleDelete !== null} onClose={() => setConfirmSingleDelete(null)} title="Delete medication">
        <p className="text-sm text-muted mb-4">
          Permanently delete <span className="font-medium text-ink">{confirmSingleDelete?.name}</span> and its administration history? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmSingleDelete(null)}>Cancel</Button>
          <Button variant="danger" loading={singleDelete.isPending} onClick={() => confirmSingleDelete && singleDelete.mutate(confirmSingleDelete.id)}>Delete</Button>
        </div>
      </Modal>

      <Modal open={confirmBulkLog} onClose={() => setConfirmBulkLog(false)} title="Record all doses">
        <p className="text-sm text-muted mb-4">
          Record a dose as given, now, for <span className="font-medium text-ink">{dv.selectedRows.length}</span> selected
          medication{dv.selectedRows.length === 1 ? '' : 's'}? Each is logged to the MAR against {profile.full_name}.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmBulkLog(false)}>Cancel</Button>
          <Button loading={bulkLog.isPending} onClick={() => bulkLog.mutate()}>Record {dv.selectedRows.length}</Button>
        </div>
      </Modal>
    </div>
  );
}

// Convert stored 24h "HH:MM" to 12h parts and back, for the schedule inputs.
function to12(hhmm: string): { hour: string; minute: string; ampm: 'AM' | 'PM' } {
  const [h, m] = hhmm.split(':');
  const hour = Number(h);
  return {
    hour: String(hour % 12 === 0 ? 12 : hour % 12),
    minute: m ?? '00',
    ampm: hour >= 12 ? 'PM' : 'AM',
  };
}
function to24(hour: string, minute: string, ampm: 'AM' | 'PM'): string {
  let h = Number(hour) % 12;
  if (ampm === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${(minute || '00').padStart(2, '0')}`;
}

/** One time-of-day picker in 12-hour form, stored as 24h "HH:MM". */
function TimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { hour, minute, ampm } = to12(value || '08:00');
  return (
    <span className="inline-flex items-center gap-1">
      <select aria-label="Hour" className={SELECT} value={hour} onChange={(e) => onChange(to24(e.target.value, minute, ampm))}>
        {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="text-muted">:</span>
      <select aria-label="Minute" className={SELECT} value={minute} onChange={(e) => onChange(to24(hour, e.target.value, ampm))}>
        {['00', '15', '30', '45'].map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select aria-label="AM or PM" className={SELECT} value={ampm} onChange={(e) => onChange(to24(hour, minute, e.target.value as 'AM' | 'PM'))}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </span>
  );
}

/**
 * The medication editor, laid out as three plain-language sentences:
 * the treatment, the schedule, and the supply. Every value in the
 * sentences is its own field underneath.
 */
function MedicationForm({ profileId, med, selfCare, onClose, onSaved }: { profileId: string; med?: MedicationRecord; selfCare: boolean; onClose: () => void; onSaved: () => void }) {
  const subject = selfCare ? 'I' : 'They';
  const [name, setName] = useState(med?.name ?? '');
  const [condition, setCondition] = useState(med?.condition_name ?? '');
  const [units, setUnits] = useState(med?.units_per_dose != null ? String(med.units_per_dose) : '1');
  const [doseAmount, setDoseAmount] = useState(med?.dose_amount ?? '');
  const [doseUnit, setDoseUnit] = useState(med?.dose_unit ?? '');
  const [type, setType] = useState(med?.form ?? '');
  const [route, setRoute] = useState(med?.route ?? '');
  const [withFood, setWithFood] = useState(med?.with_food ?? false);
  const [critical, setCritical] = useState(med?.critical ?? false);
  // Times a day drives how many time fields show; 0 means as needed.
  const initialTimes = med?.schedule_times ?? [];
  const [perDay, setPerDay] = useState(med?.as_needed ? 0 : initialTimes.length || 1);
  const [slots, setSlots] = useState<string[]>(initialTimes.length ? initialTimes : ['08:00']);
  const [packSize, setPackSize] = useState(med?.supply != null ? String(med.supply) : '');
  const [remaining, setRemaining] = useState(med?.supply_remaining != null ? String(med.supply_remaining) : '');
  const [packs, setPacks] = useState(med?.packs_on_hand != null ? String(med.packs_on_hand) : '');
  const [repeatsDue, setRepeatsDue] = useState(med?.repeats_due ?? '');
  const [error, setError] = useState('');

  const typeMeta = MED_TYPES.find((t) => t.value.toLowerCase() === type.toLowerCase());

  // Shared catalogue drives the name autocomplete, so the same drug is reused.
  const { data: catalogue } = useQuery({
    queryKey: ['medication-catalogue'],
    queryFn: () => api.get<{ items: { id: string; name: string; form: string | null }[] }>('/medication-catalogue'),
  });
  const suggestions = catalogue?.items ?? [];

  const { data: conditionData } = useQuery({
    queryKey: ['conditions', profileId],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profileId}/conditions`),
  });
  const conditions = conditionData?.conditions ?? [];

  // The type suggests the route; the route stays editable.
  const pickType = (value: string) => {
    setType(value);
    const t = MED_TYPES.find((x) => x.value === value);
    if (t && (!route || MED_ROUTES.includes(route as (typeof MED_ROUTES)[number]))) setRoute(t.defaultRoute);
  };

  // Keep the number of time slots in step with the times-a-day number.
  const setPerDayCount = (n: number) => {
    const count = Math.max(0, Math.min(12, Math.floor(n)));
    setPerDay(count);
    setSlots((prev) => {
      if (count <= prev.length) return prev.slice(0, count);
      const next = [...prev];
      const defaults = ['08:00', '12:00', '18:00', '22:00'];
      while (next.length < count) next.push(defaults[next.length] ?? '08:00');
      return next;
    });
  };

  const setSlot = (i: number, v: string) => setSlots((prev) => prev.map((s, j) => (j === i ? v : s)));

  const mutation = useMutation({
    mutationFn: () => {
      const asNeeded = perDay < 1;
      const body = {
        name: name.trim(),
        medical_condition_name: condition.trim() || '',
        units_per_dose: units.trim() === '' ? null : Number(units),
        dose_amount: doseAmount.trim() || null,
        dose_unit: doseUnit.trim() || null,
        form: type || null,
        route: route || null,
        with_food: withFood,
        as_needed: asNeeded,
        critical,
        schedule_times: asNeeded ? [] : slots.slice(0, perDay),
        supply: packSize.trim() === '' ? null : Number(packSize),
        supply_remaining: remaining.trim() === '' ? null : Number(remaining),
        packs_on_hand: packs.trim() === '' ? null : Number(packs),
        repeats_due: repeatsDue || null,
      };
      return med ? api.patch(`/care-profiles/${profileId}/medications/${med.id}`, body) : api.post(`/care-profiles/${profileId}/medications`, body);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  const routeOptions: string[] = [...MED_ROUTES];
  if (route && !routeOptions.includes(route)) routeOptions.unshift(route);

  const inlineSelect = `${SELECT} inline-block w-auto`;
  const inlineInput = 'inline-block w-20 rounded-md border border-border bg-card px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
  const containerWord = typeMeta?.container ?? 'pack';
  // A liquid or cream is stocked by volume in its dose measure (mL);
  // everything else by count of its unit (tablets, puffs).
  const supplyWord = typeMeta?.measured ? doseUnit.trim() || 'mL' : typeMeta ? typeMeta.plural.toLowerCase() : 'units';

  return (
    <Modal open onClose={onClose} title={med ? 'Edit medication' : 'Add medication'} wide>
      <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (name.trim()) mutation.mutate(); }}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Metformin" list="med-catalogue-options" hint="Pick an existing medication to reuse it, or type a new one." />
        <datalist id="med-catalogue-options">
          {suggestions.map((s) => <option key={s.id} value={s.name} />)}
        </datalist>

        <section>
          <h3 className="text-sm font-semibold text-ink mb-2">Treatment</h3>
          <p className="text-sm text-ink leading-8">
            To treat{' '}
            <input
              className={`${inlineInput} w-44`}
              aria-label="Condition"
              placeholder="condition"
              list="condition-options"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            />
            <datalist id="condition-options">
              {conditions.map((c) => <option key={c.id} value={c.name} />)}
            </datalist>{' '}
            {subject} take{' '}
            <input className={inlineInput} aria-label="Units per dose" type="number" min="0" step="any" value={units} onChange={(e) => setUnits(e.target.value)} />{' '}
            <input className={`${inlineInput} w-16`} aria-label="Dose amount" placeholder="20" value={doseAmount} onChange={(e) => setDoseAmount(e.target.value)} />
            <input className={`${inlineInput} w-16`} aria-label="Dose measure" placeholder="mg" list="dose-measures" value={doseUnit} onChange={(e) => setDoseUnit(e.target.value)} />
            <datalist id="dose-measures">
              {DOSE_MEASURES.map((m) => <option key={m} value={m} />)}
            </datalist>{' '}
            in{' '}
            <select className={inlineSelect} aria-label="Type" value={type} onChange={(e) => pickType(e.target.value)}>
              <option value="">…</option>
              {MED_TYPES.map((t) => <option key={t.value} value={t.value}>{t.value}</option>)}
              {type && !MED_TYPES.some((t) => t.value === type) ? <option value={type}>{type}</option> : null}
            </select>{' '}
            form via{' '}
            <select className={inlineSelect} aria-label="Route" value={route} onChange={(e) => setRoute(e.target.value)}>
              <option value="">…</option>
              {routeOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>.
          </p>
          <p className="text-xs text-muted mt-1">A condition that isn't already recorded is added to this person's conditions.</p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink mb-2">Schedule</h3>
          <p className="text-sm text-ink leading-8">
            It's taken{' '}
            <input className={inlineInput} aria-label="Times a day" type="number" min="0" max="12" value={perDay} onChange={(e) => setPerDayCount(Number(e.target.value))} />{' '}
            {perDay === 1 ? 'time a day' : 'times a day'},{' '}
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={withFood} onChange={(e) => setWithFood(e.target.checked)} />
              with food
            </label>
            {perDay > 0 ? ', at' : '.'}
          </p>
          {perDay > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {slots.slice(0, perDay).map((s, i) => (
                <TimeField key={i} value={s} onChange={(v) => setSlot(i, v)} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">Set to 0 for a medication taken only as needed.</p>
          )}
          <label className="mt-3 flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={critical}
              onChange={(e) => setCritical(e.target.checked)}
            />
            <span>
              Dangerous to miss
              <span className="block text-xs text-muted">
                Some medications are harmful to stop suddenly. When ticked, an overdue dose or an empty supply raises an
                urgent alert; otherwise it is a normal notification.
              </span>
            </span>
          </label>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink mb-2">Supply</h3>
          <p className="text-sm text-ink leading-8">
            A new {containerWord} provides{' '}
            <input className={inlineInput} aria-label="A full pack provides" type="number" min="0" step="any" value={packSize} onChange={(e) => setPackSize(e.target.value)} />{' '}
            {supplyWord}.
          </p>
          <p className="text-sm text-ink leading-8">
            We have{' '}
            <input className={inlineInput} aria-label="Unopened packs on hand" type="number" min="0" step="any" value={packs} onChange={(e) => setPacks(e.target.value)} />{' '}
            unopened {packs.trim() === '1' ? containerWord : `${containerWord}s`} and{' '}
            <input className={inlineInput} aria-label="Amount left in the open pack" type="number" min="0" step="any" value={remaining} onChange={(e) => setRemaining(e.target.value)} />{' '}
            {supplyWord} in the open {containerWord}.
          </p>
          <p className="text-sm text-ink leading-8">
            Repeats due:{' '}
            <input className={`${inlineInput} w-40`} aria-label="Repeats due" type="date" value={repeatsDue} onChange={(e) => setRepeatsDue(e.target.value)} />
          </p>
          <p className="text-xs text-muted mt-1">
            {typeMeta?.measured
              ? `Each dose given counts the ${supplyWord} on hand down by the dose volume.`
              : 'Each dose given counts the units on hand down by the number taken each time.'}{' '}
            When the open {containerWord} runs out, the next unopened one is opened automatically.
          </p>
        </section>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!name.trim()}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function localNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

