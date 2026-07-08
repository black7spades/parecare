import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useProfile } from './ProfileLayout';
import { ImportExport } from '../../../components/ImportExport';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import { MED_STATUSES, medStatusDescription, type MedicationRecord } from '../../../lib/care';
import { MedicationMar } from './MedicationMar';

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

// The unit is captured as part of the dose string (e.g. "500 mg"); reuse it to
// label the supply count so "29500 mg" reads sensibly without a second field.
const doseUnit = (dose: string | null): string => {
  const m = String(dose ?? '').match(/[a-zA-Z%]+/);
  return m ? m[0] : '';
};
const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))));

const MED_SORTS: DataSort<MedicationRecord>[] = [
  { key: 'default', label: 'Active first, then name', compare: (a, b) => (Number(b.active) - Number(a.active)) || byName(a, b) },
  { key: 'schedule', label: 'By time of day (through the day)', compare: (a, b) => (earliestTime(a) - earliestTime(b)) || byName(a, b) },
  { key: 'dose', label: 'By dose (low to high)', compare: (a, b) => (doseValue(a) - doseValue(b)) || byName(a, b) },
  { key: 'name', label: 'By name (A–Z)', compare: byName },
];

const SELECT = 'rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function MedicationsPage() {
  const { profile, access, canEdit, careName } = useProfile();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<MedicationRecord | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [confirmBulkLog, setConfirmBulkLog] = useState(false);
  // The daily action happens at the record below, so the management list starts
  // collapsed and can be expanded to add, edit or organise medications.
  const [listOpen, setListOpen] = useState(false);

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
              templateHeaders={['Name', 'Dose', 'Form', 'Route', 'Frequency', 'Times', 'Instructions', 'Supply', 'Active']}
              templateSample={['Metformin', '500 mg', 'Tablet', 'Oral', 'Twice daily', '08:00; 20:00', 'With food', '30000', 'true']}
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
                  <th className="px-4 py-3 font-medium">Dose</th>
                  <th className="px-4 py-3 font-medium">Route</th>
                  <th className="px-4 py-3 font-medium">Schedule</th>
                  <th className="px-4 py-3 font-medium">Supply left</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dv.view.length === 0 ? (
                  <tr><td colSpan={canSelect ? 7 : 6} className="px-4 py-8 text-center text-muted">{meds.length === 0 ? 'No medications recorded yet.' : 'No medications match your search or filters.'}</td></tr>
                ) : dv.view.map((m) => {
                  const unit = doseUnit(m.dose);
                  const remaining = m.supply_remaining;
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
                      {m.instructions ? <div className="text-xs text-muted">{m.instructions}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-muted">{m.dose || '—'}</td>
                    <td className="px-4 py-3 text-muted">{m.route || '—'}</td>
                    <td className="px-4 py-3 text-muted">
                      {m.frequency ? <div>{m.frequency}</div> : null}
                      {m.schedule_times?.length ? <div className="text-xs">{m.schedule_times.join(', ')}</div> : <div className="text-xs">As needed</div>}
                    </td>
                    <td className="px-4 py-3">
                      {remaining == null ? (
                        <span className="text-muted">—</span>
                      ) : remaining <= 0 ? (
                        <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">Out of stock</span>
                      ) : (
                        <span className={`text-ink ${m.supply != null && remaining <= m.supply * 0.15 ? 'text-amber-700 dark:text-amber-300 font-medium' : ''}`}>
                          {fmtNum(remaining)}{unit ? ` ${unit}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {canManageMeds ? <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>Edit</Button> : null}
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
        <h3 className="text-base font-semibold text-ink">Medication Administration Record</h3>
        <p className="text-sm text-muted">Log each dose against {careName} and review the history. Doses colour instantly as you record them.</p>
      </div>
      <MedicationMar profileId={profile.id} personName={profile.full_name} canAdminister={canEdit} />

      {addOpen ? <MedicationForm profileId={profile.id} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); invalidate(); }} /> : null}
      {editing ? <MedicationForm profileId={profile.id} med={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} /> : null}

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

function MedicationForm({ profileId, med, onClose, onSaved }: { profileId: string; med?: MedicationRecord; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(med?.name ?? '');
  const [dose, setDose] = useState(med?.dose ?? '');
  const [route, setRoute] = useState(med?.route ?? '');
  const [frequency, setFrequency] = useState(med?.frequency ?? '');
  const [times, setTimes] = useState((med?.schedule_times ?? []).join(', '));
  const [supply, setSupply] = useState(med?.supply != null ? String(med.supply) : '');
  const [instructions, setInstructions] = useState(med?.instructions ?? '');
  const [active, setActive] = useState(med?.active ?? true);
  const [error, setError] = useState('');

  // Shared catalogue drives the name autocomplete, so the same drug is reused
  // across people instead of being re-typed as a duplicate.
  const { data: catalogue } = useQuery({
    queryKey: ['medication-catalogue'],
    queryFn: () => api.get<{ items: { id: string; name: string; form: string | null }[] }>('/medication-catalogue'),
  });
  const suggestions = catalogue?.items ?? [];

  const mutation = useMutation({
    mutationFn: () => {
      const schedule_times = times.split(',').map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t)).map((t) => t.padStart(5, '0'));
      const supplyNum = supply.trim() === '' ? null : Number(supply);
      const body = { name: name.trim(), dose: dose || null, route: route || null, frequency: frequency || null, schedule_times, supply: supplyNum, instructions: instructions || null, active };
      return med ? api.patch(`/care-profiles/${profileId}/medications/${med.id}`, body) : api.post(`/care-profiles/${profileId}/medications`, body);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  return (
    <Modal open onClose={onClose} title={med ? 'Edit medication' : 'Add medication'}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) mutation.mutate(); }}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Metformin" list="med-catalogue-options" hint="Pick an existing medication to reuse it, or type a new one." />
        <datalist id="med-catalogue-options">
          {suggestions.map((s) => <option key={s.id} value={s.name} />)}
        </datalist>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Dose" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 500 mg" />
          <Input label="Route" value={route} onChange={(e) => setRoute(e.target.value)} placeholder="e.g. Oral" />
        </div>
        <Input label="Frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="e.g. Twice daily with food" />
        <Input label="Scheduled times (HH:MM, comma separated)" value={times} onChange={(e) => setTimes(e.target.value)} placeholder="08:00, 20:00" hint="Leave blank for a medication taken only as needed." />
        <Input label={`Supply${dose ? ` (${doseUnit(dose) || 'total on hand'})` : ''}`} type="number" min="0" step="any" value={supply} onChange={(e) => setSupply(e.target.value)} placeholder="e.g. 30000" hint="Total amount on hand, in the same unit as the dose. This counts down by the dose each time a dose is given." />
        <Textarea label="Instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} />
        {med ? (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus:ring-primary" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (uncheck to stop and keep the history)
          </label>
        ) : null}
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

