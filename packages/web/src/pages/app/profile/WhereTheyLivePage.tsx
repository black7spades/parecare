import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { ContactStrip } from '../../../components/ContactStrip';
import { useDataView, type DataSort } from '../../../components/data/useDataView';
import { DataToolbar } from '../../../components/data/DataToolbar';
import { SortableTh } from '../../../components/data/SortableTh';
import { RecordPanel } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { DischargeModal, HospitalStayModal, invalidateStays } from '../../../components/HospitalStayForms';
import { MoveIntoCareModal } from '../../../components/CareMoveForms';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { formatDateOnly } from '../../../lib/datetime';
import { residenceTypeLabel, type CareProfile } from '../../../lib/care';
import type { CareMove, HospitalStay } from '../../../lib/lifeEvents';
import { EditProfileModal } from './EditProfileModal';
import { useProfile } from './ProfileLayout';

const byText = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').localeCompare(b ?? '');
const byDay = (a: string | null | undefined, b: string | null | undefined) => (a ?? '9999').localeCompare(b ?? '9999');

const STAY_SORTS: DataSort<HospitalStay>[] = [
  { key: 'stay_in', label: 'Went in on', compare: (a, b) => byDay(a.admitted_on, b.admitted_on), defaultDir: 'desc' },
  { key: 'stay_hospital', label: 'Hospital', compare: (a, b) => byText(a.hospital?.name, b.hospital?.name) },
  { key: 'stay_out', label: 'Left on', compare: (a, b) => byDay(a.discharged_on, b.discharged_on) },
  { key: 'stay_ward', label: 'Ward', compare: (a, b) => byText(a.ward, b.ward) },
  { key: 'stay_team', label: 'Treating team', compare: (a, b) => byText(a.treating_team, b.treating_team) },
  { key: 'stay_why', label: 'Why', compare: (a, b) => byText(a.reason, b.reason) },
];

const MOVE_SORTS: DataSort<CareMove>[] = [
  { key: 'move_in', label: 'Moved in on', compare: (a, b) => byDay(a.entry_on, b.entry_on), defaultDir: 'desc' },
  { key: 'move_home', label: 'Care home', compare: (a, b) => byText(a.facility?.name, b.facility?.name) },
  { key: 'move_payment', label: 'Payment', compare: (a, b) => byText(a.payment_label, b.payment_label) },
  { key: 'move_decide', label: 'Decide by', compare: (a, b) => byDay(a.payment_choice_due_on, b.payment_choice_due_on) },
];

/**
 * Where someone lives: their home now, the home they left, their hospital
 * stays and their moves into care, on one page.
 */
export function WhereTheyLivePage() {
  const { profile, careName, canEdit, canEditProfile, isSelf, openStay } = useProfile();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [stayForm, setStayForm] = useState<{ stay: HospitalStay | null } | null>(null);
  const [discharging, setDischarging] = useState<{ id: string; hospital: string | null } | null>(null);
  const [moveForm, setMoveForm] = useState<{ move: CareMove | null } | null>(null);
  const [editingHome, setEditingHome] = useState(false);

  const { data: staysData, isLoading: staysLoading } = useQuery({
    queryKey: ['hospital-stays', profile.id],
    queryFn: () => api.get<{ stays: HospitalStay[] }>(`/care-profiles/${profile.id}/hospital-stays`),
  });
  const { data: movesData } = useQuery({
    queryKey: ['care-moves', profile.id],
    queryFn: () => api.get<{ moves: CareMove[]; previous_homes: Array<{ id: string; formatted: string | null }> }>(`/care-profiles/${profile.id}/care-moves`),
  });

  // Opened from elsewhere: Edit profile's "Record a short stay", or an alert's "Record the discharge".
  useEffect(() => {
    const stay = params.get('stay');
    const discharge = params.get('discharge');
    if (!stay && !discharge) return;
    if (stay === 'new' && canEdit) setStayForm({ stay: null });
    if (discharge && canEdit) setDischarging({ id: discharge, hospital: openStay?.hospital_name ?? null });
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('stay');
      next.delete('discharge');
      return next;
    }, { replace: true });
  }, [params, setParams, canEdit, openStay]);

  const hidden = useHiddenIds();
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const stays = (staysData?.stays ?? []).filter((s) => !hidden.has(s.id));
  const moves = (movesData?.moves ?? []).filter((m) => !hidden.has(m.id));
  const previousHomes = movesData?.previous_homes ?? [];

  const stayDv = useDataView<HospitalStay>({
    rows: stays,
    getId: (s) => s.id,
    searchText: (s) => [s.hospital?.name, s.ward, s.treating_team, s.reason].filter(Boolean).join(' '),
    sorts: STAY_SORTS,
    filters: [],
  });
  const moveDv = useDataView<CareMove>({
    rows: moves,
    getId: (m) => m.id,
    searchText: (m) => [m.facility?.name, m.payment_label].filter(Boolean).join(' '),
    sorts: MOVE_SORTS,
    filters: [],
  });
  const stayPanel = useRecordPanel(stays, (s) => s.id);
  const movePanel = useRecordPanel(moves, (m) => m.id);

  const deleteStay = (s: HospitalStay) =>
    deferDelete({
      message: `Deleted the stay at ${s.hospital?.name ?? 'hospital'}.`,
      ids: [s.id],
      commit: () => api.delete(`/care-profiles/${profile.id}/hospital-stays/${s.id}`),
      onCommitted: () => invalidateStays(queryClient, profile.id),
    });
  const deleteMove = (m: CareMove) =>
    deferDelete({
      message: `Deleted the move into ${m.facility?.name ?? 'care'}.`,
      ids: [m.id],
      commit: () => api.delete(`/care-profiles/${profile.id}/care-moves/${m.id}`),
      onCommitted: () => {
        void queryClient.invalidateQueries({ queryKey: ['care-moves', profile.id] });
        void queryClient.invalidateQueries({ queryKey: ['care-profile', profile.id] });
        void queryClient.invalidateQueries({ queryKey: ['tasks', profile.id] });
      },
    });

  const title = isSelf ? 'Where I live' : 'Where they live';
  const nothingYet = !staysLoading && stays.length === 0 && moves.length === 0 && !profile.residence_type && previousHomes.length === 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="text-xs text-muted">Home, hospital stays and moves into care, in one place.</p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setMoveForm({ move: null })}>Move into care</Button>
            {openStay ? null : <Button size="sm" onClick={() => setStayForm({ stay: null })}>Record a hospital stay</Button>}
          </div>
        ) : null}
      </div>

      {nothingYet ? (
        <div className="card text-center py-10 space-y-3">
          <p className="text-sm text-ink">Home, hospital stays and moves go here.</p>
          {canEdit ? <Button onClick={() => setStayForm({ stay: null })}>Record a hospital stay</Button> : null}
        </div>
      ) : null}

      {!nothingYet ? <HomeCard profile={profile} previousHomes={previousHomes} canEdit={canEditProfile} onEdit={() => setEditingHome(true)} careName={careName} /> : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Hospital stays</h3>
        {stays.length > 0 ? (
          <>
            <DataToolbar
              search={stayDv.search}
              onSearch={stayDv.setSearch}
              searchPlaceholder="Search hospital stays…"
              sorts={STAY_SORTS.map((s) => ({ key: s.key, label: s.label }))}
              sortKey={stayDv.sortKey}
              onSort={stayDv.setSortKey}
              page={stayDv.page}
              totalPages={stayDv.totalPages}
              pageSize={stayDv.pageSize}
              totalFiltered={stayDv.totalFiltered}
              onPageChange={stayDv.setPage}
              onPageSizeChange={stayDv.setPageSize}
            />
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-border">
                    <SortableTh label="Hospital" sortKey="stay_hospital" activeKey={stayDv.sortKey} dir={stayDv.sortDir} onToggle={stayDv.toggleSort} />
                    <SortableTh label="Went in on" sortKey="stay_in" activeKey={stayDv.sortKey} dir={stayDv.sortDir} onToggle={stayDv.toggleSort} />
                    <SortableTh label="Left on" sortKey="stay_out" activeKey={stayDv.sortKey} dir={stayDv.sortDir} onToggle={stayDv.toggleSort} />
                    <SortableTh label="Ward" sortKey="stay_ward" activeKey={stayDv.sortKey} dir={stayDv.sortDir} onToggle={stayDv.toggleSort} />
                    <SortableTh label="Treating team" sortKey="stay_team" activeKey={stayDv.sortKey} dir={stayDv.sortDir} onToggle={stayDv.toggleSort} />
                    <SortableTh label="Why" sortKey="stay_why" activeKey={stayDv.sortKey} dir={stayDv.sortDir} onToggle={stayDv.toggleSort} />
                    {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {stayDv.view.map((s) => (
                    <tr key={s.id} {...stayPanel.rowProps(s.id)} className={`border-b border-border last:border-0 align-top ${RECORD_ROW_CLASS}`}>
                      <td className="px-3 py-2 font-medium text-ink">{s.hospital?.name ?? 'Hospital'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateOnly(s.admitted_on)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{s.discharged_on ? formatDateOnly(s.discharged_on) : <span className="text-amber-700 dark:text-amber-300">Still there</span>}</td>
                      <td className="px-3 py-2">{s.ward ?? ''}</td>
                      <td className="px-3 py-2">{s.treating_team ?? ''}</td>
                      <td className="px-3 py-2 text-muted">{s.reason ?? ''}</td>
                      {canEdit ? (
                        <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                          {!s.discharged_on ? (
                            <Button size="xs" variant="secondary" onClick={() => setDischarging({ id: s.id, hospital: s.hospital?.name ?? null })}>Record the discharge</Button>
                          ) : null}
                          <Button size="xs" variant="ghost" aria-label={`Edit the stay at ${s.hospital?.name ?? 'hospital'}`} title="Edit" onClick={() => setStayForm({ stay: s })}><PencilIcon /></Button>
                          <Button size="xs" variant="ghost-danger" aria-label={`Delete the stay at ${s.hospital?.name ?? 'hospital'}`} title="Delete" onClick={() => deleteStay(s)}><TrashIcon /></Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">No hospital stays recorded.</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Moves into care</h3>
        {moves.length > 0 ? (
          <>
            <DataToolbar
              search={moveDv.search}
              onSearch={moveDv.setSearch}
              searchPlaceholder="Search moves…"
              sorts={MOVE_SORTS.map((s) => ({ key: s.key, label: s.label }))}
              sortKey={moveDv.sortKey}
              onSort={moveDv.setSortKey}
              page={moveDv.page}
              totalPages={moveDv.totalPages}
              pageSize={moveDv.pageSize}
              totalFiltered={moveDv.totalFiltered}
              onPageChange={moveDv.setPage}
              onPageSizeChange={moveDv.setPageSize}
            />
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-border">
                    <SortableTh label="Care home" sortKey="move_home" activeKey={moveDv.sortKey} dir={moveDv.sortDir} onToggle={moveDv.toggleSort} />
                    <SortableTh label="Moved in on" sortKey="move_in" activeKey={moveDv.sortKey} dir={moveDv.sortDir} onToggle={moveDv.toggleSort} />
                    <SortableTh label="Payment" sortKey="move_payment" activeKey={moveDv.sortKey} dir={moveDv.sortDir} onToggle={moveDv.toggleSort} />
                    <SortableTh label="Decide by" sortKey="move_decide" activeKey={moveDv.sortKey} dir={moveDv.sortDir} onToggle={moveDv.toggleSort} />
                    {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {moveDv.view.map((m) => (
                    <tr key={m.id} {...movePanel.rowProps(m.id)} className={`border-b border-border last:border-0 align-top ${RECORD_ROW_CLASS}`}>
                      <td className="px-3 py-2 font-medium text-ink">{m.facility?.name ?? 'Care home'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateOnly(m.entry_on)}</td>
                      <td className="px-3 py-2">{m.payment_label ?? <span className="text-muted">Not decided yet</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{m.payment_choice ? '' : formatDateOnly(m.payment_choice_due_on)}</td>
                      {canEdit ? (
                        <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                          <Button size="xs" variant="ghost" aria-label={`Edit the move into ${m.facility?.name ?? 'care'}`} title="Edit" onClick={() => setMoveForm({ move: m })}><PencilIcon /></Button>
                          <Button size="xs" variant="ghost-danger" aria-label={`Delete the move into ${m.facility?.name ?? 'care'}`} title="Delete" onClick={() => deleteMove(m)}><TrashIcon /></Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">No moves into care recorded.</p>
        )}
      </section>

      {stayPanel.current ? (() => {
        const s = stayPanel.current;
        return (
          <RecordPanel
            key={s.id}
            kindLabel="Hospital stay"
            title={s.hospital?.name ?? 'Hospital stay'}
            subtitle={`Went in on ${formatDateOnly(s.admitted_on)}`}
            kind="hospital-stays"
            recordId={s.id}
            profileId={profile.id}
            canEdit={canEdit}
            fields={[
              { label: 'Went in on', value: formatDateOnly(s.admitted_on) },
              { label: 'Left hospital on', value: s.discharged_on ? formatDateOnly(s.discharged_on) : 'Still there' },
              { label: 'Ward', value: s.ward },
              { label: 'Treating team', value: s.treating_team },
              { label: 'Why they went in', value: s.reason },
              {
                label: 'Discharge letter',
                value: s.discharge_document ? (
                  <Link to={`/app/${profile.id}/documents?record=${s.discharge_document.id}`} className="text-primary hover:underline">{s.discharge_document.label ?? 'Discharge letter'}</Link>
                ) : null,
              },
            ]}
            links={[
              ...(s.follow_up_task ? [{ label: 'GP follow-up', value: s.follow_up_task.title, to: `/app/${profile.id}/tasks?record=${s.follow_up_task.id}` }] : []),
              ...(s.plan_review_task ? [{ label: 'Care plan', value: s.plan_review_task.title, to: `/app/${profile.id}/tasks?record=${s.plan_review_task.id}` }] : []),
            ]}
            onEdit={() => setStayForm({ stay: s })}
            done={!s.discharged_on ? { label: 'Record the discharge', onRun: () => setDischarging({ id: s.id, hospital: s.hospital?.name ?? null }) } : null}
            onDelete={() => {
              deleteStay(s);
              stayPanel.close();
            }}
            onClose={stayPanel.close}
          >
            {s.hospital ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Hospital</h3>
                <ContactStrip contact={s.hospital} profileId={profile.id} book={false} />
              </section>
            ) : null}
          </RecordPanel>
        );
      })() : null}

      {movePanel.current ? (() => {
        const m = movePanel.current;
        return (
          <RecordPanel
            key={m.id}
            kindLabel="Move into care"
            title={m.facility?.name ?? 'Move into care'}
            subtitle={m.entry_on ? `Moved in on ${formatDateOnly(m.entry_on)}` : undefined}
            kind="care-moves"
            recordId={m.id}
            profileId={profile.id}
            canEdit={canEdit}
            fields={[
              { label: 'Moved in on', value: formatDateOnly(m.entry_on) },
              { label: 'Agreement signed on', value: formatDateOnly(m.agreement_signed_on) },
              {
                label: 'Cooling-off ends',
                value: m.cooling_off_ends_on ? (
                  <span>
                    {formatDateOnly(m.cooling_off_ends_on)}
                    {m.cooling_off_worked_out ? <span className="block text-xs text-muted">Worked out as 14 days after signing.</span> : null}
                  </span>
                ) : null,
              },
              { label: 'How the room is paid for', value: m.payment_label ?? 'Not decided yet' },
              {
                label: 'Decide by',
                value: !m.payment_choice && m.payment_choice_due_on ? (
                  <span>
                    {formatDateOnly(m.payment_choice_due_on)}
                    {m.payment_due_worked_out ? <span className="block text-xs text-muted">Worked out as 28 days after moving in.</span> : null}
                  </span>
                ) : null,
              },
              { label: 'Notice given on', value: formatDateOnly(m.notice_given_on) },
              { label: 'Leaving on', value: formatDateOnly(m.leaving_on) },
              { label: 'Previous home', value: m.previous_address?.formatted ?? null },
            ]}
            onEdit={() => setMoveForm({ move: m })}
            onDelete={() => {
              deleteMove(m);
              movePanel.close();
            }}
            onClose={movePanel.close}
          >
            {m.facility ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Care home</h3>
                <ContactStrip contact={m.facility} profileId={profile.id} book={false} />
              </section>
            ) : null}
          </RecordPanel>
        );
      })() : null}

      {stayForm ? <HospitalStayModal profileId={profile.id} stay={stayForm.stay} onClose={() => setStayForm(null)} /> : null}
      {discharging ? <DischargeModal profileId={profile.id} stayId={discharging.id} hospitalName={discharging.hospital} onClose={() => setDischarging(null)} /> : null}
      {moveForm ? <MoveIntoCareModal profileId={profile.id} move={moveForm.move} roomNumber={profile.room_number} onClose={() => setMoveForm(null)} /> : null}
      {canEditProfile ? <EditProfileModal profile={profile} open={editingHome} onClose={() => setEditingHome(false)} /> : null}
    </div>
  );
}

/** Where they live now, and the home they left. */
function HomeCard({
  profile,
  previousHomes,
  canEdit,
  onEdit,
  careName,
}: {
  profile: CareProfile;
  previousHomes: Array<{ id: string; formatted: string | null }>;
  canEdit: boolean;
  onEdit: () => void;
  careName: string;
}) {
  const address = [profile.address_line1, profile.address_line2, profile.address_suburb, profile.address_state, profile.address_postcode].filter(Boolean).join(', ');
  const facility = profile.residence_provider;
  const room = [profile.room_number ? `Room ${profile.room_number}` : null, profile.room_area_name].filter(Boolean).join(', ');
  return (
    <section className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Home</h3>
          <p className="text-xs text-muted">{profile.residence_type ? residenceTypeLabel(profile.residence_type) : `Where ${careName} lives is not set yet.`}</p>
        </div>
        {canEdit ? <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button> : null}
      </div>
      {facility ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">{facility.name}</p>
          {room ? <p className="text-sm text-ink">{room}</p> : null}
          {facility.phone ? (
            <a href={`tel:${facility.phone.replace(/[^\d+]/g, '')}`} className="text-sm text-primary hover:underline" aria-label={`Call ${facility.name} on ${facility.phone}`}>{facility.phone}</a>
          ) : null}
          {facility.address ? <p className="text-xs text-muted">{facility.address}</p> : null}
        </div>
      ) : address ? (
        <p className="text-sm text-ink">{address}</p>
      ) : null}
      {facility && address ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Home address</p>
          <p className="text-sm text-ink">{address}</p>
        </div>
      ) : null}
      {previousHomes.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Previous home</p>
          {previousHomes.map((h) => (
            <p key={h.id} className="text-sm text-ink">{h.formatted}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
