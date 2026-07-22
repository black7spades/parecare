import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useDataView, type DataFilter, type DataSort } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import { useProfile } from './ProfileLayout';
import { useHealthConfig } from '../../../lib/appConfig';

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export interface Appointment {
  id: string;
  title: string;
  appointment_type: string;
  provider_id: string | null;
  provider_name: string | null;
  provider_organisation: string | null;
  provider_address: string | null;
  provider_directions_link: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  notes: string | null;
  /** The estimate given at booking, if any (kept out of spend totals). */
  cost_estimate: number | null;
  /** The confirmed actual cost, if logged (counts as spend). */
  cost_actual: number | null;
}

const APPOINTMENT_TYPES = [
  { value: 'consultation', label: 'Consultation' },
  { value: 'test', label: 'Test' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'therapy', label: 'Therapy session' },
  { value: 'review', label: 'Review' },
  { value: 'vaccination', label: 'Vaccination' },
  { value: 'other', label: 'Other' },
] as const;

const APPOINTMENT_STATUSES = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'missed', label: 'Missed' },
] as const;

const typeLabel = (v: string) => APPOINTMENT_TYPES.find((t) => t.value === v)?.label ?? v;
const statusLabel = (v: string) => APPOINTMENT_STATUSES.find((s) => s.value === v)?.label ?? v;

const SORTS: DataSort<Appointment>[] = [
  {
    key: 'upcoming',
    label: 'Soonest first',
    compare: (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  },
  {
    key: 'newest',
    label: 'Latest first',
    compare: (a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime(),
  },
  { key: 'title', label: 'Title', compare: (a, b) => a.title.localeCompare(b.title) },
];

const STATUS_FILTER: DataFilter<Appointment> = {
  key: 'status',
  label: 'Status',
  options: APPOINTMENT_STATUSES.map((s) => ({ value: s.value, label: s.label })),
  match: (a, v) => a.status === v,
};

const TYPE_FILTER: DataFilter<Appointment> = {
  key: 'appointment_type',
  label: 'Kind',
  options: APPOINTMENT_TYPES.map((t) => ({ value: t.value, label: t.label })),
  match: (a, v) => a.appointment_type === v,
};

export function AppointmentsPage() {
  const { profile, careName, canEdit } = useProfile();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [initialProviderId, setInitialProviderId] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // A health alert's "Book appointment" arrives here with ?new=1 and the
  // GP preselected, so booking is one step, not a hunt through the form.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setInitialProviderId(searchParams.get('provider') ?? '');
      setAdding(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Appointment | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkEditQueue, setBulkEditQueue] = useState<Appointment[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', profile.id],
    queryFn: () => api.get<{ appointments: Appointment[] }>(`/care-profiles/${profile.id}/appointments`),
  });
  const appointments = data?.appointments ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['appointments', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['calendar', profile.id] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/appointments/${id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      invalidate();
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (payload: { action: 'complete' | 'cancel' | 'delete'; ids: string[] }) =>
      api.post(`/care-profiles/${profile.id}/appointments/bulk`, payload),
    onSuccess: () => {
      setConfirmBulkDelete(false);
      dv.clearSelection();
      invalidate();
    },
  });

  const dv = useDataView<Appointment>({
    rows: appointments,
    getId: (a) => a.id,
    searchText: (a) =>
      [a.title, typeLabel(a.appointment_type), a.provider_name, a.location, statusLabel(a.status)]
        .filter(Boolean)
        .join(' '),
    sorts: SORTS,
    filters: [STATUS_FILTER, TYPE_FILTER],
    defaultPageSize: 25,
  });

  const bulkActions: ToolbarBulkAction[] = canEdit
    ? [
        {
          key: 'edit',
          label: 'Edit selected',
          onRun: () => {
            const queue = appointments.filter((a) => dv.selected.has(a.id));
            if (queue.length === 0) return;
            setBulkEditQueue(queue.slice(1));
            setEditing(queue[0]);
          },
        },
        {
          key: 'complete',
          label: 'Complete selected',
          onRun: () => bulkMutation.mutate({ action: 'complete', ids: [...dv.selected] }),
        },
        {
          key: 'cancel',
          label: 'Cancel selected',
          onRun: () => bulkMutation.mutate({ action: 'cancel', ids: [...dv.selected] }),
        },
        { key: 'delete', label: 'Delete selected', destructive: true, onRun: () => setConfirmBulkDelete(true) },
      ]
    : [];

  const advanceQueue = () => {
    if (bulkEditQueue.length > 0) {
      setEditing(bulkEditQueue[0]);
      setBulkEditQueue(bulkEditQueue.slice(1));
    } else {
      setEditing(null);
      dv.clearSelection();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-ink">Appointments</h2>
          <p className="text-sm text-muted">
            Everything booked for {careName}. Each appointment shows on the Calendar and in the upcoming
            events on the Overview.
          </p>
        </div>
        {canEdit ? <Button size="sm" onClick={() => setAdding(true)}>Add appointment</Button> : null}
      </div>

      <DataToolbar
        search={dv.search}
        onSearch={dv.setSearch}
        searchPlaceholder="Search appointments..."
        sorts={SORTS.map((s) => ({ key: s.key, label: s.label }))}
        sortKey={dv.sortKey}
        onSort={dv.setSortKey}
        filters={[STATUS_FILTER, TYPE_FILTER].map((f) => ({ key: f.key, label: f.label, options: f.options }))}
        filterValues={dv.filterValues}
        onFilter={dv.setFilter}
        selectedCount={dv.selected.size}
        bulkActions={bulkActions}
        onClearSelection={dv.clearSelection}
        page={dv.page}
        totalPages={dv.totalPages}
        pageSize={dv.pageSize}
        totalFiltered={dv.totalFiltered}
        onPageChange={dv.setPage}
        onPageSizeChange={dv.setPageSize}
      />

      {isLoading ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : dv.view.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">
            {appointments.length === 0
              ? `No appointments recorded for ${careName} yet.`
              : 'No appointments match your search or filters.'}
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                {canEdit ? <th className="px-3 py-2 w-8" /> : null}
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Appointment</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2 hidden md:table-cell">Provider</th>
                <th className="px-3 py-2 hidden lg:table-cell">Location</th>
                <th className="px-3 py-2">Status</th>
                {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {dv.view.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0 align-top">
                  {canEdit ? (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${a.title}`}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={dv.selected.has(a.id)}
                        onChange={() => dv.toggle(a.id)}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-ink whitespace-nowrap">
                    {format(new Date(a.starts_at), 'EEE d MMM yyyy, HH:mm')}
                  </td>
                  <td className="px-3 py-2 font-medium text-ink">{a.title}</td>
                  <td className="px-3 py-2 text-ink">{typeLabel(a.appointment_type)}</td>
                  <td className="px-3 py-2 text-ink hidden md:table-cell">{a.provider_name ?? ''}</td>
                  <td className="px-3 py-2 text-muted hidden lg:table-cell">{a.location ?? ''}</td>
                  <td className="px-3 py-2 text-ink">{statusLabel(a.status)}</td>
                  {canEdit ? (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button size="xs" variant="ghost" className="mr-1" onClick={() => setEditing(a)}>
                        Edit
                      </Button>
                      <Button size="xs" variant="ghost-danger" onClick={() => setConfirmDelete(a)}>
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

      {adding || editing ? (
        <AppointmentEditor
          profileId={profile.id}
          appointment={editing}
          initialProviderId={editing ? '' : initialProviderId}
          onClose={() => {
            setAdding(false);
            setEditing(null);
            setInitialProviderId('');
            setBulkEditQueue([]);
          }}
          onSaved={() => {
            setAdding(false);
            setInitialProviderId('');
            invalidate();
            if (editing) advanceQueue();
          }}
        />
      ) : null}

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete appointment">
        <p className="text-sm text-muted mb-4">
          Delete <span className="font-medium text-ink">{confirmDelete?.title}</span>? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button
            variant="danger"
            loading={deleteMutation.isPending}
            onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
          >
            Delete
          </Button>
        </div>
      </Modal>

      <Modal open={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)} title="Delete appointments">
        <p className="text-sm text-muted mb-4">
          Delete {dv.selected.size} {dv.selected.size === 1 ? 'appointment' : 'appointments'}? This cannot be
          undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmBulkDelete(false)}>Cancel</Button>
          <Button
            variant="danger"
            loading={bulkMutation.isPending}
            onClick={() => bulkMutation.mutate({ action: 'delete', ids: [...dv.selected] })}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

interface ProviderFull {
  id: string;
  name: string;
  provider_type: string;
  organisation: string | null;
  address: string | null;
  directions_link: string | null;
  phone: string | null;
  email: string | null;
}

function AppointmentEditor({
  profileId,
  appointment,
  initialProviderId = '',
  onClose,
  onSaved,
}: {
  profileId: string;
  appointment: Appointment | null;
  /** Preselects a provider on a new appointment, e.g. the GP from a health alert. */
  initialProviderId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const isNew = appointment === null;
  const [title, setTitle] = useState(appointment?.title ?? '');
  const [type, setType] = useState(appointment?.appointment_type ?? 'consultation');
  const [providerId, setProviderId] = useState(appointment?.provider_id ?? initialProviderId);
  const [providerName, setProviderName] = useState('');
  const [location, setLocation] = useState(appointment?.location ?? '');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('');
  const [status, setStatus] = useState(appointment?.status ?? 'scheduled');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [costEstimate, setCostEstimate] = useState(appointment?.cost_estimate != null ? String(appointment.cost_estimate) : '');
  const [costActual, setCostActual] = useState(appointment?.cost_actual != null ? String(appointment.cost_actual) : '');
  const [error, setError] = useState('');
  const [showSaveProvider, setShowSaveProvider] = useState(false);
  const health = useHealthConfig();

  useEffect(() => {
    if (appointment) {
      setTitle(appointment.title);
      setType(appointment.appointment_type);
      setProviderId(appointment.provider_id ?? '');
      setLocation(appointment.location ?? '');
      const d = new Date(appointment.starts_at);
      const pad = (n: number) => String(n).padStart(2, '0');
      setStartDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      setStartTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
      if (appointment.ends_at) {
        const e = new Date(appointment.ends_at);
        setEndTime(`${pad(e.getHours())}:${pad(e.getMinutes())}`);
      } else {
        setEndTime('');
      }
      setStatus(appointment.status);
      setNotes(appointment.notes ?? '');
      setCostEstimate(appointment.cost_estimate != null ? String(appointment.cost_estimate) : '');
      setCostActual(appointment.cost_actual != null ? String(appointment.cost_actual) : '');
    }
  }, [appointment]);

  const { data: providersData } = useQuery({
    queryKey: ['providers', profileId],
    queryFn: () => api.get<{ providers: ProviderFull[] }>(`/care-profiles/${profileId}/providers`),
  });
  const providers = providersData?.providers ?? [];

  const handleProviderChange = (newProviderId: string) => {
    setProviderId(newProviderId);
    setShowSaveProvider(false);
    if (newProviderId) {
      const provider = providers.find((p) => p.id === newProviderId);
      if (provider) {
        if (provider.directions_link) {
          setLocation(provider.directions_link);
        } else if (provider.address) {
          setLocation(provider.address);
        }
      }
    }
  };

  const handleProviderNameBlur = () => {
    if (providerName.trim() && !providerId) {
      const match = providers.find((p) => p.name.toLowerCase() === providerName.trim().toLowerCase());
      if (match) {
        handleProviderChange(match.id);
      } else {
        setShowSaveProvider(true);
      }
    }
  };

  const saveProviderMutation = useMutation({
    mutationFn: () =>
      api.post<{ provider: ProviderFull }>(`/care-profiles/${profileId}/providers`, {
        name: providerName.trim(),
        provider_type: 'other',
        address: location.trim() || null,
      }),
    onSuccess: (res) => {
      setProviderId(res.provider.id);
      setShowSaveProvider(false);
      setProviderName('');
      void queryClient.invalidateQueries({ queryKey: ['providers', profileId] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const startsAt = new Date(`${startDate}T${startTime}`).toISOString();
      const endsAt = endTime ? new Date(`${startDate}T${endTime}`).toISOString() : null;
      const body = {
        title: title.trim(),
        appointment_type: type,
        provider_id: providerId || null,
        location: location.trim() || null,
        starts_at: startsAt,
        ends_at: endsAt,
        status,
        notes: notes.trim() || null,
        cost_estimate: costEstimate.trim() === '' ? null : Number(costEstimate),
        cost_actual: costActual.trim() === '' ? null : Number(costActual),
      };
      return isNew
        ? api.post(`/care-profiles/${profileId}/appointments`, body)
        : api.patch(`/care-profiles/${profileId}/appointments/${appointment.id}`, body);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the appointment.'),
  });

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add appointment' : `Edit ${appointment.title}`} wide>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            label="What for"
            placeholder="e.g. Cardiology check-up"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Kind</span>
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <div>
            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1">Provider</span>
              <select className={inputClass} value={providerId} onChange={(e) => handleProviderChange(e.target.value)}>
                <option value="">No provider linked</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            {!providerId && providers.length > 0 ? (
              <div className="mt-1">
                <input
                  type="text"
                  className={inputClass}
                  placeholder="Or type a new provider name"
                  value={providerName}
                  onChange={(e) => { setProviderName(e.target.value); setShowSaveProvider(false); }}
                  onBlur={handleProviderNameBlur}
                />
                {showSaveProvider && providerName.trim() ? (
                  <div className="mt-1">
                    <Button
                      size="xs"
                      variant="secondary"
                      loading={saveProviderMutation.isPending}
                      onClick={() => saveProviderMutation.mutate()}
                    >
                      Save "{providerName.trim()}" to Providers
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <Input
            label="Location"
            placeholder="e.g. Suite 4, 12 High St or a map link"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            hint={providerId ? 'Auto-filled from provider. Edit if different.' : undefined}
          />
          <Input
            label="Start date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Input
            label="Start time"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <Input
            label="End time"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            hint="On the same day. Leave blank if unknown."
          />
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Status</span>
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            label={`Estimated cost (${health.currency_symbol})`}
            type="number"
            min="0"
            step="any"
            value={costEstimate}
            onChange={(e) => setCostEstimate(e.target.value)}
            hint="What you expect it to cost. Kept as an estimate until confirmed."
          />
          <Input
            label={`Actual cost (${health.currency_symbol})`}
            type="number"
            min="0"
            step="any"
            value={costActual}
            onChange={(e) => setCostActual(e.target.value)}
            hint="What it actually cost. Counts as health spend once entered."
          />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={saveMutation.isPending}
            disabled={!title.trim() || !startDate}
            onClick={() => saveMutation.mutate()}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
