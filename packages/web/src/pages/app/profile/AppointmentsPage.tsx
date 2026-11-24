import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { SELF_RELATIONSHIP, personKey, type CircleMember, type ContactSummary, type Task } from '../../../lib/care';
import { RecordPanel } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { useProfile } from './ProfileLayout';
import { useHealthConfig } from '../../../lib/appConfig';
import { noticeFiled, refreshContacts, useNoticeStore } from '../../../stores/notice';
import { AddressFields, addressFrom, addressPayload, emptyAddress, hasAddress, type AddressValue } from '../../../components/AddressFields';
import { ContactStrip } from '../../../components/ContactStrip';
import { SendAppointmentModal, downloadAppointmentIcs } from '../../../components/SendAppointmentModal';
import { ContactPicker } from '../../../components/ContactPicker';
import { LinkedText } from '../../../components/LinkedText';
import { DocumentAttach } from '../../../components/DocumentAttach';
import { usePickablePeople, personOption } from '../../../components/PersonPicker';
import { REPEAT_CHOICES, repeatLabel } from '../../../lib/repeat';
import { bookingTitleFromTask } from '../../../lib/booking';
import { browserTimeZone } from '../../../lib/datetime';
import { doctorViewLabel, type TestResult } from '../../../lib/lifeEvents';

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
  /** Who it is with, as someone to call. */
  provider?: ContactSummary | null;
  /** One line for display, kept in step with the address parts below. */
  location: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  address_suburb?: string | null;
  address_state?: string | null;
  address_postcode?: string | null;
  address_country?: string | null;
  /** Its own map link, if one was given. */
  directions_link?: string | null;
  /** Empty while it is not booked yet: every other detail can be filled in. */
  starts_at: string | null;
  ends_at: string | null;
  /** No set time: starts_at is midnight that day. */
  all_day?: boolean;
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
  preparation?: string | null;
  telehealth_link?: string | null;
  interpreter_needed?: boolean;
  interpreter_language?: string | null;
  from_reminder_id?: string | null;
  attendees?: Array<{ circle_member_id: string | null; account_id: string | null; is_driver: boolean; name: string }>;
  bring_documents?: Array<{ id: string; label: string; category_name: string | null }>;
  series?: { id: string; repeat: string; repeat_until: string | null } | null;
  /** Results to talk about at this visit. */
  results_to_discuss?: TestResult[];
  /** Results recorded for this test appointment. */
  test_results?: Array<{ id: string; test_name: string; reported_on: string | null }>;
  from_task?: {
    id: string;
    title: string;
    body: string | null;
    completed_at: string | null;
    notes: Array<{ id: string; body: string; created_at: string; author_name: string | null }>;
  } | null;
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
  { value: 'to_book', label: 'Not booked yet' },
] as const;

const typeLabel = (v: string) => APPOINTMENT_TYPES.find((t) => t.value === v)?.label ?? v;
const statusLabel = (v: string) => APPOINTMENT_STATUSES.find((s) => s.value === v)?.label ?? v;

const openSteps = (a: Appointment) => (a.next_steps ?? []).filter((s) => !s.completed).length;
const byText = (x: string | null | undefined, y: string | null | undefined) => (x ?? '').localeCompare(y ?? '');

const whenValue = (a: Appointment) => (a.starts_at ? new Date(a.starts_at).getTime() : Number.MAX_SAFE_INTEGER);

/** "Mon 23 Nov 2026, 10:30", or "Mon 23 Nov 2026, any time" with no set time. */
export const whenText = (a: Pick<Appointment, 'starts_at' | 'all_day'>, pattern = 'EEE d MMM yyyy') =>
  a.starts_at ? `${format(new Date(a.starts_at), pattern)}, ${a.all_day ? 'any time' : format(new Date(a.starts_at), 'HH:mm')}` : 'Not booked yet';

const SORTS: DataSort<Appointment>[] = [
  // Not booked yet sorts as the latest, so it leads the newest-first list.
  { key: 'when', label: 'By date', defaultDir: 'desc', compare: (a, b) => whenValue(a) - whenValue(b) },
  { key: 'title', label: 'By appointment', compare: (a, b) => a.title.localeCompare(b.title) },
  { key: 'kind', label: 'By kind', compare: (a, b) => typeLabel(a.appointment_type).localeCompare(typeLabel(b.appointment_type)) },
  { key: 'with', label: 'By who with', compare: (a, b) => byText(a.provider_name, b.provider_name) },
  { key: 'phone', label: 'By their phone', compare: (a, b) => byText(a.provider?.phone, b.provider?.phone) },
  { key: 'location', label: 'By location', compare: (a, b) => byText(a.location, b.location) },
  { key: 'status', label: 'By status', compare: (a, b) => statusLabel(a.status).localeCompare(statusLabel(b.status)) },
  { key: 'outcome', label: 'By outcome', compare: (a, b) => byText(a.outcome, b.outcome) },
  { key: 'steps', label: 'By open next steps', defaultDir: 'desc', compare: (a, b) => openSteps(a) - openSteps(b) },
];

/** Finished, so it is time to ask how it went. */
const isPast = (a: Appointment) => !!a.starts_at && new Date(a.ends_at ?? a.starts_at).getTime() < Date.now();
/** Its start time has come. */
const hasStarted = (a: Appointment) => !!a.starts_at && new Date(a.starts_at).getTime() <= Date.now();

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

/** What a booking opened from a link starts with. */
interface NewBooking {
  providerId: string;
  conditionId: string;
  fromTask: string;
  title: string;
  type: string;
}
const noBooking: NewBooking = { providerId: '', conditionId: '', fromTask: '', title: '', type: '' };

export function AppointmentsPage() {
  const { profile, careName, canEdit, isOwner, relationship } = useProfile();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const notice = useNoticeStore((s) => s.show);
  const [adding, setAdding] = useState(false);
  const [newBooking, setNewBooking] = useState<NewBooking>(noBooking);
  const [searchParams, setSearchParams] = useSearchParams();

  // Book from anywhere: ?new=1 with who it is with, what it is for, the task
  // it carries out, a title or a kind fills the form, so booking is one step.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setNewBooking({
        providerId: searchParams.get('provider') ?? '',
        conditionId: searchParams.get('condition') ?? '',
        fromTask: searchParams.get('from_task') ?? '',
        title: searchParams.get('title') ?? '',
        type: searchParams.get('type') ?? '',
      });
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
  // Sending one appointment to someone, such as whoever is driving.
  const [sendingFor, setSendingFor] = useState<Appointment | null>(null);
  const [calendarError, setCalendarError] = useState('');
  // One in a series was moved: offer to move the later ones too.
  const [seriesMove, setSeriesMove] = useState<{ id: string; from: string; later: number; to: string } | null>(null);

  const { data: conditionData } = useQuery({
    queryKey: ['conditions', profile.id],
    queryFn: () => api.get<{ conditions: { id: string; name: string }[] }>(`/care-profiles/${profile.id}/conditions`),
  });
  const conditionName = (id: string | null) => (conditionData?.conditions ?? []).find((c) => c.id === id)?.name ?? '';
  const { data: circleData } = useQuery({
    queryKey: ['circle', profile.id],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profile.id}/circle`),
  });
  const { data: taskData } = useQuery({
    queryKey: ['tasks', profile.id],
    queryFn: () => api.get<{ reminders: Task[] }>(`/care-profiles/${profile.id}/reminders?status=all`),
    enabled: !!newBooking.fromTask,
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
    void queryClient.invalidateQueries({ queryKey: ['calendar-upcoming', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['tasks', profile.id] });
  };

  // The task a booking came from: one already waiting with its details opens
  // that appointment to give it a date, rather than making a second.
  const fromTask = newBooking.fromTask ? (taskData?.reminders ?? []).find((t) => t.id === newBooking.fromTask) ?? null : null;
  useEffect(() => {
    if (!fromTask?.to_book_appointment_id || appointments.length === 0) return;
    const waiting = appointments.find((a) => a.id === fromTask.to_book_appointment_id);
    if (waiting) {
      setAdding(false);
      setNewBooking(noBooking);
      setEditing(waiting);
    }
  }, [fromTask, appointments]);
  const fromTaskCondition = fromTask
    ? fromTask.medical_condition_id ?? (fromTask.appointment_id ? appointments.find((a) => a.id === fromTask.appointment_id)?.medical_condition_id ?? '' : '')
    : '';

  // ?book=<id> arrives from a to-do: give that appointment its date.
  useEffect(() => {
    const id = searchParams.get('book');
    if (!id || appointments.length === 0) return;
    const appt = appointments.find((a) => a.id === id);
    if (appt) setEditing(appt);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('book');
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams, appointments]);

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

  const stopRepeating = useMutation({
    mutationFn: (a: Appointment) => api.post<{ removed: number }>(`/care-profiles/${profile.id}/appointments/${a.id}/stop-repeating`),
    onSuccess: (res) => {
      notice({ message: res.removed ? `Stopped repeating. The ${res.removed} after this one are off the calendar.` : 'Stopped repeating. This is the last one.' });
      invalidate();
    },
  });

  const moveLater = useMutation({
    mutationFn: (m: { id: string; from: string }) => api.post<{ moved: number }>(`/care-profiles/${profile.id}/appointments/${m.id}/move-later`, { from_starts_at: m.from }),
    onSuccess: (res) => {
      setSeriesMove(null);
      notice({ message: `Moved ${res.moved} more.` });
      invalidate();
    },
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

  const current = panel.current;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-ink">Appointments</h2>
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

      {seriesMove ? (
        <div className="card flex flex-wrap items-center gap-3" role="status">
          <p className="flex-1 text-sm text-ink">
            {/* Weekly kinds keep a weekday; monthly and longer move by the same change. */}
            {['daily', 'weekly', 'fortnightly'].includes(appointments.find((a) => a.id === seriesMove.id)?.series?.repeat ?? '')
              ? `Moved this one. Move the ${seriesMove.later} after it to ${format(new Date(seriesMove.to), 'EEEE')}s at ${format(new Date(seriesMove.to), 'HH:mm')} too?`
              : `Moved this one. Move the ${seriesMove.later} after it by the same change too?`}
          </p>
          <Button size="sm" variant="secondary" loading={moveLater.isPending} onClick={() => moveLater.mutate({ id: seriesMove.id, from: seriesMove.from })}>Move them too</Button>
          <Button size="sm" variant="ghost" onClick={() => setSeriesMove(null)}>Leave them</Button>
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
                <SortableTh label="Their phone" sortKey="phone" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="hidden xl:table-cell" />
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
                    {a.starts_at ? (
                      whenText(a)
                    ) : canEdit ? (
                      <Button size="xs" variant="secondary" onClick={() => setEditing(a)}>Book it</Button>
                    ) : (
                      <span className="text-muted">Not booked yet</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-ink">{a.title}</td>
                  <td className="px-3 py-2 text-ink hidden xl:table-cell">{typeLabel(a.appointment_type)}</td>
                  <td className="px-3 py-2 text-ink hidden lg:table-cell">{a.provider_name ?? ''}</td>
                  <td className="px-3 py-2 whitespace-nowrap hidden xl:table-cell">
                    {a.provider?.phone ? (
                      <a href={`tel:${a.provider.phone.replace(/[^\d+]/g, '')}`} className="text-primary hover:underline" aria-label={`Call ${a.provider.name} on ${a.provider.phone}`}>
                        {a.provider.phone}
                      </a>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted hidden 2xl:table-cell">{a.location ?? ''}</td>
                  <td className="px-3 py-2 text-ink">
                    {!a.starts_at && canEdit ? (
                      <Button size="xs" variant="ghost" className="whitespace-nowrap" aria-label={`Book ${a.title}`} onClick={() => setEditing(a)}>
                        Not booked yet, book it
                      </Button>
                    ) : (
                      statusLabel(a.status)
                    )}
                  </td>
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

      {current ? (
        <RecordPanel
          key={current.id}
          kindLabel="Appointment"
          title={current.title}
          subtitle={current.starts_at ? whenText(current, 'EEEE d MMMM yyyy') : 'Not booked yet'}
          kind="appointments"
          recordId={current.id}
          profileId={profile.id}
          canEdit={canEdit}
          fields={[
            {
              label: 'When',
              value: current.starts_at
                ? whenText(current)
                : canEdit
                  ? <Button size="xs" variant="ghost" onClick={() => setEditing(current)}>Not booked yet, book it</Button>
                  : 'Not booked yet',
            },
            { label: 'Ends', value: current.ends_at ? format(new Date(current.ends_at), 'HH:mm') : null },
            { label: 'Kind', value: typeLabel(current.appointment_type) },
            {
              label: 'Repeats',
              value: current.series ? `${repeatLabel(current.series.repeat)}${current.series.repeat_until ? `, until ${format(new Date(`${current.series.repeat_until}T00:00`), 'd MMM yyyy')}` : ''}` : null,
            },
            { label: 'Location', value: current.location ?? current.provider_address },
            {
              label: "Who's going",
              value: (current.attendees ?? []).length
                ? (current.attendees ?? []).map((p) => p.name).join(', ')
                : null,
            },
            { label: 'Driving', value: (current.attendees ?? []).filter((p) => p.is_driver).map((p) => p.name).join(', ') },
            { label: 'Interpreter', value: current.interpreter_needed ? 'Needed' : null },
            { label: 'Language', value: current.interpreter_needed ? current.interpreter_language : null },
            { label: 'How to get ready', value: current.preparation ? <LinkedText text={current.preparation} canEdit={false} /> : null },
            {
              label: 'Status',
              value: !current.starts_at && canEdit
                ? <Button size="xs" variant="ghost" onClick={() => setEditing(current)}>Not booked yet, book it</Button>
                : statusLabel(current.status),
            },
            { label: 'Outcome', value: current.outcome ? (
              <ForwardedText
                profileId={profile.id}
                text={current.outcome}
                forwards={(current.forwarded ?? []).filter((f) => f.part === 'outcome')}
                canEdit={canEdit}
              />
            ) : null },
            { label: 'Notes', value: current.notes ? (
              (current.forwarded ?? []).some((f) => f.part === 'details') ? (
                <ForwardedText
                  profileId={profile.id}
                  text={current.notes}
                  forwards={(current.forwarded ?? []).filter((f) => f.part === 'details')}
                  canEdit={canEdit}
                />
              ) : (
                <LinkedText text={current.notes} profileId={profile.id} contact={current.provider ?? null} context={current.title} canEdit={canEdit} />
              )
            ) : null },
            { label: 'Cost estimate', value: current.cost_estimate != null ? `$${current.cost_estimate.toFixed(2)}` : null },
            { label: 'Actual cost', value: current.cost_actual != null ? `$${current.cost_actual.toFixed(2)}` : null },
          ]}
          links={[
            ...(current.telehealth_link ? [{ label: 'Video call', value: 'Join the video call', href: current.telehealth_link }] : []),
            ...(current.medical_condition_id && conditionName(current.medical_condition_id)
              ? [{ label: 'Condition', value: conditionName(current.medical_condition_id), to: `/app/${profile.id}/conditions?record=${current.medical_condition_id}` }]
              : []),
            // Who it is with shows under Who with, with their name opening
            // their contact record, so it is not listed twice.
            ...(current.provider_id && current.provider_name && !current.provider
              ? [{ label: 'Contact', value: current.provider_name, to: `/app/${profile.id}/providers?record=${current.provider_id}` }]
              : []),
            ...((current.directions_link || current.provider_directions_link)
              ? [{ label: 'Directions', value: 'Open map', href: (current.directions_link || current.provider_directions_link)! }]
              : []),
            ...(current.next_steps ?? []).map((st) => ({
              label: st.completed ? 'Next step, done' : 'Next step',
              value: st.title === st.type_name ? st.title : `${st.title}, ${st.type_name.toLowerCase()}`,
              to: `/app/${profile.id}/tasks?record=${st.id}`,
            })),
          ]}
          onEdit={() => setEditing(current)}
          done={
            !current.starts_at
              ? { label: 'Book it', onRun: () => setEditing(current) }
              : current.status === 'scheduled' && hasStarted(current)
                ? { label: 'Mark attended', onRun: () => markAttended.mutate(current), pending: markAttended.isPending }
                : null
          }
          extra={[
            // Only once it has happened.
            ...(hasStarted(current) && current.status !== 'cancelled' ? [{ label: 'How did it go?', onRun: () => setOutcomeFor(current.id) }] : []),
            { label: 'Forward notes', onRun: () => setForwarding({ sourceId: current.id, noteId: null }) },
            // Only once it has a date: a driver needs a time and a place.
            ...(current.starts_at && current.status !== 'cancelled'
              ? [
                  { label: 'Send to someone', onRun: () => setSendingFor(current) },
                  {
                    label: 'Add to my calendar',
                    always: true,
                    onRun: () => {
                      setCalendarError('');
                      downloadAppointmentIcs(profile.id, current.id, current.title).catch((err: unknown) =>
                        setCalendarError(err instanceof Error ? err.message : 'The calendar entry could not be made just now. Try again in a moment.')
                      );
                    },
                  },
                ]
              : []),
            ...(current.series ? [{ label: 'Stop repeating', onRun: () => stopRepeating.mutate(current), pending: stopRepeating.isPending }] : []),
            // A test: its results go on the Test results page, tied to this appointment.
            ...(current.appointment_type === 'test' && current.status !== 'cancelled'
              ? [{ label: 'Add a result', onRun: () => navigate(`/app/${profile.id}/test-results?${new URLSearchParams({ new: '1', appointment: current.id, test: current.title }).toString()}`) }]
              : []),
          ]}
          onForwardNote={(noteId) => setForwarding({ sourceId: current.id, noteId })}
          onDelete={() => {
            deleteAppointments([current]);
            panel.close();
          }}
          onClose={panel.close}
        >
          {calendarError ? <p className="text-sm text-red-600" role="alert">{calendarError}</p> : null}
          {(current.results_to_discuss ?? []).length > 0 ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Results to talk about</h3>
              <ul className="space-y-2">
                {(current.results_to_discuss ?? []).map((r) => (
                  <li key={r.id} className="rounded-md border border-border px-3 py-2">
                    <Link to={`/app/${profile.id}/test-results?record=${r.id}`} className="text-sm font-medium text-primary hover:underline">{r.test_name}</Link>
                    <p className="text-xs text-muted">
                      {[r.collected_on ? `Collected ${format(new Date(`${r.collected_on}T00:00`), 'd MMM yyyy')}` : null, r.doctor_view ? doctorViewLabel(r.doctor_view) : null, r.ordered_by ? `Ordered by ${r.ordered_by.name}` : null].filter(Boolean).join(' · ')}
                    </p>
                    {r.summary ? <p className="text-sm text-ink">{r.summary}</p> : null}
                    {r.values.filter((v) => v.flag === 'low' || v.flag === 'high').length > 0 ? (
                      <p className="text-xs text-red-700 dark:text-red-300">
                        Outside the normal range: {r.values.filter((v) => v.flag === 'low' || v.flag === 'high').map((v) => v.name).join(', ')}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {(current.test_results ?? []).length > 0 ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Results of this test</h3>
              <ul className="space-y-1">
                {(current.test_results ?? []).map((r) => (
                  <li key={r.id}>
                    <Link to={`/app/${profile.id}/test-results?record=${r.id}`} className="text-sm text-primary hover:underline">{r.test_name}</Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Who with</h3>
            {current.provider ? (
              <ContactStrip
                contact={current.provider}
                profileId={profile.id}
                book={false}
                recordHref={current.provider.source === 'contact' && current.provider.id ? `/app/${profile.id}/providers?record=${current.provider.id}` : undefined}
              />
            ) : (
              <p className="text-sm text-muted">No one linked yet.</p>
            )}
          </section>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Documents to bring</h3>
            {(current.bring_documents ?? []).length === 0 ? (
              <p className="text-sm text-muted">Nothing to bring yet.</p>
            ) : (
              <ul className="space-y-1">
                {current.bring_documents!.map((d) => (
                  <li key={d.id} className="text-sm">
                    <Link to={`/app/${profile.id}/documents?doc=${d.id}`} className="text-primary hover:underline break-words">{d.label}</Link>
                    {d.category_name ? <span className="ml-2 text-xs text-muted">{d.category_name}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {current.from_task ? (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">From the task</h3>
              <p className="text-sm">
                <Link to={`/app/${profile.id}/tasks?record=${current.from_task.id}`} className="text-primary hover:underline">{current.from_task.title}</Link>
                {current.from_task.completed_at ? <span className="text-muted">, done {format(new Date(current.from_task.completed_at), 'd MMM yyyy')}</span> : null}
              </p>
              {current.from_task.body ? (
                <div className="mt-1 text-sm text-ink">
                  <LinkedText text={current.from_task.body} profileId={profile.id} contact={current.provider ?? null} context={current.from_task.title} canEdit={canEdit} />
                </div>
              ) : null}
              {current.from_task.notes.length ? (
                <ul className="mt-2 space-y-1">
                  {current.from_task.notes.map((n) => (
                    <li key={n.id} className="rounded-md border border-border px-3 py-2">
                      <p className="text-sm text-ink"><LinkedText text={n.body} canEdit={false} /></p>
                      <p className="text-xs text-muted">{n.author_name ?? 'Someone'}, {format(new Date(n.created_at), 'd MMM yyyy, HH:mm')}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </RecordPanel>
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
          onAddEquipment={(step) => {
            setOutcomeFor(null);
            navigate(`/app/${profile.id}/equipment?${new URLSearchParams({ new: '1', name: step.title === step.type_name ? '' : step.title, from_task: step.id }).toString()}`);
          }}
          onAddDate={(id) => {
            const appt = appointments.find((a) => a.id === id);
            if (appt) {
              setEditing(appt);
              setOutcomeFor(null);
            }
          }}
        />
      ) : null}

      {addingMed ? (
        <MedicationForm
          profileId={profile.id}
          selfCare={relationship === SELF_RELATIONSHIP}
          initialName={addingMed.step.title === addingMed.step.type_name ? '' : addingMed.step.title}
          initialCondition={conditionName(addingMed.from.medical_condition_id)}
          initialSourceAppointmentId={addingMed.from.id}
          initialPrescriber={addingMed.from.provider ?? null}
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
          links={[{ kind: 'reminders', id: uploadingFor.step.id }, { kind: 'appointments', id: uploadingFor.from.id }]}
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
          initialProviderId={booking.step.provider_id ?? (booking.step.type_key === 'follow_up' ? booking.from.provider_id ?? '' : '')}
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

      {sendingFor ? (
        <SendAppointmentModal
          profileId={profile.id}
          appointmentId={sendingFor.id}
          title={sendingFor.title}
          driver={(sendingFor.attendees ?? []).find((a) => a.is_driver) ?? null}
          onClose={() => setSendingFor(null)}
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

      {(adding && (!newBooking.fromTask || fromTask)) || editing ? (
        <AppointmentEditor
          key={editing?.id ?? `new-${newBooking.fromTask}`}
          profileId={profile.id}
          appointment={editing}
          initialProviderId={editing ? '' : newBooking.providerId || fromTask?.provider_id || ''}
          initialConditionId={editing ? '' : newBooking.conditionId || fromTaskCondition || ''}
          initialTitle={editing ? '' : newBooking.title || (fromTask ? bookingTitleFromTask(fromTask) : '')}
          initialType={editing ? 'consultation' : newBooking.type || (fromTask?.kind ? kindForStep(fromTask.kind.name) : 'consultation')}
          initialBringIds={editing ? [] : (fromTask?.documents ?? []).map((d) => d.id)}
          fromReminderId={editing ? '' : fromTask?.id ?? ''}
          onClose={() => {
            setAdding(false);
            setEditing(null);
            setNewBooking(noBooking);
            setBulkEditQueue([]);
          }}
          onSaved={(saved, info) => {
            setAdding(false);
            setNewBooking(noBooking);
            invalidate();
            if (saved && info?.series_move && info.starts_at) {
              setSeriesMove({ id: saved.id, from: info.series_move.from_starts_at, later: info.series_move.later, to: info.starts_at });
            }
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
  address_line1?: string | null;
  address_line2?: string | null;
  address_suburb?: string | null;
  address_state?: string | null;
  address_postcode?: string | null;
  address_country?: string | null;
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
  /** A new name typed for who it is with: filed in Contacts on save. */
  newProviderName: string;
  /** What that new person does, when known, e.g. from a referral. */
  newProviderType: string;
  /** Their phone: for a new name, or a contact with no number yet. */
  providerPhone: string;
  conditionId: string;
  /** Where it is, found with the same address finder as everywhere else. */
  address: AddressValue;
  /** Its own map link, if the place has one. */
  directionsLink: string;
  /** Video call link for a telehealth appointment. */
  telehealthLink: string;
  startDate: string;
  /** Blank means any time that day. */
  startTime: string;
  endTime: string;
  repeat: string;
  repeatUntil: string;
  status: string;
  /** Who is going, by personKey, and whether each is driving. */
  attendees: Array<{ key: string; isDriver: boolean }>;
  interpreterNeeded: boolean;
  interpreterLanguage: string;
  bringIds: string[];
  preparation: string;
  notes: string;
  costEstimate: string;
  costActual: string;
}

export function newAppointmentDraft(init: Partial<AppointmentDraft> = {}): AppointmentDraft {
  return {
    title: '',
    type: 'consultation',
    providerId: '',
    newProviderName: '',
    newProviderType: '',
    providerPhone: '',
    conditionId: '',
    address: emptyAddress,
    directionsLink: '',
    telehealthLink: '',
    startDate: '',
    startTime: '',
    endTime: '',
    repeat: 'once',
    repeatUntil: '',
    status: 'scheduled',
    attendees: [],
    interpreterNeeded: false,
    interpreterLanguage: '',
    bringIds: [],
    preparation: '',
    notes: '',
    costEstimate: '',
    costActual: '',
    ...init,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

function draftFromAppointment(a: Appointment): AppointmentDraft {
  const d = a.starts_at ? new Date(a.starts_at) : null;
  const e = a.ends_at ? new Date(a.ends_at) : null;
  return newAppointmentDraft({
    title: a.title,
    type: a.appointment_type,
    providerId: a.provider_id ?? '',
    conditionId: a.medical_condition_id ?? '',
    address: addressFrom(a),
    directionsLink: a.directions_link ?? '',
    telehealthLink: a.telehealth_link ?? '',
    startDate: d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '',
    startTime: d && !a.all_day ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '',
    endTime: e && !a.all_day ? `${pad(e.getHours())}:${pad(e.getMinutes())}` : '',
    repeat: a.series?.repeat ?? 'once',
    repeatUntil: a.series?.repeat_until ?? '',
    status: a.status,
    attendees: (a.attendees ?? []).map((p) => ({
      key: p.account_id ? personKey({ account_id: p.account_id }) : personKey({ circle_member_id: p.circle_member_id! }),
      isDriver: p.is_driver,
    })),
    interpreterNeeded: !!a.interpreter_needed,
    interpreterLanguage: a.interpreter_language ?? '',
    bringIds: (a.bring_documents ?? []).map((x) => x.id),
    preparation: a.preparation ?? '',
    notes: a.notes ?? '',
    costEstimate: a.cost_estimate != null ? String(a.cost_estimate) : '',
    costActual: a.cost_actual != null ? String(a.cost_actual) : '',
  });
}

/** What a booking still needs, box by box, in the words shown next to it. */
export interface AppointmentDraftErrors {
  title?: string;
  startDate?: string;
}

/**
 * What is missing. The date is only needed for an appointment that already
 * had one: a new appointment can be saved without it, as Not booked yet.
 */
export function appointmentDraftErrors(d: AppointmentDraft, requireDate = false): AppointmentDraftErrors {
  const errors: AppointmentDraftErrors = {};
  if (!d.title.trim()) errors.title = 'Say what it is for, e.g. Neurology appointment.';
  if (requireDate && !d.startDate) errors.startDate = 'Pick the day it is on. A booked appointment keeps its date.';
  return errors;
}

/** Ready to save. */
export const draftIsBookable = (d: AppointmentDraft, requireDate = false) =>
  Object.keys(appointmentDraftErrors(d, requireDate)).length === 0;

/** One sentence naming what is missing, for beside the Save button. */
export function missingSentence(errors: AppointmentDraftErrors, what = 'This appointment'): string {
  const parts = [errors.title ? 'what it is for' : null, errors.startDate ? 'a start date' : null].filter(Boolean);
  return parts.length ? `${what} needs ${parts.join(' and ')}.` : '';
}

/** The draft as the appointments API takes it. */
export function appointmentBody(d: AppointmentDraft, fromReminderId?: string) {
  // No date: saved as Not booked yet, waiting on a to-do. A date with no time
  // is any time that day.
  const allDay = !!d.startDate && !d.startTime;
  const startsAt = d.startDate ? new Date(`${d.startDate}T${d.startTime || '00:00'}`).toISOString() : null;
  const endsAt = d.startDate && d.startTime && d.endTime ? new Date(`${d.startDate}T${d.endTime}`).toISOString() : null;
  return {
    title: d.title.trim(),
    appointment_type: d.type,
    provider_id: d.providerId || null,
    ...(!d.providerId && d.newProviderName.trim()
      ? { provider_name: d.newProviderName.trim(), provider_type: d.newProviderType.trim() || null }
      : {}),
    ...(d.providerPhone.trim() && (d.providerId || d.newProviderName.trim()) ? { provider_phone: d.providerPhone.trim() } : {}),
    medical_condition_id: d.conditionId || null,
    ...addressPayload(d.address),
    directions_link: d.directionsLink.trim() || null,
    telehealth_link: d.telehealthLink.trim() || null,
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: allDay,
    status: d.status,
    attendees: d.attendees.map((a) =>
      a.key.startsWith('a:') ? { account_id: a.key.slice(2), is_driver: a.isDriver } : { circle_member_id: a.key.slice(2), is_driver: a.isDriver }
    ),
    interpreter_needed: d.interpreterNeeded,
    interpreter_language: d.interpreterNeeded ? d.interpreterLanguage.trim() || null : null,
    bring_document_ids: d.bringIds,
    preparation: d.preparation.trim() || null,
    ...(d.startDate ? { repeat: d.repeat, repeat_until: d.repeat !== 'once' && d.repeatUntil ? d.repeatUntil : null } : {}),
    notes: d.notes.trim() || null,
    cost_estimate: d.costEstimate.trim() === '' ? null : Number(d.costEstimate),
    cost_actual: d.costActual.trim() === '' ? null : Number(d.costActual),
    tz: browserTimeZone() ?? null,
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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-ink mb-1">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * The appointment form's fields, grouped: what and who; when; where;
 * getting there; bring and get ready; notes and cost. Choosing who it is
 * with fills in where.
 */
export function AppointmentFields({
  profileId,
  value,
  onChange,
  idPrefix = 'appt',
  errors = {},
  dateOptional = false,
  waitsOnTask = false,
}: {
  profileId: string;
  value: AppointmentDraft;
  onChange: (next: AppointmentDraft) => void;
  /** Keeps labels unique when more than one form is on screen. */
  idPrefix?: string;
  /** What is missing, shown in red under each box once Save has been tried. */
  errors?: AppointmentDraftErrors;
  /** The date can be left blank: it saves as Not booked yet with a to-do. */
  dateOptional?: boolean;
  /** Booked from a task: that task stays open until the date is known. */
  waitsOnTask?: boolean;
}) {
  const health = useHealthConfig();
  const set = (patch: Partial<AppointmentDraft>) => onChange({ ...value, ...patch });
  const [sameAsLast, setSameAsLast] = useState(false);

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
  const { data: peopleData } = usePickablePeople(profileId);
  const people = peopleData?.people ?? [];
  const { data: apptData } = useQuery({
    queryKey: ['appointments', profileId],
    queryFn: () => api.get<{ appointments: Appointment[] }>(`/care-profiles/${profileId}/appointments`),
  });
  const { data: profileData } = useQuery({
    queryKey: ['care-profile', profileId],
    queryFn: () => api.get<{ profile: { primary_language?: string | null } }>(`/care-profiles/${profileId}`),
  });
  const homeLanguage = profileData?.profile?.primary_language?.trim() ?? '';

  // Where they are is where it is: picking who it is with fills the address
  // and map link from Contacts, the same parts the address finder fills.
  const placeFrom = (provider: ProviderFull | undefined): Partial<AppointmentDraft> => {
    if (!provider) return {};
    const address = addressFrom(provider);
    return {
      ...(hasAddress(address) ? { address } : {}),
      ...(provider.directions_link ? { directionsLink: provider.directions_link } : {}),
    };
  };
  /** The people who went to the last appointment with this contact. */
  const lastPeople = (providerId: string) => {
    const last = (apptData?.appointments ?? [])
      .filter((a) => a.provider_id === providerId && (a.attendees ?? []).length > 0 && a.starts_at)
      .sort((a, b) => new Date(b.starts_at!).getTime() - new Date(a.starts_at!).getTime())[0];
    return last
      ? last.attendees!.map((p) => ({ key: p.account_id ? personKey({ account_id: p.account_id }) : personKey({ circle_member_id: p.circle_member_id! }), isDriver: p.is_driver }))
      : [];
  };
  const pickContact = (providerId: string, name: string, providerType: string, phone: string) => {
    if (!providerId) {
      set({ providerId: '', newProviderName: name, newProviderType: providerType, providerPhone: phone });
      return;
    }
    const provider = providers.find((p) => p.id === providerId);
    const going = value.attendees.length === 0 ? lastPeople(providerId) : [];
    setSameAsLast(going.length > 0);
    set({ providerId, newProviderName: '', newProviderType: '', providerPhone: phone, ...placeFrom(provider), ...(going.length ? { attendees: going } : {}) });
  };

  // Someone chosen before Contacts loaded (a follow-up, a health alert's GP)
  // still brings their address once it arrives, unless one is already set.
  useEffect(() => {
    if (!value.providerId || hasAddress(value.address) || value.directionsLink) return;
    const patch = placeFrom(providers.find((p) => p.id === value.providerId));
    if (Object.keys(patch).length) onChange({ ...value, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, value.providerId]);

  const pickedName = value.providerId ? providers.find((p) => p.id === value.providerId)?.name ?? '' : value.newProviderName;
  const going = new Map(value.attendees.map((a) => [a.key, a]));
  const toggleGoing = (key: string) => {
    setSameAsLast(false);
    set({ attendees: going.has(key) ? value.attendees.filter((a) => a.key !== key) : [...value.attendees, { key, isDriver: false }] });
  };
  const toggleDriver = (key: string) =>
    set({ attendees: value.attendees.map((a) => (a.key === key ? { ...a, isDriver: !a.isDriver } : a)) });

  return (
    <div className="space-y-6">
      <Group title="What and who">
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            id={`${idPrefix}-title`}
            label="What for"
            placeholder="e.g. Cardiology check-up"
            value={value.title}
            onChange={(e) => set({ title: e.target.value })}
            error={errors.title}
          />
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Kind</span>
            <select className={inputClass} value={value.type} onChange={(e) => set({ type: e.target.value })}>
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
        </div>
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
        <ContactPicker
          id={`${idPrefix}-with`}
          label="With"
          profileId={profileId}
          value={{ providerId: value.providerId, name: pickedName, providerType: value.newProviderType, phone: value.providerPhone }}
          onChange={(v) => pickContact(v.providerId, v.name, v.providerType, v.phone)}
        />
      </Group>

      <Group title="When">
        <div className="grid sm:grid-cols-3 gap-3">
          <Input
            id={`${idPrefix}-date`}
            label="Start date"
            type="date"
            value={value.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
            error={errors.startDate}
            hint={dateOptional && !value.startDate ? (waitsOnTask ? 'No date yet? Leave it blank. It saves as Not booked yet, and the task stays open until it has a date.' : 'No date yet? Leave it blank. It saves as Not booked yet, with a to-do to book it.') : undefined}
          />
          <Input
            id={`${idPrefix}-start`}
            label="Start time"
            type="time"
            value={value.startTime}
            onChange={(e) => set({ startTime: e.target.value })}
            hint={value.startDate && !value.startTime ? 'No time yet. It shows as any time that day.' : undefined}
          />
          <Input
            id={`${idPrefix}-end`}
            label="End time"
            type="time"
            value={value.endTime}
            onChange={(e) => set({ endTime: e.target.value })}
            hint="On the same day. Leave blank if unknown."
          />
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Repeats</span>
            <select className={inputClass} value={value.repeat} onChange={(e) => set({ repeat: e.target.value })}>
              {REPEAT_CHOICES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          {value.repeat !== 'once' ? (
            <Input
              id={`${idPrefix}-until`}
              label="Until"
              type="date"
              value={value.repeatUntil}
              onChange={(e) => set({ repeatUntil: e.target.value })}
              hint="Leave blank to keep going."
            />
          ) : null}
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Status</span>
            <select className={inputClass} value={value.status} onChange={(e) => set({ status: e.target.value })}>
              {APPOINTMENT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>
      </Group>

      <Group title="Where">
        {value.providerId && (hasAddress(value.address) || value.directionsLink) ? (
          <p className="text-xs text-muted">Filled in from who it is with. Change it if it is somewhere else.</p>
        ) : null}
        <AddressFields value={value.address} onChange={(address) => set({ address })} findLabel="Find where it is" />
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            id={`${idPrefix}-map`}
            label="Map link, optional"
            type="url"
            placeholder="e.g. a Google Maps link"
            value={value.directionsLink}
            onChange={(e) => set({ directionsLink: e.target.value })}
          />
          <Input
            id={`${idPrefix}-video`}
            label="Video call link"
            type="url"
            placeholder="Paste the link from the clinic"
            value={value.telehealthLink}
            onChange={(e) => set({ telehealthLink: e.target.value })}
            hint="For a telehealth appointment. It shows as Join the video call."
          />
        </div>
      </Group>

      <Group title="Getting there">
        <div>
          <p className="block text-sm font-medium text-ink mb-1">Who's going</p>
          {people.length === 0 ? <p className="text-xs text-muted">Nobody to pick yet.</p> : null}
          <ul className="space-y-1">
            {people.map((p) => {
              const key = personKey(p.ref);
              const on = going.get(key);
              return (
                <li key={key} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <label htmlFor={`${idPrefix}-go-${key}`} className="flex items-center gap-2 cursor-pointer">
                    <input
                      id={`${idPrefix}-go-${key}`}
                      type="checkbox"
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      checked={!!on}
                      onChange={() => toggleGoing(key)}
                    />
                    <span className="text-ink">{personOption(p)}</span>
                  </label>
                  {on ? (
                    <label htmlFor={`${idPrefix}-drive-${key}`} className="flex items-center gap-2 cursor-pointer text-muted">
                      <input
                        id={`${idPrefix}-drive-${key}`}
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={on.isDriver}
                        onChange={() => toggleDriver(key)}
                      />
                      Driving
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {sameAsLast ? <p className="mt-1 text-xs text-muted">The same people as last time.</p> : null}
        </div>
        <div className="grid sm:grid-cols-2 gap-3 items-start">
          <label htmlFor={`${idPrefix}-interp`} className="flex items-center gap-2 text-sm text-ink cursor-pointer sm:mt-7">
            <input
              id={`${idPrefix}-interp`}
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={value.interpreterNeeded}
              onChange={(e) =>
                set({
                  interpreterNeeded: e.target.checked,
                  // Their own language, when it is not English, is the one to ask for.
                  ...(e.target.checked && !value.interpreterLanguage && homeLanguage && !/^english$/i.test(homeLanguage)
                    ? { interpreterLanguage: homeLanguage }
                    : {}),
                })
              }
            />
            Interpreter needed
          </label>
          {value.interpreterNeeded ? (
            <Input
              id={`${idPrefix}-language`}
              label="Language"
              value={value.interpreterLanguage}
              onChange={(e) => set({ interpreterLanguage: e.target.value })}
              hint="Tell the clinic the language when you book. Most health services book the interpreter for free."
            />
          ) : null}
        </div>
      </Group>

      <Group title="Bring and get ready">
        <DocumentAttach
          profileId={profileId}
          idPrefix={`${idPrefix}-bring`}
          label="Documents to bring"
          value={value.bringIds}
          onChange={(bringIds) => set({ bringIds })}
          emptyText="Nothing to bring yet."
          hint="They show on the appointment and on the day."
        />
        <Textarea
          id={`${idPrefix}-prep`}
          label="How to get ready"
          rows={2}
          placeholder="e.g. Fast from 10pm. Water is fine."
          value={value.preparation}
          onChange={(e) => set({ preparation: e.target.value })}
          hint="A reminder goes out at 7pm the night before."
        />
      </Group>

      <Group title="Notes and cost">
        <Textarea id={`${idPrefix}-notes`} label="Notes" rows={2} value={value.notes} onChange={(e) => set({ notes: e.target.value })} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Input
            id={`${idPrefix}-estimate`}
            label={`Estimated cost, ${health.currency_symbol}`}
            type="number"
            min="0"
            step="any"
            value={value.costEstimate}
            onChange={(e) => set({ costEstimate: e.target.value })}
            hint="What you expect it to cost. Kept as an estimate until confirmed."
          />
          <Input
            id={`${idPrefix}-actual`}
            label={`Actual cost, ${health.currency_symbol}`}
            type="number"
            min="0"
            step="any"
            value={value.costActual}
            onChange={(e) => set({ costActual: e.target.value })}
            hint="What it actually cost. Counts as health spend once entered."
          />
        </div>
      </Group>
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
  initialBringIds = [],
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
  /** Documents to bring, ticked, e.g. the referral on the task it is booked from. */
  initialBringIds?: string[];
  /** The task or next step this appointment carries out; saving ticks it off. */
  fromReminderId?: string;
  onClose: () => void;
  /** Gets the saved appointment, e.g. so notes can be forwarded to a new one. */
  onSaved: (saved?: { id: string }, info?: { series_move: { from_starts_at: string; later: number } | null; starts_at: string | null }) => void;
}) {
  const isNew = appointment === null;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AppointmentDraft>(() =>
    appointment
      ? draftFromAppointment(appointment)
      : newAppointmentDraft({ title: initialTitle, type: initialType, providerId: initialProviderId, conditionId: initialConditionId, bringIds: initialBringIds })
  );
  const [error, setError] = useState('');
  // Errors show once Save has been tried, never while someone is still typing.
  const [tried, setTried] = useState(false);
  // A booked appointment keeps its date; a new one, or one not booked yet,
  // can be saved without it.
  const requireDate = !!appointment?.starts_at;
  const errors = tried ? appointmentDraftErrors(draft, requireDate) : {};
  // Opened to add the date: start there.
  useEffect(() => {
    if (appointment && !appointment.starts_at) {
      window.setTimeout(() => document.getElementById('appt-date')?.focus(), 50);
    }
  }, [appointment]);

  useEffect(() => {
    if (appointment) setDraft(draftFromAppointment(appointment));
  }, [appointment]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = appointmentBody(draft, isNew && fromReminderId ? fromReminderId : undefined);
      type Saved = {
        appointment: { id: string; starts_at: string | null };
        filed?: Array<{ id: string; name: string }>;
        series_move?: { from_starts_at: string; later: number } | null;
      };
      return isNew
        ? api.post<Saved>(`/care-profiles/${profileId}/appointments`, body)
        : api.patch<Saved>(`/care-profiles/${profileId}/appointments/${appointment.id}`, body);
    },
    onSuccess: (res) => {
      noticeFiled(profileId, res?.filed);
      refreshContacts(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['tasks', profileId] });
      onSaved(res?.appointment, { series_move: res?.series_move ?? null, starts_at: res?.appointment?.starts_at ?? null });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the appointment.'),
  });

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add appointment' : appointment.starts_at ? `Edit ${appointment.title}` : `Book ${appointment.title}`} wide>
      <div className="space-y-4">
        <AppointmentFields profileId={profileId} value={draft} onChange={setDraft} errors={errors} dateOptional={!requireDate} waitsOnTask={isNew && !!fromReminderId} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {tried && !draftIsBookable(draft, requireDate) ? (
          <p className="text-sm text-red-600" role="alert">{missingSentence(appointmentDraftErrors(draft, requireDate))}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={saveMutation.isPending}
            onClick={() => {
              setTried(true);
              setError('');
              const missing = appointmentDraftErrors(draft, requireDate);
              if (missing.title) document.getElementById('appt-title')?.focus();
              else if (missing.startDate) document.getElementById('appt-date')?.focus();
              if (Object.keys(missing).length === 0) saveMutation.mutate();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
