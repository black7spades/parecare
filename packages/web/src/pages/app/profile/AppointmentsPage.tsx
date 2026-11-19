import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { EditableSubheader } from '../../../components/ui/EditableSubheader';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useDataView, type DataFilter, type DataSort } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import { SortableTh } from '../../../components/data/SortableTh';
import { OutcomeModal } from '../../../components/OutcomeModal';
import { ForwardNotesModal, ForwardedText, type SentForward, pickedItems } from '../../../components/ForwardNotes';
import type { NextStep } from '../../../lib/nextSteps';
import { MedicationForm } from './medications/MedicationForm';
import { UploadDocumentModal } from './DocumentsPage';
import { SELF_RELATIONSHIP, type CircleMember } from '../../../lib/care';
import { RecordPanel } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { useProfile } from './ProfileLayout';
import { useHealthConfig } from '../../../lib/appConfig';

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export interface Appointment {
  id: string;
  title: string;
  appointment_type: string;
  provider_id: string | null;
  medical_condition_id: string | null;
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
  /** How it went, in a few words, once recorded. */
  outcome?: string | null;
  /** What it set off: referrals, tests, scripts and so on, each a task. */
  next_steps?: NextStep[];
  /** What it passed on to other appointments, so the source shows where each piece went. */
  forwarded?: SentForward[];
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

const openSteps = (a: Appointment) => (a.next_steps ?? []).filter((s) => !s.completed).length;
const byText = (x: string | null | undefined, y: string | null | undefined) => (x ?? '').localeCompare(y ?? '');

const SORTS: DataSort<Appointment>[] = [
  { key: 'when', label: 'By date', defaultDir: 'desc', compare: (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime() },
  { key: 'title', label: 'By appointment', compare: (a, b) => a.title.localeCompare(b.title) },
  { key: 'kind', label: 'By kind', compare: (a, b) => typeLabel(a.appointment_type).localeCompare(typeLabel(b.appointment_type)) },
  { key: 'with', label: 'By who with', compare: (a, b) => byText(a.provider_name, b.provider_name) },
  { key: 'location', label: 'By location', compare: (a, b) => byText(a.location, b.location) },
  { key: 'status', label: 'By status', compare: (a, b) => statusLabel(a.status).localeCompare(statusLabel(b.status)) },
  { key: 'outcome', label: 'By outcome', compare: (a, b) => byText(a.outcome, b.outcome) },
  { key: 'steps', label: 'By open next steps', defaultDir: 'desc', compare: (a, b) => openSteps(a) - openSteps(b) },
];

/** Finished, so it is time to ask how it went. */
const isPast = (a: Appointment) => new Date(a.ends_at ?? a.starts_at).getTime() < Date.now();

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
  const { profile, careName, canEdit, isOwner, relationship } = useProfile();
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
  // How it went: opened from the row, from the bell, or from a task.
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  // Booking the appointment a next step calls for.
  const [booking, setBooking] = useState<{ step: NextStep; from: Appointment } | null>(null);
  // Adding a prescribed medication, or uploading a document, a next step names.
  const [addingMed, setAddingMed] = useState<{ step: NextStep; from: Appointment } | null>(null);
  const [uploadingFor, setUploadingFor] = useState<{ step: NextStep; from: Appointment } | null>(null);
  // Forwarding notes, from the record's Forward notes or one note's Forward.
  const [forwarding, setForwarding] = useState<{ sourceId: string; noteId: string | null } | null>(null);
  // Forwarding to a new appointment: book it, then the notes go to it.
  const [forwardingNew, setForwardingNew] = useState<{ sourceId: string; items: ReturnType<typeof pickedItems> } | null>(null);
  const [forwardError, setForwardError] = useState('');

  const { data: conditionData } = useQuery({
    queryKey: ['conditions', profile.id],
    queryFn: () => api.get<{ conditions: { id: string; name: string }[] }>(`/care-profiles/${profile.id}/conditions`),
  });
  const conditionName = (id: string | null) => (conditionData?.conditions ?? []).find((c) => c.id === id)?.name ?? '';
  const { data: circleData } = useQuery({
    queryKey: ['circle', profile.id],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profile.id}/circle`),
  });

  // The thing a next step asked for is done, so tick the step off.
  const finishStep = useMutation({
    mutationFn: (stepId: string) => api.patch(`/care-profiles/${profile.id}/reminders/${stepId}`, { completed: true }),
    onSettled: () => invalidate(),
  });
  const [bulkEditQueue, setBulkEditQueue] = useState<Appointment[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', profile.id],
    queryFn: () => api.get<{ appointments: Appointment[] }>(`/care-profiles/${profile.id}/appointments`),
  });
  const appointments = data?.appointments ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['appointments', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['calendar', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['tasks', profile.id] });
  };

  // ?outcome=<id> arrives from the bell or a task and opens how it went.
  useEffect(() => {
    const id = searchParams.get('outcome');
    if (id) {
      setOutcomeFor(id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('outcome');
          return next;
        },
        { replace: true }
      );
    }
  }, [searchParams, setSearchParams]);
  const outcomeAppointment = outcomeFor ? appointments.find((a) => a.id === outcomeFor) ?? null : null;

  // Deleting is held back a few seconds with Undo, never a "sure?" box.
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const hidden = useHiddenIds();
  const deleteAppointments = (items: Appointment[]) => {
    if (items.length === 0) return;
    deferDelete({
      message: items.length === 1 ? `Deleted ${items[0].title}.` : `Deleted ${items.length} appointments.`,
      ids: items.map((a) => a.id),
      commit: () =>
        items.length === 1
          ? api.delete(`/care-profiles/${profile.id}/appointments/${items[0].id}`)
          : api.post(`/care-profiles/${profile.id}/appointments/bulk`, { action: 'delete', ids: items.map((a) => a.id) }),
      onCommitted: invalidate,
    });
  };

  const markAttended = useMutation({
    mutationFn: (a: Appointment) => api.patch(`/care-profiles/${profile.id}/appointments/${a.id}`, { status: 'completed' }),
    onSuccess: invalidate,
  });

  const bulkMutation = useMutation({
    mutationFn: (payload: { action: 'complete' | 'cancel' | 'delete'; ids: string[] }) =>
      api.post(`/care-profiles/${profile.id}/appointments/bulk`, payload),
    onSuccess: () => {
      dv.clearSelection();
      invalidate();
    },
  });

  const visible = appointments.filter((a) => !hidden.has(a.id));
  const panel = useRecordPanel(visible, (a) => a.id);
  const dv = useDataView<Appointment>({
    rows: visible,
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
        {
          key: 'delete',
          label: 'Delete selected',
          destructive: true,
          onRun: () => {
            deleteAppointments(appointments.filter((a) => dv.selected.has(a.id)));
            dv.clearSelection();
          },
        },
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
          <EditableSubheader copyKey="profile.appointments.subheader" vars={{ name: careName }} />
        </div>
        {canEdit ? <Button size="sm" onClick={() => setAdding(true)}>Add appointment</Button> : null}
      </div>

      {forwardError ? (
        <div className="card flex items-start gap-3 border-red-200">
          <p className="flex-1 text-sm text-red-600">{forwardError}</p>
          <Button size="xs" variant="ghost" onClick={() => setForwardError('')}>Dismiss</Button>
        </div>
      ) : null}

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
                <SortableTh label="When" sortKey="when" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Appointment" sortKey="title" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Kind" sortKey="kind" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="hidden xl:table-cell" />
                <SortableTh label="With" sortKey="with" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="hidden lg:table-cell" />
                <SortableTh label="Location" sortKey="location" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="hidden 2xl:table-cell" />
                <SortableTh label="Status" sortKey="status" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Outcome" sortKey="outcome" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Next steps open" sortKey="steps" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {dv.view.map((a) => (
                <tr key={a.id} {...panel.rowProps(a.id)} className={`border-b border-border last:border-0 align-top ${RECORD_ROW_CLASS}`}>
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
                  <td className="px-3 py-2 text-ink hidden xl:table-cell">{typeLabel(a.appointment_type)}</td>
                  <td className="px-3 py-2 text-ink hidden lg:table-cell">{a.provider_name ?? ''}</td>
                  <td className="px-3 py-2 text-muted hidden 2xl:table-cell">{a.location ?? ''}</td>
                  <td className="px-3 py-2 text-ink">{statusLabel(a.status)}</td>
                  <td className="px-3 py-2 text-ink max-w-xs">
                    {a.outcome ? (
                      <span className="line-clamp-2 break-words">{a.outcome}</span>
                    ) : canEdit && isPast(a) && a.status !== 'cancelled' && a.status !== 'missed' ? (
                      <Button size="xs" variant="secondary" className="whitespace-nowrap" onClick={() => setOutcomeFor(a.id)}>How did it go?</Button>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-ink whitespace-nowrap">
                    {(a.next_steps ?? []).length === 0
                      ? ''
                      : openSteps(a) === 0
                        ? 'All done'
                        : openSteps(a)}
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {a.outcome || (a.next_steps ?? []).length > 0 ? (
                        <Button size="xs" variant="ghost" className="mr-1" aria-label={`Outcome of ${a.title}`} onClick={() => setOutcomeFor(a.id)}>Outcome</Button>
                      ) : null}
                      <Button size="xs" variant="ghost" className="mr-1" aria-label={`Edit ${a.title}`} title="Edit" onClick={() => setEditing(a)}>
                        <PencilIcon />
                      </Button>
                      <Button size="xs" variant="ghost-danger" aria-label={`Delete ${a.title}`} title="Delete" onClick={() => deleteAppointments([a])}>
                        <TrashIcon />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {panel.current ? (
        <RecordPanel
          key={panel.current.id}
          kindLabel="Appointment"
          title={panel.current.title}
          subtitle={format(new Date(panel.current.starts_at), 'EEEE d MMMM yyyy, HH:mm')}
          kind="appointments"
          recordId={panel.current.id}
          profileId={profile.id}
          canEdit={canEdit}
          fields={[
            { label: 'When', value: format(new Date(panel.current.starts_at), 'EEE d MMM yyyy, HH:mm') },
            { label: 'Ends', value: panel.current.ends_at ? format(new Date(panel.current.ends_at), 'HH:mm') : null },
            { label: 'Kind', value: typeLabel(panel.current.appointment_type) },
            { label: 'With', value: panel.current.provider_name },
            { label: 'Practice', value: panel.current.provider_organisation },
            { label: 'Location', value: panel.current.location ?? panel.current.provider_address },
            { label: 'Status', value: statusLabel(panel.current.status) },
            { label: 'Outcome', value: panel.current.outcome ? (
              <ForwardedText
                profileId={profile.id}
                text={panel.current.outcome}
                forwards={(panel.current.forwarded ?? []).filter((f) => f.part === 'outcome')}
                canEdit={canEdit}
              />
            ) : null },
            { label: 'Notes', value: panel.current.notes ? (
              <ForwardedText
                profileId={profile.id}
                text={panel.current.notes}
                forwards={(panel.current.forwarded ?? []).filter((f) => f.part === 'details')}
                canEdit={canEdit}
              />
            ) : null },
            { label: 'Cost estimate', value: panel.current.cost_estimate != null ? `$${panel.current.cost_estimate.toFixed(2)}` : null },
            { label: 'Actual cost', value: panel.current.cost_actual != null ? `$${panel.current.cost_actual.toFixed(2)}` : null },
          ]}
          links={[
            ...(panel.current.medical_condition_id && conditionName(panel.current.medical_condition_id)
              ? [{ label: 'Condition', value: conditionName(panel.current.medical_condition_id), to: `/app/${profile.id}/conditions?record=${panel.current.medical_condition_id}` }]
              : []),
            ...(panel.current.provider_id && panel.current.provider_name
              ? [{ label: 'Provider', value: panel.current.provider_name, to: `/app/${profile.id}/providers?record=${panel.current.provider_id}` }]
              : []),
            ...(panel.current.provider_directions_link
              ? [{ label: 'Directions', value: 'Open map', href: panel.current.provider_directions_link }]
              : []),
            ...(panel.current.next_steps ?? []).map((st) => ({
              label: st.completed ? 'Next step, done' : 'Next step',
              value: st.title === st.type_name ? st.title : `${st.title}, ${st.type_name.toLowerCase()}`,
              to: `/app/${profile.id}/tasks?record=${st.id}`,
            })),
          ]}
          onEdit={() => setEditing(panel.current)}
          done={
            panel.current.status === 'scheduled'
              ? { label: 'Mark attended', onRun: () => markAttended.mutate(panel.current!), pending: markAttended.isPending }
              : null
          }
          extra={[
            { label: 'How did it go?', onRun: () => setOutcomeFor(panel.current!.id) },
            { label: 'Forward notes', onRun: () => setForwarding({ sourceId: panel.current!.id, noteId: null }) },
          ]}
          onForwardNote={(noteId) => setForwarding({ sourceId: panel.current!.id, noteId })}
          onDelete={() => {
            deleteAppointments([panel.current!]);
            panel.close();
          }}
          onClose={panel.close}
        />
      ) : null}

      {outcomeAppointment ? (
        <OutcomeModal
          key={outcomeAppointment.id}
          profileId={profile.id}
          appointment={outcomeAppointment}
          canEdit={canEdit}
          isOwner={isOwner}
          onClose={() => setOutcomeFor(null)}
          onBook={(step) => {
            setBooking({ step, from: outcomeAppointment });
            setOutcomeFor(null);
          }}
          onAddMedication={(step) => {
            setAddingMed({ step, from: outcomeAppointment });
            setOutcomeFor(null);
          }}
          onUpload={(step) => {
            setUploadingFor({ step, from: outcomeAppointment });
            setOutcomeFor(null);
          }}
        />
      ) : null}

      {addingMed ? (
        <MedicationForm
          profileId={profile.id}
          selfCare={relationship === SELF_RELATIONSHIP}
          initialName={addingMed.step.title === addingMed.step.type_name ? '' : addingMed.step.title}
          initialCondition={conditionName(addingMed.from.medical_condition_id)}
          onClose={() => setAddingMed(null)}
          onSaved={() => {
            finishStep.mutate(addingMed.step.id);
            void queryClient.invalidateQueries({ queryKey: ['medications', profile.id] });
            setOutcomeFor(addingMed.from.id);
            setAddingMed(null);
          }}
        />
      ) : null}

      {uploadingFor ? (
        <UploadDocumentModal
          profileId={profile.id}
          members={circleData?.members ?? []}
          initialFile={null}
          initialLabel={uploadingFor.step.title === uploadingFor.step.type_name ? '' : uploadingFor.step.title}
          initialConditionId={uploadingFor.from.medical_condition_id ?? ''}
          onClose={() => setUploadingFor(null)}
          onUploaded={() => {
            finishStep.mutate(uploadingFor.step.id);
            void queryClient.invalidateQueries({ queryKey: ['documents', profile.id] });
            setOutcomeFor(uploadingFor.from.id);
            setUploadingFor(null);
          }}
        />
      ) : null}

      {booking ? (
        <AppointmentEditor
          profileId={profile.id}
          appointment={null}
          initialTitle={booking.step.title}
          initialType={kindForStep(booking.step.type_name)}
          initialProviderId={booking.step.type_key === 'follow_up' ? booking.from.provider_id ?? '' : ''}
          initialConditionId={booking.from.medical_condition_id ?? ''}
          fromReminderId={booking.step.id}
          onClose={() => setBooking(null)}
          onSaved={() => {
            setBooking(null);
            invalidate();
            void queryClient.invalidateQueries({ queryKey: ['record-extras', profile.id] });
          }}
        />
      ) : null}

      {forwarding && appointments.some((a) => a.id === forwarding.sourceId) ? (
        <ForwardNotesModal
          key={`${forwarding.sourceId}-${forwarding.noteId ?? 'all'}`}
          profileId={profile.id}
          source={appointments.find((a) => a.id === forwarding.sourceId)!}
          appointments={appointments}
          initialNoteId={forwarding.noteId}
          onClose={() => setForwarding(null)}
          onBookNew={(items) => {
            setForwardingNew({ sourceId: forwarding.sourceId, items });
            setForwarding(null);
          }}
        />
      ) : null}

      {forwardingNew ? (
        <AppointmentEditor
          profileId={profile.id}
          appointment={null}
          initialConditionId={appointments.find((a) => a.id === forwardingNew.sourceId)?.medical_condition_id ?? ''}
          onClose={() => setForwardingNew(null)}
          onSaved={(saved) => {
            const pending = forwardingNew;
            setForwardingNew(null);
            invalidate();
            if (!saved) return;
            api
              .post(`/care-profiles/${profile.id}/appointments/${pending.sourceId}/forward`, {
                items: pending.items,
                to_appointment_id: saved.id,
              })
              .then(() => {
                setForwardError('');
                invalidate();
                void queryClient.invalidateQueries({ queryKey: ['record-extras', profile.id] });
              })
              .catch(() =>
                setForwardError('The appointment is booked, but the notes did not go with it. Open the first appointment and use Forward notes to send them again.')
              );
          }}
        />
      ) : null}

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

/**
 * Everything the appointment form asks for, one value per field. Shared by
 * the Add and Edit form and by "Book it now" inside How did it go, so a
 * booking made from either place asks for exactly the same things.
 */
export interface AppointmentDraft {
  title: string;
  type: string;
  providerId: string;
  conditionId: string;
  location: string;
  startDate: string;
  startTime: string;
  endTime: string;
  status: string;
  notes: string;
  costEstimate: string;
  costActual: string;
}

export function newAppointmentDraft(init: Partial<AppointmentDraft> = {}): AppointmentDraft {
  return {
    title: '',
    type: 'consultation',
    providerId: '',
    conditionId: '',
    location: '',
    startDate: '',
    startTime: '09:00',
    endTime: '',
    status: 'scheduled',
    notes: '',
    costEstimate: '',
    costActual: '',
    ...init,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

function draftFromAppointment(a: Appointment): AppointmentDraft {
  const d = new Date(a.starts_at);
  const e = a.ends_at ? new Date(a.ends_at) : null;
  return {
    title: a.title,
    type: a.appointment_type,
    providerId: a.provider_id ?? '',
    conditionId: a.medical_condition_id ?? '',
    location: a.location ?? '',
    startDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    startTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    endTime: e ? `${pad(e.getHours())}:${pad(e.getMinutes())}` : '',
    status: a.status,
    notes: a.notes ?? '',
    costEstimate: a.cost_estimate != null ? String(a.cost_estimate) : '',
    costActual: a.cost_actual != null ? String(a.cost_actual) : '',
  };
}

/** Ready to book: it says what it is for and when. */
export const draftIsBookable = (d: AppointmentDraft) => !!d.title.trim() && !!d.startDate;

/** The draft as the appointments API takes it. */
export function appointmentBody(d: AppointmentDraft, fromReminderId?: string) {
  const startsAt = new Date(`${d.startDate}T${d.startTime || '09:00'}`).toISOString();
  const endsAt = d.endTime ? new Date(`${d.startDate}T${d.endTime}`).toISOString() : null;
  return {
    title: d.title.trim(),
    appointment_type: d.type,
    provider_id: d.providerId || null,
    medical_condition_id: d.conditionId || null,
    location: d.location.trim() || null,
    starts_at: startsAt,
    ends_at: endsAt,
    status: d.status,
    notes: d.notes.trim() || null,
    cost_estimate: d.costEstimate.trim() === '' ? null : Number(d.costEstimate),
    cost_actual: d.costActual.trim() === '' ? null : Number(d.costActual),
    ...(fromReminderId ? { from_reminder_id: fromReminderId } : {}),
  };
}

/** A best guess at the kind of appointment a next step calls for. */
export function kindForStep(typeName: string): string {
  if (/test|x-ray|scan|ultrasound|biopsy|blood|sample|swab/i.test(typeName)) return 'test';
  if (/procedure/i.test(typeName)) return 'procedure';
  if (/therapy/i.test(typeName)) return 'therapy';
  if (/vaccination/i.test(typeName)) return 'vaccination';
  if (/follow/i.test(typeName)) return 'review';
  return 'consultation';
}

/**
 * The appointment form's fields: what for, kind, condition, who with (pick
 * one, or type a new name and save it to Providers), where, when, status,
 * notes and cost. Choosing who it is with fills in where.
 */
export function AppointmentFields({
  profileId,
  value,
  onChange,
  idPrefix = 'appt',
}: {
  profileId: string;
  value: AppointmentDraft;
  onChange: (next: AppointmentDraft) => void;
  /** Keeps labels unique when more than one form is on screen. */
  idPrefix?: string;
}) {
  const queryClient = useQueryClient();
  const health = useHealthConfig();
  const [providerName, setProviderName] = useState('');
  const [showSaveProvider, setShowSaveProvider] = useState(false);
  const set = (patch: Partial<AppointmentDraft>) => onChange({ ...value, ...patch });

  const { data: providersData } = useQuery({
    queryKey: ['providers', profileId],
    queryFn: () => api.get<{ providers: ProviderFull[] }>(`/care-profiles/${profileId}/providers`),
  });
  const providers = providersData?.providers ?? [];

  // The conditions this appointment could be for, so an x-ray booked for a
  // sore ankle can be tied to the ankle.
  const { data: conditionData } = useQuery({
    queryKey: ['conditions', profileId],
    queryFn: () => api.get<{ conditions: { id: string; name: string }[] }>(`/care-profiles/${profileId}/conditions`),
  });
  const conditions = conditionData?.conditions ?? [];

  const handleProviderChange = (newProviderId: string) => {
    setShowSaveProvider(false);
    const provider = newProviderId ? providers.find((p) => p.id === newProviderId) : undefined;
    const where = provider?.directions_link || provider?.address;
    set({ providerId: newProviderId, ...(where ? { location: where } : {}) });
  };

  const handleProviderNameBlur = () => {
    if (providerName.trim() && !value.providerId) {
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
        address: value.location.trim() || null,
      }),
    onSuccess: (res) => {
      set({ providerId: res.provider.id });
      setShowSaveProvider(false);
      setProviderName('');
      void queryClient.invalidateQueries({ queryKey: ['providers', profileId] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Input
          id={`${idPrefix}-title`}
          label="What for"
          placeholder="e.g. Cardiology check-up"
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
        />
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1">Kind</span>
          <select className={inputClass} value={value.type} onChange={(e) => set({ type: e.target.value })}>
            {APPOINTMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1">What is it for</span>
          <select className={inputClass} value={value.conditionId} onChange={(e) => set({ conditionId: e.target.value })}>
            <option value="">Not for a particular condition</option>
            {conditions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <span className="block text-xs text-muted mt-1">
            Ties this appointment to that condition's tracking, and marks it on the calendar.
          </span>
        </label>
        <div>
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">With</span>
            <select className={inputClass} value={value.providerId} onChange={(e) => handleProviderChange(e.target.value)}>
              <option value="">Nobody linked</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          {!value.providerId && providers.length > 0 ? (
            <div className="mt-1">
              <input
                type="text"
                aria-label="Or type a new name"
                className={inputClass}
                placeholder="Or type a new name"
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
          id={`${idPrefix}-location`}
          label="Location"
          placeholder="e.g. Suite 4, 12 High St or a map link"
          value={value.location}
          onChange={(e) => set({ location: e.target.value })}
          hint={value.providerId ? 'Filled in from who it is with. Edit if different.' : undefined}
        />
        <Input
          id={`${idPrefix}-date`}
          label="Start date"
          type="date"
          value={value.startDate}
          onChange={(e) => set({ startDate: e.target.value })}
        />
        <Input
          id={`${idPrefix}-start`}
          label="Start time"
          type="time"
          value={value.startTime}
          onChange={(e) => set({ startTime: e.target.value })}
        />
        <Input
          id={`${idPrefix}-end`}
          label="End time"
          type="time"
          value={value.endTime}
          onChange={(e) => set({ endTime: e.target.value })}
          hint="On the same day. Leave blank if unknown."
        />
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1">Status</span>
          <select className={inputClass} value={value.status} onChange={(e) => set({ status: e.target.value })}>
            {APPOINTMENT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>
      <Textarea id={`${idPrefix}-notes`} label="Notes" rows={2} value={value.notes} onChange={(e) => set({ notes: e.target.value })} />
      <div className="grid sm:grid-cols-2 gap-3">
        <Input
          id={`${idPrefix}-estimate`}
          label={`Estimated cost (${health.currency_symbol})`}
          type="number"
          min="0"
          step="any"
          value={value.costEstimate}
          onChange={(e) => set({ costEstimate: e.target.value })}
          hint="What you expect it to cost. Kept as an estimate until confirmed."
        />
        <Input
          id={`${idPrefix}-actual`}
          label={`Actual cost (${health.currency_symbol})`}
          type="number"
          min="0"
          step="any"
          value={value.costActual}
          onChange={(e) => set({ costActual: e.target.value })}
          hint="What it actually cost. Counts as health spend once entered."
        />
      </div>
    </div>
  );
}

export function AppointmentEditor({
  profileId,
  appointment,
  initialProviderId = '',
  initialTitle = '',
  initialType = 'consultation',
  initialConditionId = '',
  fromReminderId = '',
  onClose,
  onSaved,
}: {
  profileId: string;
  appointment: Appointment | null;
  /** Preselects a provider on a new appointment, e.g. the GP from a health alert. */
  initialProviderId?: string;
  /** Prefills the title on a new appointment, e.g. a surgery from a condition. */
  initialTitle?: string;
  /** Preselects the kind on a new appointment, e.g. procedure for a surgery. */
  initialType?: string;
  /** Preselect the condition this appointment is being booked for. */
  initialConditionId?: string;
  /** The next step this appointment carries out; saving ticks it off. */
  fromReminderId?: string;
  onClose: () => void;
  /** Gets the saved appointment, e.g. so notes can be forwarded to a new one. */
  onSaved: (saved?: { id: string }) => void;
}) {
  const isNew = appointment === null;
  const [draft, setDraft] = useState<AppointmentDraft>(() =>
    appointment
      ? draftFromAppointment(appointment)
      : newAppointmentDraft({ title: initialTitle, type: initialType, providerId: initialProviderId, conditionId: initialConditionId })
  );
  const [error, setError] = useState('');

  useEffect(() => {
    if (appointment) setDraft(draftFromAppointment(appointment));
  }, [appointment]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = appointmentBody(draft, isNew && fromReminderId ? fromReminderId : undefined);
      return isNew
        ? api.post<{ appointment: { id: string } }>(`/care-profiles/${profileId}/appointments`, body)
        : api.patch<{ appointment: { id: string } }>(`/care-profiles/${profileId}/appointments/${appointment.id}`, body);
    },
    onSuccess: (res) => onSaved(res?.appointment),
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the appointment.'),
  });

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add appointment' : `Edit ${appointment.title}`} wide>
      <div className="space-y-4">
        <AppointmentFields profileId={profileId} value={draft} onChange={setDraft} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={saveMutation.isPending}
            disabled={!draftIsBookable(draft)}
            onClick={() => saveMutation.mutate()}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
