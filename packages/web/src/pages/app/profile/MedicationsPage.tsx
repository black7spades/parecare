import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { PagePurpose } from '../../../components/PagePurpose';
import { Button } from '../../../components/ui/Button';
import { EditableSubheader } from '../../../components/ui/EditableSubheader';
import { Modal } from '../../../components/ui/Modal';
import { CartIcon, CheckIcon, PackageIcon, PencilIcon, PillIcon, TrashIcon } from '../../../components/ui/icons';
import { useProfile } from './ProfileLayout';
import { EmptyState } from '../../../components/EmptyState';
import { UploadDocumentModal } from './DocumentsPage';
import { useNoticeStore } from '../../../stores/notice';
import { MedicationForm } from './medications/MedicationForm';
import { ReplenishModal } from './medications/ReplenishModal';
import { RecordChangeModal } from './medications/RecordChangeModal';
import { BulkEditModal } from './medications/BulkEditModal';
import { AdministerModal, lastGivenLine } from './medications/AdministerModal';
import { StopModal } from './medications/StopModal';
import { localNow } from './medications/shared';
import { ImportExport } from '../../../components/ImportExport';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar, type ToolbarBulkAction } from '../../../components/data/DataToolbar';
import { SortableTh } from '../../../components/data/SortableTh';
import { RecordPanel, type RecordAction, type RecordLink } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { format } from '../../../lib/dateFormat';
import { SELF_RELATIONSHIP,
  daysOfSupply,
  isLowSupply,
  regimenLine,
  supplyLabel,
  totalOnHand,
  medicationChangeWhat,
  stopReasonLabel,
  type MedicationRecord,
  type StopReason,
} from '../../../lib/care';
import { formatDateOnly } from '../../../lib/datetime';
import { ContactStrip, CONTACT_LINK } from '../../../components/ContactStrip';
import { PharmacyModal } from '../../../components/QuickAddModals';
import { bookingHref } from '../../../lib/booking';
import { useNavigate } from 'react-router-dom';
import type { ContactSummary } from '../../../lib/care';
import { askIfHome } from '../../../stores/homeDose';
import { offerDoseUndo } from '../../../lib/doseUndo';

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/**
 * The quickest way to reorder: the supplier's order site, else a call,
 * else an email with the repeat request already written.
 */
function reorderLink(
  c: ContactSummary | null,
  m: MedicationRecord,
  person: { full_name: string; date_of_birth: string | null },
  holder: string | null
): { label: string; href: string; external: boolean } | null {
  if (!c) return null;
  const order = m.supplier_order_url || c.order_link;
  if (order) return { label: `Order online from ${c.name}`, href: order, external: true };
  if (c.phone) return { label: `Call ${c.name}`, href: telHref(c.phone), external: false };
  if (c.email) {
    const what = [m.name, m.dose].filter(Boolean).join(' ');
    const born = person.date_of_birth ? `, born ${formatDateOnly(person.date_of_birth, 'd MMM yyyy')}` : '';
    const subject = `Repeat for ${person.full_name}: ${what}`;
    const body = `Hello, please prepare a repeat of ${what} for ${person.full_name}${born}. Thank you${holder ? `, ${holder}` : ''}.`;
    return { label: `Email ${c.name}`, href: `mailto:${c.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, external: false };
  }
  return null;
}

/** The account holder's name, to sign a repeat request. */
function useProfileHolder(): string | null {
  const { data } = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ display_name: string }>('/auth/me'), staleTime: 300000 });
  return data?.display_name ?? null;
}

// Domain sort/filter helpers for the reusable data view.
const earliestTime = (m: MedicationRecord): number => {
  const times = m.schedule_times ?? [];
  if (times.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...times.map((t) => { const [h, mm] = t.split(':'); return Number(h) * 60 + Number(mm); }));
};
const doseValue = (m: MedicationRecord): number => {
  const n = parseFloat(String(m.dose_amount ?? m.dose ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};
const byName = (a: MedicationRecord, b: MedicationRecord) => a.name.localeCompare(b.name);
// Missing numbers sort last (ascending); the data view reverses for descending.
const numAsc = (n: number | null): number => (n == null ? Number.POSITIVE_INFINITY : n);

const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))));

/** Who a medicine is reordered from as the table shows it: its own supplier, else their main pharmacy. */
const supplierName = (m: MedicationRecord, mainPharmacy: string | null): string => m.supplier || mainPharmacy || '';

/** A course whose last day has gone by, still on the active list. */
const courseFinished = (m: MedicationRecord): boolean =>
  m.active && !!m.course_ends_on && m.course_ends_on < format(new Date(), 'yyyy-MM-dd');

const medSorts = (mainPharmacy: string | null): DataSort<MedicationRecord>[] => [
  { key: 'default', label: 'Active first, then name', compare: (a, b) => (Number(b.active) - Number(a.active)) || byName(a, b) },
  { key: 'name', label: 'Medication', compare: byName },
  { key: 'units', label: 'Unit', compare: (a, b) => (numAsc(a.units_per_dose) - numAsc(b.units_per_dose)) || byName(a, b) },
  { key: 'dose', label: 'Dose', compare: (a, b) => (doseValue(a) - doseValue(b)) || byName(a, b) },
  { key: 'measure', label: 'Measure', compare: (a, b) => (a.dose_unit ?? '').localeCompare(b.dose_unit ?? '') || byName(a, b) },
  { key: 'route', label: 'Route', compare: (a, b) => (a.route ?? '').localeCompare(b.route ?? '') || byName(a, b) },
  { key: 'schedule', label: 'Schedule (time of day)', compare: (a, b) => (earliestTime(a) - earliestTime(b)) || byName(a, b) },
  { key: 'packs', label: 'Packs on hand', compare: (a, b) => (numAsc(a.packs_on_hand) - numAsc(b.packs_on_hand)) || byName(a, b) },
  { key: 'supply', label: 'Supply left', compare: (a, b) => (numAsc(daysOfSupply(a) ?? totalOnHand(a)) - numAsc(daysOfSupply(b) ?? totalOnHand(b))) || byName(a, b) },
  { key: 'supplier', label: 'Supplier', compare: (a, b) => (supplierName(a, mainPharmacy) || '￿').localeCompare(supplierName(b, mainPharmacy) || '￿') || byName(a, b) },
  { key: 'prescriber', label: 'Prescribed by', compare: (a, b) => (a.prescriber?.name ?? '\uffff').localeCompare(b.prescriber?.name ?? '\uffff') || byName(a, b) },
  // Missing dates sort last.
  { key: 'repeats', label: 'Repeats due', compare: (a, b) => (a.repeats_due ?? '9999').localeCompare(b.repeats_due ?? '9999') || byName(a, b) },
];

export function MedicationsPage() {
  const { profile, access, canEdit, careName, relationship, voice } = useProfile();
  const navigate = useNavigate();
  const [addingPharmacy, setAddingPharmacy] = useState(false);
  const selfCare = relationship === SELF_RELATIONSHIP;
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [uploadingScript, setUploadingScript] = useState(false);
  // ?new=1 arrives from an empty Medication record: open Add a medicine.
  const [medParams, setMedParams] = useSearchParams();
  useEffect(() => {
    if (medParams.get('new') !== '1') return;
    setAddOpen(true);
    setMedParams((prev) => { const n = new URLSearchParams(prev); n.delete('new'); return n; }, { replace: true });
  }, [medParams, setMedParams]);
  const notice = useNoticeStore((st) => st.show);
  const [editing, setEditing] = useState<MedicationRecord | null>(null);
  const [confirmBulkLog, setConfirmBulkLog] = useState(false);
  // What went wrong with the last quick action, said plainly rather than nothing.
  const [actionError, setActionError] = useState('');
  const failed = (fallback: string) => (err: unknown) => setActionError(err instanceof Error ? err.message : fallback);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  // Recording an ad-hoc dose from the list. This is the entry point for
  // as-needed medications, which have no scheduled slots to tap in the record.
  const [recording, setRecording] = useState<MedicationRecord | null>(null);
  // Recording that an ordered repeat has arrived, topping up the supply.
  const [replenishing, setReplenishing] = useState<MedicationRecord | null>(null);
  // A contributor records a change the doctor or pharmacist asked for.
  const [changing, setChanging] = useState<MedicationRecord | null>(null);
  // Stopping a medicine, from its panel or a finished course.
  const [stopping, setStopping] = useState<{ med: MedicationRecord; reason: StopReason | ''; day: string | null } | null>(null);
  // Said after a stop, with Undo.
  const [stopped, setStopped] = useState<{ med: MedicationRecord; changeId: string | null } | null>(null);
  // The management list opens expanded so the regimen is visible at a
  // glance; it can be collapsed to focus on the record below.
  const [listOpen, setListOpen] = useState(true);

  const { data } = useQuery({
    queryKey: ['medications', profile.id],
    queryFn: () =>
      api.get<{ medications: MedicationRecord[]; main_pharmacy: ContactSummary | null; main_gp: ContactSummary | null }>(
        `/care-profiles/${profile.id}/medications`
      ),
  });
  const meds = data?.medications ?? [];
  // Where to reorder: the medicine's own supplier, else their main pharmacy.
  const mainPharmacy = data?.main_pharmacy ?? null;
  const mainGp = data?.main_gp ?? null;
  const reorderFrom = (m: MedicationRecord) => m.supplier_contact ?? mainPharmacy;
  const mainPharmacyName = mainPharmacy?.name ?? null;
  const MED_SORTS = useMemo(() => medSorts(mainPharmacyName), [mainPharmacyName]);
  const holder = useProfileHolder();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['medications', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['med-chart', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['med-log', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['calendar-events', profile.id] });
    // A change citing a letter changes what that letter is attached to.
    void queryClient.invalidateQueries({ queryKey: ['documents', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['record-extras', profile.id] });
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
    options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Stopped' }],
    match: (m, v) => (v === 'active' ? m.active : !m.active),
  };

  // Deleting is held back a few seconds with Undo, never a "sure?" box.
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const hidden = useHiddenIds();
  const deleteMeds = (items: MedicationRecord[]) => {
    if (items.length === 0) return;
    deferDelete({
      message: items.length === 1 ? `Deleted ${items[0].name}.` : `Deleted ${items.length} medications.`,
      ids: items.map((m) => m.id),
      commit: () =>
        items.length === 1
          ? api.delete(`/care-profiles/${profile.id}/medications/${items[0].id}`)
          : api.post(`/care-profiles/${profile.id}/medications/bulk`, { action: 'delete', ids: items.map((m) => m.id) }),
      onCommitted: invalidate,
    });
  };

  const visible = meds.filter((m) => !hidden.has(m.id));
  const panel = useRecordPanel(visible, (m) => m.id);
  const dv = useDataView<MedicationRecord>({
    rows: visible,
    getId: (m) => m.id,
    searchText: (m) => [m.name, m.dose, m.route, m.frequency, supplierName(m, mainPharmacyName), m.prescriber?.name].filter(Boolean).join(' '),
    sorts: MED_SORTS,
    filters: [statusFilter, routeFilter],
  });

  // Record a dose now for every selected medication in one shot.
  const bulkLog = useMutation({
    mutationFn: () => api.post<{ recorded: number; ids?: string[] }>(`/care-profiles/${profile.id}/medications/administrations/batch`, {
      // Each is the prescribed dose by the prescribed route, so both checks are confirmed.
      entries: dv.selectedRows.map((m) => ({ medication_id: m.id, administered_at: new Date().toISOString(), status: 'given', right_dose: true, right_route: true })),
    }),
    onSuccess: (res) => {
      askIfHome(profile.id, res);
      setActionError('');
      setConfirmBulkLog(false);
      dv.clearSelection();
      invalidate();
      offerDoseUndo({ profileId: profile.id, ids: res?.ids, message: `${res?.recorded ?? 0} ${res?.recorded === 1 ? 'dose' : 'doses'} recorded as given.`, onChanged: invalidate });
    },
    onError: (err) => { setConfirmBulkLog(false); failed('The doses were not recorded. Try again.')(err); },
  });

  // Mark a low medication as ordered: the reorder workflow's middle state.
  const markOrdered = useMutation({
    mutationFn: (id: string) => api.post(`/care-profiles/${profile.id}/medications/${id}/reorder`, { action: 'ordered' }),
    onSuccess: () => { setActionError(''); invalidate(); },
    onError: failed('The medication was not marked as ordered. Try again.'),
  });

  // A finished course still being taken: clear the last day so its doses are due again.
  const stillTaking = useMutation({
    mutationFn: (id: string) => api.patch(`/care-profiles/${profile.id}/medications/${id}`, { course_ends_on: null }),
    onSuccess: () => { setActionError(''); invalidate(); },
    onError: failed('That did not save. Try again.'),
  });

  const restart = useMutation({
    mutationFn: (v: { id: string; undo?: string | null }) => api.post(`/care-profiles/${profile.id}/medications/${v.id}/restart`, { undo_change_id: v.undo ?? null }),
    onSuccess: () => { setActionError(''); setStopped(null); invalidate(); },
    onError: failed('The medicine was not started again. Try again.'),
  });

  const bulkSetActive = useMutation({
    mutationFn: (action: 'activate' | 'deactivate') => api.post(`/care-profiles/${profile.id}/medications/bulk`, {
      action, ids: dv.selectedRows.map((m) => m.id),
    }),
    onSuccess: () => { setActionError(''); dv.clearSelection(); invalidate(); },
    onError: failed('The medications were not changed. Try again.'),
  });

  const bulkActions: ToolbarBulkAction[] = [
    ...(canAdminister ? [{ key: 'log', label: 'Record all doses', onRun: () => setConfirmBulkLog(true) }] : []),
    ...(canManageMeds ? [
      { key: 'edit', label: 'Edit selected', onRun: () => setBulkEditOpen(true) },
      { key: 'activate', label: 'Start again', onRun: () => bulkSetActive.mutate('activate') },
      { key: 'deactivate', label: 'Stop these medicines', onRun: () => bulkSetActive.mutate('deactivate') },
    ] : []),
    ...(canBulkDelete ? [{ key: 'delete', label: 'Delete selected', destructive: true, onRun: () => { deleteMeds(dv.selectedRows); dv.clearSelection(); } }] : []),
  ];

  const colCount = canSelect ? 13 : 12;

  // As-needed medications have no fixed schedule, so they never appear as
  // due slots in the record. They live in their own group here, each with a
  // "Record dose" action so a dose taken as needed can be logged on the spot.
  const scheduledRows = dv.view.filter((m) => !m.as_needed);
  const asNeededRows = dv.view.filter((m) => m.as_needed);

  const renderRow = (m: MedicationRecord) => {
    // What's on hand overall: loose units plus unopened packs.
    const remaining = totalOnHand(m);
    const days = daysOfSupply(m);
    // Under five days of supply left (and still some in stock): worth reordering.
    const low = m.active && remaining != null && remaining > 0 && isLowSupply(m);
    // Reorder workflow: depleted (low/out and not ordered), ordered (awaiting),
    // or replenished (ordered cleared). Out of stock counts as depleted too,
    // and so does a dose found not in stock on a round.
    const foundOut = m.active && !!m.not_in_stock_admin_id;
    const depleted = foundOut || (m.active && remaining != null && (remaining <= 0 || low));
    const ordered = !!m.reorder_ordered_at;
    const orderedDays = ordered ? Math.floor((Date.now() - new Date(m.reorder_ordered_at!).getTime()) / 86400000) : 0;
    const orderedOverdue = ordered && orderedDays >= 5;
    return (
      <tr key={m.id} {...panel.rowProps(m.id)} className={`border-b border-border last:border-0 ${m.active ? '' : 'opacity-60'} ${low ? 'bg-amber-50 dark:bg-amber-900/10' : ''} ${RECORD_ROW_CLASS}`}>
        {canSelect ? (
          <td className="px-4 py-3">
            <input type="checkbox" aria-label={`Select ${m.name}`} className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={dv.selected.has(m.id)} onChange={() => dv.toggle(m.id)} />
          </td>
        ) : null}
        <td className="px-4 py-3">
          <div data-testid="med-name" className="font-medium text-ink">{m.name}{m.active ? '' : ' (stopped)'}</div>
          {m.condition_name ? <div className="text-xs text-muted">For {m.condition_name}</div> : null}
          {courseFinished(m) ? (
            <div className="mt-1 text-xs text-amber-800 dark:text-amber-200">
              Course finished on {formatDateOnly(m.course_ends_on!, 'd MMM yyyy')}.
              {canManageMeds ? (
                <span className="mt-1 flex flex-wrap gap-1">
                  <Button size="xs" variant="secondary" onClick={() => setStopping({ med: m, reason: 'finished', day: m.course_ends_on ?? null })}>Stop it</Button>
                  <Button size="xs" variant="ghost" loading={stillTaking.isPending && stillTaking.variables === m.id} onClick={() => stillTaking.mutate(m.id)}>Still taking it</Button>
                </span>
              ) : null}
            </div>
          ) : null}
        </td>
        <td className="px-4 py-3 text-muted">{m.units_per_dose != null ? fmtNum(m.units_per_dose) : '—'}</td>
        <td className="px-4 py-3 text-muted">{m.dose_amount || '—'}</td>
        <td className="px-4 py-3 text-muted">{m.dose_unit || '—'}</td>
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
          {foundOut ? (
            <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">Not in stock on the last round</span>
          ) : remaining == null ? (
            <span className="text-muted">—</span>
          ) : remaining <= 0 ? (
            <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">Out of stock</span>
          ) : (
            <span className={`text-ink ${low ? 'text-amber-700 dark:text-amber-300 font-medium' : ''}`}>
              {supplyLabel(remaining, m)} left
              {days != null ? <span className="block text-xs font-normal text-muted">{`about ${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'}`}</span> : null}
            </span>
          )}
          {ordered ? (
            <span className={`mt-1 block text-xs font-medium ${orderedOverdue ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-300'}`}>
              On order{orderedDays >= 1 ? ` ${orderedDays} day${orderedDays === 1 ? '' : 's'}` : ''}{orderedOverdue ? ' · not arrived, chase up' : ''}
            </span>
          ) : null}
        </td>
        <td className="px-4 py-3 text-muted">
          {m.supplier ? (
            <div>
              <span className="text-ink">{m.supplier}</span>
              {m.supplier_suburb ? <div className="text-xs">{m.supplier_suburb}</div> : null}
            </div>
          ) : mainPharmacy ? (
            // No supplier of its own: it is reordered from their main pharmacy, as the panel says.
            <div>
              <span className="text-ink">{mainPharmacy.name}</span>
              <div className="text-xs">Main pharmacy</div>
            </div>
          ) : <span className="text-muted">—</span>}
        </td>
        <td className="px-4 py-3 text-muted">{m.prescriber?.name ? <span className="text-ink">{m.prescriber.name}</span> : '—'}</td>
        <td className="px-4 py-3 text-muted whitespace-nowrap">{m.repeats_due ? formatDateOnly(m.repeats_due, 'd MMM yyyy') : '—'}</td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          <div className="inline-flex items-center justify-end gap-1">
            {/* Reorder workflow: order link and "mark ordered" while depleted
                and not yet ordered; "mark replenished" once on order. The cart
                links out to the supplier to place the order. */}
            {depleted && !ordered ? (() => {
              const reach = reorderLink(reorderFrom(m), m, profile, holder);
              if (!reach) {
                return canManageMeds ? (
                  <Button size="xs" variant="ghost" title="No pharmacy on file yet." onClick={() => setAddingPharmacy(true)}>Add a pharmacy</Button>
                ) : null;
              }
              return reach.external ? (
                <a
                  href={reach.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${reach.label}, ${m.name} supply is low`}
                  title={reach.label}
                  className="inline-flex items-center justify-center rounded-sm px-2 py-1 transition-colors text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                >
                  <CartIcon />
                </a>
              ) : (
                <a href={reach.href} className={`${CONTACT_LINK} text-xs px-1`} aria-label={`${reach.label} about ${m.name}`} title={reach.label}>
                  {reach.label.split(' ')[0]}
                </a>
              );
            })() : null}
            {canAdminister && depleted && !ordered ? (
              <Button size="xs" variant="ghost" aria-label={`Mark ${m.name} as ordered`} title="Mark as ordered" loading={markOrdered.isPending && markOrdered.variables === m.id} onClick={() => markOrdered.mutate(m.id)}><PackageIcon /></Button>
            ) : null}
            {canAdminister && ordered ? (
              <Button size="xs" variant="ghost" aria-label={`Mark ${m.name} as replenished`} title="Mark as replenished (arrived)" onClick={() => setReplenishing(m)}><CheckIcon /></Button>
            ) : null}
            {canAdminister ? <Button size="xs" variant="ghost" aria-label={`Record dose of ${m.name}`} title="Record dose" onClick={() => setRecording(m)}><PillIcon /></Button> : null}
            {canManageMeds ? <Button size="xs" variant="ghost" aria-label={`Edit ${m.name}`} title="Edit" onClick={() => setEditing(m)}><PencilIcon /></Button> : null}
            {canManageMeds ? <Button size="xs" variant="ghost-danger" aria-label={`Delete ${m.name}`} title="Delete" onClick={() => deleteMeds([m])}><TrashIcon /></Button> : null}
          </div>
        </td>
      </tr>
    );
  };

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
          <EditableSubheader copyKey="profile.medications.subheader" voice={voice} className="mt-1" />
        </div>
        {listOpen ? (
          <div className="flex flex-wrap gap-2 self-start sm:self-auto">
            <ImportExport
              basePath={`/care-profiles/${profile.id}/medications`}
              resource="medications"
              canImport={canManageMeds}
              onImported={invalidate}
              importNote="A medicine already on the list, with the same name and dose, is matched rather than added again: anything the file changes is updated and kept in its history, and the rest is left as it is."
              templateHeaders={['Name', 'Units per dose', 'Dose amount', 'Dose measure', 'Type', 'Route', 'With food', 'As needed', 'Times', 'How often', 'Instructions', 'Critical', 'Condition', 'As needed for', 'Hours between doses', 'Most in 24 hours', 'A full pack provides', 'Units left', 'Packs on hand', 'Repeats due', 'Supplier', 'Order link', 'Prescribed by', 'Prescriber phone', 'Repeats left', 'Last day of the course', 'Active', 'Last day taken', 'Why it stopped']}
              templateSample={['Metformin', '1', '500', 'mg', 'Tablet', 'By mouth', 'Yes', 'No', '08:00; 20:00', 'Twice a day', 'Take with a full glass of water', 'No', 'Type 2 diabetes', '', '', '', '60', '42', '2', '2026-12-01', 'City Pharmacy', 'https://citypharmacy.example/reorder', 'Dr Rachel Cohen', '03 9560 4422', '5', '', 'Yes', '', '']}
            />
            {canManageMeds && meds.length > 0 ? <Button onClick={() => setAddOpen(true)}>Add medication</Button> : null}
          </div>
        ) : null}
      </div>

      {canAdminister && !canManageMeds ? (
        <p className="text-xs text-muted">
          Only the profile owner or an admin can add or delete medicines.{profile.manager_name ? ` ${profile.manager_name} can do it.` : ''} Record a change to a dose or its times from the medicine itself.
        </p>
      ) : null}

      {stopped ? (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-md border-l-4 border-primary bg-primary-50 px-4 py-2 text-sm text-ink" role="status">
          <span>Stopped {stopped.med.name}.</span>
          <span className="flex gap-1">
            <Button size="xs" variant="secondary" loading={restart.isPending} onClick={() => restart.mutate({ id: stopped.med.id, undo: stopped.changeId })}>Undo</Button>
            <Button size="xs" variant="ghost" onClick={() => setStopped(null)}>Dismiss</Button>
          </span>
        </div>
      ) : null}

      {actionError ? (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-md border-l-4 border-red-400 bg-red-50 dark:bg-red-900/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          <span>{actionError}</span>
          <Button size="xs" variant="ghost" onClick={() => setActionError('')}>Dismiss</Button>
        </div>
      ) : null}

      {listOpen && data && meds.length === 0 ? (
        <EmptyState
          says={`Medicines ${voice.subject} ${voice.isSelf ? 'take go' : 'takes go'} here, with when and how much. Add the first one, or upload a script or a pharmacy list.`}
          actionLabel="Add a medicine"
          onAction={() => setAddOpen(true)}
          canAdd={canManageMeds}
          access={access}
          name={careName}
          page="Medicines page"
          managerName={profile.manager_name}
          extra={<Button variant="secondary" onClick={() => setUploadingScript(true)}>Upload a script</Button>}
        />
      ) : null}
      {uploadingScript ? (
        <UploadDocumentModal
          profileId={profile.id}
          initialFile={null}
          initialCategoryKey="prescription"
          onClose={() => setUploadingScript(false)}
          onUploaded={(doc) => {
            setUploadingScript(false);
            notice({ message: `${doc.label} is saved in Documents. Add each medicine on it with Add a medicine.` });
          }}
        />
      ) : null}
      {listOpen && meds.length > 0 ? (
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
                  <SortableTh label="Medication" sortKey="name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-4 py-3" />
                  <SortableTh label="Unit" sortKey="units" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-4 py-3" />
                  <SortableTh label="Dose" sortKey="dose" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-4 py-3" />
                  <SortableTh label="Measure" sortKey="measure" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-4 py-3" />
                  <SortableTh label="Route" sortKey="route" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-4 py-3" />
                  <SortableTh label="Schedule" sortKey="schedule" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-4 py-3" />
                  <SortableTh label="Packs on hand" sortKey="packs" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-4 py-3" />
                  <SortableTh label="Supply left" sortKey="supply" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-4 py-3" />
                  <SortableTh label="Supplier" sortKey="supplier" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-4 py-3" />
                  <SortableTh label="Prescribed by" sortKey="prescriber" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-4 py-3" />
                  <SortableTh label="Repeats due" sortKey="repeats" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} className="px-4 py-3" />
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dv.view.length === 0 ? (
                  <tr><td colSpan={colCount} className="px-4 py-8 text-center text-muted">{meds.length === 0 ? 'No medications recorded yet.' : 'No medications match your search or filters.'}</td></tr>
                ) : (
                  <>
                    {scheduledRows.map(renderRow)}
                    {asNeededRows.length > 0 ? (
                      <>
                        <tr className="bg-surface border-y border-border">
                          <td colSpan={colCount} className="px-4 py-2 text-xs font-medium text-muted">
                            As needed · taken only when required, on no fixed schedule
                          </td>
                        </tr>
                        {asNeededRows.map(renderRow)}
                      </>
                    ) : null}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className="pt-2">
        <p className="text-sm text-muted">
          Looking for dose logging? The{' '}
          <Link to="../mar" className={`${CONTACT_LINK}`}>Medication record</Link>{' '}
          is under Management, where each dose given is logged and reviewed.
        </p>
      </div>

      {recording ? (
        <AdministerModal
          profileId={profile.id}
          med={recording}
          personName={careName}
          maxWhen={localNow()}
          onClose={() => setRecording(null)}
          onSaved={() => { setRecording(null); invalidate(); }}
        />
      ) : null}

      {stopping ? (
        <StopModal
          profileId={profile.id}
          med={stopping.med}
          initialReason={stopping.reason}
          initialDay={stopping.day}
          onClose={() => setStopping(null)}
          onStopped={(changeId) => {
            setStopped({ med: stopping.med, changeId });
            setStopping(null);
            // Back to the list, where "Stopped" and its Undo show.
            if (panel.current) panel.close();
            invalidate();
          }}
        />
      ) : null}

      {changing ? (
        <RecordChangeModal
          profileId={profile.id}
          med={changing}
          onClose={() => setChanging(null)}
          onSaved={() => { setChanging(null); invalidate(); }}
        />
      ) : null}

      {replenishing ? (
        <ReplenishModal
          profileId={profile.id}
          med={replenishing}
          onClose={() => setReplenishing(null)}
          onSaved={() => { setReplenishing(null); invalidate(); }}
        />
      ) : null}

      {addOpen ? <MedicationForm profileId={profile.id} selfCare={selfCare} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); invalidate(); }} /> : null}
      {editing ? <MedicationForm profileId={profile.id} med={editing} selfCare={selfCare} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} /> : null}
      <PharmacyModal profileId={profile.id} open={addingPharmacy} onClose={() => setAddingPharmacy(false)} onSaved={invalidate} />
      {bulkEditOpen ? <BulkEditModal profileId={profile.id} meds={dv.selectedRows} onClose={() => setBulkEditOpen(false)} onSaved={() => { setBulkEditOpen(false); dv.clearSelection(); invalidate(); }} /> : null}

      {panel.current ? (() => {
        const m = panel.current;
        const remaining = totalOnHand(m);
        const days = daysOfSupply(m);
        const low = m.active && remaining != null && remaining > 0 && isLowSupply(m);
        const depleted = (m.active && !!m.not_in_stock_admin_id) || (m.active && remaining != null && (remaining <= 0 || low));
        const ordered = !!m.reorder_ordered_at;
        const extra: RecordAction[] = [
          ...(canAdminister ? [{ label: 'Record a dose', onRun: () => setRecording(m) }] : []),
          ...(canAdminister && !canManageMeds && m.active ? [{ label: 'Record a change', onRun: () => setChanging(m) }] : []),
          ...(canAdminister && depleted && !ordered
            ? [{ label: 'Mark as ordered', onRun: () => markOrdered.mutate(m.id), pending: markOrdered.isPending && markOrdered.variables === m.id }]
            : []),
          ...(canAdminister && ordered ? [{ label: 'Mark as arrived', onRun: () => setReplenishing(m) }] : []),
          ...(canManageMeds && m.active ? [{ label: 'Stop this medicine', onRun: () => setStopping({ med: m, reason: '', day: null }) }] : []),
          ...(canManageMeds && !m.active
            ? [{ label: 'Start again', onRun: () => restart.mutate({ id: m.id }), pending: restart.isPending && restart.variables?.id === m.id }]
            : []),
        ];
        const links: RecordLink[] = [
          ...(m.medical_condition_id && m.condition_name
            ? [{ label: 'For', value: m.condition_name, to: `/app/${profile.id}/conditions?record=${m.medical_condition_id}` }]
            : []),
          ...(m.source_appointment
            ? [{ label: 'Started at', value: m.source_appointment.title, to: `/app/${profile.id}/appointments?record=${m.source_appointment.id}` }]
            : []),
        ];
        // Who writes the script, else their main GP, books the visit for scripts.
        const scriptsWith = m.prescriber ?? mainGp;
        const supplierShown = reorderFrom(m);
        const reach = depleted && !ordered ? reorderLink(supplierShown, m, profile, holder) : null;
        return (
          <RecordPanel
            key={m.id}
            kindLabel="Medication"
            title={m.name}
            subtitle={regimenLine(m) || undefined}
            kind="medications"
            recordId={m.id}
            profileId={profile.id}
            canEdit={canAdminister}
            fields={[
              { label: 'Units per dose', value: m.units_per_dose != null ? fmtNum(m.units_per_dose) : null },
              { label: 'Dose', value: m.dose_amount },
              { label: 'Measure', value: m.dose_unit },
              { label: 'Type', value: m.form },
              { label: 'Route', value: m.route },
              { label: 'With food', value: m.with_food ? 'Yes' : null },
              { label: 'As needed', value: m.as_needed ? 'Yes, only when required' : null },
              { label: 'Times', value: !m.as_needed && m.schedule_times?.length ? m.schedule_times.join(', ') : null },
              { label: 'How often', value: m.frequency },
              { label: 'Instructions', value: m.instructions },
              { label: 'As needed for', value: m.as_needed ? m.as_needed_for ?? null : null },
              { label: 'Hours between doses', value: m.min_hours_between_doses != null ? `At least ${m.min_hours_between_doses}` : null },
              { label: 'Most in 24 hours', value: m.max_doses_per_day != null ? String(m.max_doses_per_day) : null },
              { label: 'Last given', value: m.dose_history ? lastGivenLine(m) : null },
              { label: 'Pack size', value: m.supply != null ? supplyLabel(m.supply, m) : null },
              { label: 'Loose units left', value: m.supply_remaining != null ? supplyLabel(m.supply_remaining, m) : null },
              { label: 'Packs on hand', value: m.packs_on_hand != null ? fmtNum(m.packs_on_hand) : null },
              { label: 'Supply left', value: remaining == null ? null : remaining <= 0 ? 'Out of stock' : supplyLabel(remaining, m) },
              { label: 'Days left', value: days != null ? `About ${Math.floor(days)}` : null },
              { label: 'Supplier branch', value: m.supplier_suburb },
              { label: 'On order since', value: m.reorder_ordered_at ? format(new Date(m.reorder_ordered_at), 'd MMM yyyy') : null },
              { label: 'Next repeat due', value: m.repeats_due ? formatDateOnly(m.repeats_due, 'd MMM yyyy') : null },
              { label: 'Repeats left on the script', value: m.repeats_left != null ? String(m.repeats_left) : null },
              { label: 'Last day of the course', value: m.course_ends_on ? formatDateOnly(m.course_ends_on, 'd MMM yyyy') : null },
              { label: 'Dangerous to miss', value: m.critical ? 'Yes' : null },
              { label: 'Status', value: m.active ? 'Active' : 'Stopped' },
              { label: 'Last day taken', value: !m.active && m.stopped_on ? formatDateOnly(m.stopped_on, 'd MMM yyyy') : null },
              { label: 'Why it stopped', value: !m.active ? stopReasonLabel(m.stop_reason) : null },
              { label: 'In their words', value: !m.active ? m.stop_notes : null },
            ]}
            links={links}
            onEdit={canManageMeds ? () => setEditing(m) : undefined}
            extra={extra}
            onDelete={canManageMeds ? () => { deleteMeds([m]); panel.close(); } : undefined}
            onClose={panel.close}
          >
            {courseFinished(m) ? (
              <section className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/10 p-3">
                <p className="text-sm text-ink">Course finished on {formatDateOnly(m.course_ends_on!, 'd MMM yyyy')}.</p>
                {canManageMeds ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setStopping({ med: m, reason: 'finished', day: m.course_ends_on ?? null })}>Stop it</Button>
                    <Button size="sm" variant="ghost" loading={stillTaking.isPending} onClick={() => stillTaking.mutate(m.id)}>Still taking it</Button>
                  </div>
                ) : null}
              </section>
            ) : null}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Changes</h3>
              {(m.changes ?? []).length ? (
                <ul className="space-y-1.5 text-sm text-ink">
                  {(m.changes ?? []).map((c) => (
                    <li key={c.id}>
                      <span className="font-medium">{formatDateOnly(c.changed_on, 'd MMM yyyy')}:</span> {medicationChangeWhat(c)}.
                      {c.reason ? ` ${c.reason.replace(/\.$/, '')}.` : ''}
                      {c.source_appointment_id && c.source_appointment_title ? (
                        <> From <Link to={`/app/${profile.id}/appointments?record=${c.source_appointment_id}`} className={CONTACT_LINK}>{c.source_appointment_title}</Link>.</>
                      ) : c.source_document_id && c.source_document_label ? (
                        <> From <Link to={`/app/${profile.id}/documents?record=${c.source_document_id}`} className={CONTACT_LINK}>{c.source_document_label}</Link>.</>
                      ) : null}
                      {c.source_provider_name ? ` ${c.source_provider_name} said so.` : ''}
                      {c.changed_by_name ? <span className="text-xs text-muted"> Recorded by {c.changed_by_name}.</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No changes recorded yet. A change to the dose or times is kept here with why.</p>
              )}
            </section>
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Prescribed by</h3>
              {m.prescriber ? (
                <ContactStrip contact={m.prescriber} profileId={profile.id} book={false} />
              ) : (
                <p className="text-sm text-muted">
                  No prescriber on file yet.{canManageMeds ? ' Choose Edit to add who writes the script.' : ''}
                </p>
              )}
              {scriptsWith?.id && scriptsWith.source === 'contact' && canEdit ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() =>
                    navigate(
                      bookingHref(profile.id, {
                        provider: scriptsWith.id,
                        title: `Scripts for ${m.name}`,
                        type: 'consultation',
                        condition: m.medical_condition_id ?? undefined,
                      })
                    )
                  }
                >
                  Book a visit for scripts
                </Button>
              ) : null}
            </section>
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Supplier</h3>
              {supplierShown ? (
                <>
                  {!m.supplier_contact ? <p className="text-xs text-muted mb-1">Their main pharmacy.</p> : null}
                  <ContactStrip contact={supplierShown} profileId={profile.id} book={false} />
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-muted">No pharmacy on file yet.</p>
                  {canManageMeds ? <Button size="xs" variant="secondary" onClick={() => setAddingPharmacy(true)}>Add a pharmacy</Button> : null}
                </div>
              )}
              {reach ? (
                <p className="mt-2 text-sm">
                  <a
                    href={reach.href}
                    {...(reach.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className={CONTACT_LINK}
                  >
                    {reach.label}
                  </a>
                  <span className="text-muted">, then Mark as ordered.</span>
                </p>
              ) : null}
            </section>
          </RecordPanel>
        );
      })() : null}

      <Modal open={confirmBulkLog} onClose={() => setConfirmBulkLog(false)} title="Record all doses">
        <p className="text-sm text-muted mb-4">
          Record a dose as given, now, for <span className="font-medium text-ink">{dv.selectedRows.length}</span> selected
          medication{dv.selectedRows.length === 1 ? '' : 's'}? Each is written in the medication record for {profile.full_name}.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmBulkLog(false)}>Cancel</Button>
          <Button loading={bulkLog.isPending} onClick={() => bulkLog.mutate()}>Record {dv.selectedRows.length}</Button>
        </div>
      </Modal>
    </div>
  );
}

