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
import { MED_RIGHTS, MED_STATUSES, type MedicationRecord, type MedicationAdministration } from '../../../lib/care';

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
  const [logging, setLogging] = useState<MedicationRecord | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const { data } = useQuery({
    queryKey: ['medications', profile.id],
    queryFn: () => api.get<{ medications: MedicationRecord[] }>(`/care-profiles/${profile.id}/medications`),
  });
  const meds = data?.medications ?? [];
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['medications', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['mar', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['calendar-events', profile.id] });
  };

  // Managing the medication list (add/edit/delete/import, incl. bulk) is
  // limited to the owner and platform admins/super admins. Contributors are
  // read-only for the list but can still record administrations.
  const canManageMeds = access === 'owner' || access === 'admin';
  const canBulkDelete = canManageMeds;

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
    searchText: (m) => [m.name, m.dose, m.route, m.frequency, m.prescriber].filter(Boolean).join(' '),
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

  const bulkActions: ToolbarBulkAction[] = canBulkDelete
    ? [{ key: 'delete', label: 'Delete selected', destructive: true, onRun: () => setConfirmBulk(true) }]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Medications</h2>
          <p className="text-sm text-muted">
            {careName}'s medications and a full administration record built on the six rights of medication administration.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <ImportExport
            basePath={`/care-profiles/${profile.id}/medications`}
            resource="medications"
            canImport={canManageMeds}
            onImported={invalidate}
            templateHeaders={['Name', 'Dose', 'Form', 'Route', 'Frequency', 'Times', 'Instructions', 'Prescriber', 'Active']}
            templateSample={['Metformin', '500 mg', 'Tablet', 'Oral', 'Twice daily', '08:00; 20:00', 'With food', 'Dr Wright', 'true']}
          />
          {canManageMeds ? <Button onClick={() => setAddOpen(true)}>Add medication</Button> : null}
        </div>
      </div>

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
              {canBulkDelete ? (
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" aria-label="Select all" className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    checked={dv.allSelected} onChange={dv.toggleAll} />
                </th>
              ) : null}
              <th className="px-4 py-3 font-medium">Medication</th>
              <th className="px-4 py-3 font-medium">Dose</th>
              <th className="px-4 py-3 font-medium">Route</th>
              <th className="px-4 py-3 font-medium">Schedule</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {dv.view.length === 0 ? (
              <tr><td colSpan={canBulkDelete ? 6 : 5} className="px-4 py-8 text-center text-muted">{meds.length === 0 ? 'No medications recorded yet.' : 'No medications match your search or filters.'}</td></tr>
            ) : dv.view.map((m) => (
              <tr key={m.id} className={`border-b border-border last:border-0 ${m.active ? '' : 'opacity-60'}`}>
                {canBulkDelete ? (
                  <td className="px-4 py-3">
                    <input type="checkbox" aria-label={`Select ${m.name}`} className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      checked={dv.selected.has(m.id)} onChange={() => dv.toggle(m.id)} />
                  </td>
                ) : null}
                <td className="px-4 py-3">
                  <div data-testid="med-name" className="font-medium text-ink">{m.name}{m.active ? '' : ' (inactive)'}</div>
                  {m.prescriber ? <div className="text-xs text-muted">Prescriber: {m.prescriber}</div> : null}
                  {m.instructions ? <div className="text-xs text-muted">{m.instructions}</div> : null}
                </td>
                <td className="px-4 py-3 text-muted">{m.dose || '—'}</td>
                <td className="px-4 py-3 text-muted">{m.route || '—'}</td>
                <td className="px-4 py-3 text-muted">
                  {m.frequency ? <div>{m.frequency}</div> : null}
                  {m.schedule_times?.length ? <div className="text-xs">{m.schedule_times.join(', ')}</div> : null}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                  {canEdit && m.active ? <Button size="sm" onClick={() => setLogging(m)}>Record dose</Button> : null}
                  {canManageMeds ? <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>Edit</Button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MarTable profileId={profile.id} />

      {addOpen ? <MedicationForm profileId={profile.id} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); invalidate(); }} /> : null}
      {editing ? <MedicationForm profileId={profile.id} med={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} /> : null}
      {logging ? <AdministerModal profileId={profile.id} med={logging} personName={profile.full_name} onClose={() => setLogging(null)} onSaved={() => { setLogging(null); invalidate(); }} /> : null}

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
    </div>
  );
}

function MedicationForm({ profileId, med, onClose, onSaved }: { profileId: string; med?: MedicationRecord; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(med?.name ?? '');
  const [dose, setDose] = useState(med?.dose ?? '');
  const [route, setRoute] = useState(med?.route ?? '');
  const [frequency, setFrequency] = useState(med?.frequency ?? '');
  const [times, setTimes] = useState((med?.schedule_times ?? []).join(', '));
  const [prescriber, setPrescriber] = useState(med?.prescriber ?? '');
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
      const body = { name: name.trim(), dose: dose || null, route: route || null, frequency: frequency || null, schedule_times, prescriber: prescriber || null, instructions: instructions || null, active };
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
        <Input label="Scheduled times (HH:MM, comma separated)" value={times} onChange={(e) => setTimes(e.target.value)} placeholder="08:00, 20:00" hint="These appear on the calendar." />
        <Input label="Prescriber" value={prescriber} onChange={(e) => setPrescriber(e.target.value)} />
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

function AdministerModal({ profileId, med, personName, onClose, onSaved }: { profileId: string; med: MedicationRecord; personName: string; onClose: () => void; onSaved: () => void }) {
  const [when, setWhen] = useState(localNow());
  const [status, setStatus] = useState('given');
  const [doseGiven, setDoseGiven] = useState(med.dose ?? '');
  const [routeGiven, setRouteGiven] = useState(med.route ?? '');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const notesRequired = !NOTE_OPTIONAL_OUTCOMES.has(status);

  const mutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/medications/${med.id}/administrations`, {
      administered_at: new Date(when).toISOString(),
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
    if (notesRequired && !notes.trim()) {
      setError(`A note is required when the outcome is "${MED_STATUSES.find((s) => s.value === status)?.label}".`);
      return;
    }
    setError('');
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Record administration">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {/* MAR header: the person (right person = their name) and the date. */}
        <div className="border-b border-border pb-3">
          <p className="text-xs uppercase tracking-wide text-muted">MAR · {personName} · {format(new Date(when), 'd MMM yyyy')}</p>
          <p className="text-base font-semibold text-ink">{med.name}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Dose" value={doseGiven} onChange={(e) => setDoseGiven(e.target.value)} placeholder="e.g. 500 mg" />
          <Input label="Given by (route)" value={routeGiven} onChange={(e) => setRouteGiven(e.target.value)} placeholder="e.g. Oral" />
        </div>

        <div>
          <label htmlFor="admin-when" className="block text-sm font-medium text-ink mb-1">Time</label>
          <input id="admin-when" type="datetime-local" className={`${SELECT} w-full`} value={when} onChange={(e) => setWhen(e.target.value)} required />
        </div>

        <div>
          <label htmlFor="admin-status" className="block text-sm font-medium text-ink mb-1">Outcome</label>
          <select id="admin-status" className={`${SELECT} w-full`} value={status} onChange={(e) => setStatus(e.target.value)}>
            {MED_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
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
          <Button type="submit" loading={mutation.isPending}>Record administration</Button>
        </div>
      </form>
    </Modal>
  );
}

function statusBadge(status: string) {
  const map: Record<string, string> = { given: 'bg-primary-50 text-primary', self_administered: 'bg-primary-50 text-primary', refused: 'bg-amber-50 text-amber-700', omitted: 'bg-amber-50 text-amber-700', held: 'bg-surface-2 text-muted' };
  return map[status] ?? 'bg-surface-2 text-muted';
}

function MarTable({ profileId }: { profileId: string }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('recent');

  const { data } = useQuery({
    queryKey: ['mar', profileId, search, status, sort],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (status) qs.set('status', status);
      qs.set('sort', sort);
      return api.get<{ administrations: MedicationAdministration[] }>(`/care-profiles/${profileId}/medications/administrations?${qs}`);
    },
  });
  const records = data?.administrations ?? [];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-ink">Administration record (MAR)</h3>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[12rem]">
          <Input aria-label="Search the record" placeholder="Search medication, notes or person…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className={SELECT} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by outcome">
          <option value="">All outcomes</option>
          {MED_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select className={SELECT} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="recent">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="medication">By medication</option>
          <option value="administrator">By person</option>
        </select>
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Medication</th>
              <th className="px-4 py-3 font-medium">Dose</th>
              <th className="px-4 py-3 font-medium">Route</th>
              <th className="px-4 py-3 font-medium">By</th>
              <th className="px-4 py-3 font-medium">Outcome</th>
              <th className="px-4 py-3 font-medium">Rights</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">No administrations recorded yet.</td></tr>
            ) : records.map((a) => {
              const confirmed = MED_RIGHTS.filter((r) => a[r.key as keyof MedicationAdministration]).length;
              return (
                <tr key={a.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-3 whitespace-nowrap text-muted">{format(new Date(a.administered_at), 'd MMM yyyy, HH:mm')}</td>
                  <td className="px-4 py-3">
                    <div className="text-ink">{a.medication_name}</div>
                    {a.notes ? <div className="text-xs text-muted">{a.notes}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-muted">{a.dose_given || '—'}</td>
                  <td className="px-4 py-3 text-muted">{a.route_given || '—'}</td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{a.administered_by_name ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`badge text-xs ${statusBadge(a.status)}`}>{MED_STATUSES.find((s) => s.value === a.status)?.label ?? a.status}</span></td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${confirmed === 6 ? 'text-primary' : 'text-amber-700'}`} title={MED_RIGHTS.map((r) => `${r.label}: ${a[r.key as keyof MedicationAdministration] ? '✓' : '✗'}`).join('\n')}>
                      {confirmed}/6 {confirmed === 6 ? '✓' : ''}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
