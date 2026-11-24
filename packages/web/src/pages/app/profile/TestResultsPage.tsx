import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { CONTACT_LINK, ContactStrip } from '../../../components/ContactStrip';
import { useDataView, type DataSort } from '../../../components/data/useDataView';
import { DataToolbar } from '../../../components/data/DataToolbar';
import { SortableTh } from '../../../components/data/SortableTh';
import { RecordPanel } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { ResultEditor } from '../../../components/ResultEditor';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { formatDateOnly } from '../../../lib/datetime';
import { bookingHref } from '../../../lib/booking';
import { DOCTOR_VIEWS, doctorViewLabel, firstName, flagLabel, whose, type ResultValue, type TestResult } from '../../../lib/lifeEvents';
import { useProfile } from './ProfileLayout';

const byText = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').localeCompare(b ?? '');
const byDay = (a: string | null | undefined, b: string | null | undefined) => (a ?? '0000').localeCompare(b ?? '0000');
const reviewWhen = (r: TestResult) => r.review_appointment?.starts_at ?? null;

const SORTS: DataSort<TestResult>[] = [
  { key: 'collected', label: 'Collected on', compare: (a, b) => byDay(a.collected_on, b.collected_on), defaultDir: 'desc' },
  { key: 'test', label: 'Test', compare: (a, b) => a.test_name.localeCompare(b.test_name) },
  { key: 'reported', label: 'Results came on', compare: (a, b) => byDay(a.reported_on, b.reported_on) },
  { key: 'view', label: 'What the doctor said', compare: (a, b) => byText(doctorViewLabel(a.doctor_view), doctorViewLabel(b.doctor_view)) },
  { key: 'ordered', label: 'Ordered by', compare: (a, b) => byText(a.ordered_by?.name, b.ordered_by?.name) },
  { key: 'review', label: 'To talk about at', compare: (a, b) => byDay(reviewWhen(a), reviewWhen(b)) },
];

/** "Thu 3 Dec, Dr Okafor". */
export const visitLine = (a: { title: string; starts_at: string | null; provider_name: string | null }) =>
  [a.starts_at ? format(new Date(a.starts_at), 'EEE d MMM') : a.title, a.provider_name].filter(Boolean).join(', ');

/**
 * Test results: what each blood test, scan or other test showed, every
 * measure in its own row, and the visit it is to be talked about at.
 */
export function TestResultsPage() {
  const { profile, canEdit, isSelf } = useProfile();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<{ result: TestResult | null; appointmentId?: string | null; testName?: string | null; fromJourneyItemId?: string | null } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['test-results', profile.id],
    queryFn: () => api.get<{ results: TestResult[] }>(`/care-profiles/${profile.id}/results`),
  });

  // Opened from an appointment: "Add a result" for that test.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (canEdit) setEditing({ result: null, appointmentId: params.get('appointment'), testName: params.get('test'), fromJourneyItemId: params.get('from_journey_item') });
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('new');
      next.delete('appointment');
      next.delete('test');
      next.delete('from_journey_item');
      return next;
    }, { replace: true });
  }, [params, setParams, canEdit]);

  const hidden = useHiddenIds();
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const results = (data?.results ?? []).filter((r) => !hidden.has(r.id));
  const panel = useRecordPanel(results, (r) => r.id);
  const viewFilter = {
    key: 'view',
    label: 'What the doctor said',
    options: DOCTOR_VIEWS.map((d) => ({ value: d.value, label: d.label })),
    match: (r: TestResult, v: string) => r.doctor_view === v,
  };
  const dv = useDataView<TestResult>({
    rows: results,
    getId: (r) => r.id,
    searchText: (r) => [r.test_name, r.summary, r.ordered_by?.name, r.lab?.name, ...r.values.map((v) => v.name)].filter(Boolean).join(' '),
    sorts: SORTS,
    filters: [viewFilter],
  });

  const deleteResult = (r: TestResult) =>
    deferDelete({
      message: `Deleted the ${r.test_name} result.`,
      ids: [r.id],
      commit: () => api.delete(`/care-profiles/${profile.id}/results/${r.id}`),
      onCommitted: () => void queryClient.invalidateQueries({ queryKey: ['test-results', profile.id] }),
    });

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-ink">Test results</h2>
          <p className="text-xs text-muted">What {whose(isSelf, firstName(profile))} tests showed, each measure on its own line, ready for the next visit.</p>
        </div>
        {canEdit && results.length > 0 ? <Button size="sm" onClick={() => setEditing({ result: null })}>Add a result</Button> : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : results.length === 0 ? (
        <div className="card text-center py-10 space-y-3">
          <p className="text-sm text-ink">Results from blood tests, scans and other tests go here, shown at the next visit.</p>
          {canEdit ? <Button onClick={() => setEditing({ result: null })}>Add a result</Button> : null}
        </div>
      ) : (
        <>
          <DataToolbar
            search={dv.search}
            onSearch={dv.setSearch}
            searchPlaceholder="Search results…"
            sorts={SORTS.map((s) => ({ key: s.key, label: s.label }))}
            sortKey={dv.sortKey}
            onSort={dv.setSortKey}
            filters={[viewFilter].map((f) => ({ key: f.key, label: f.label, options: f.options }))}
            filterValues={dv.filterValues}
            onFilter={dv.setFilter}
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
                  <SortableTh label="Test" sortKey="test" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="Collected on" sortKey="collected" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="Results came on" sortKey="reported" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="What the doctor said" sortKey="view" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="Ordered by" sortKey="ordered" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="To talk about at" sortKey="review" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {dv.view.map((r) => (
                  <tr key={r.id} {...panel.rowProps(r.id)} className={`border-b border-border last:border-0 align-top ${RECORD_ROW_CLASS}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">{r.test_name}</div>
                      {r.summary ? <div className="text-xs text-muted line-clamp-2">{r.summary}</div> : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateOnly(r.collected_on)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateOnly(r.reported_on)}</td>
                    <td className={`px-3 py-2 ${r.doctor_view === 'follow_up' ? 'font-medium text-red-700 dark:text-red-300' : ''}`}>{doctorViewLabel(r.doctor_view)}</td>
                    <td className="px-3 py-2">{r.ordered_by?.name ?? ''}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.review_appointment ? (
                        <Link to={`/app/${profile.id}/appointments?record=${r.review_appointment.id}`} className={CONTACT_LINK}>{visitLine(r.review_appointment)}</Link>
                      ) : (
                        <span className="text-muted">No visit yet</span>
                      )}
                    </td>
                    {canEdit ? (
                      <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                        <Button size="xs" variant="ghost" aria-label={`Edit the ${r.test_name} result`} title="Edit" onClick={() => setEditing({ result: r })}><PencilIcon /></Button>
                        <Button size="xs" variant="ghost-danger" aria-label={`Delete the ${r.test_name} result`} title="Delete" onClick={() => deleteResult(r)}><TrashIcon /></Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {panel.current ? (() => {
        const r = panel.current;
        return (
          <RecordPanel
            key={r.id}
            kindLabel="Test result"
            title={r.test_name}
            subtitle={r.collected_on ? `Collected on ${formatDateOnly(r.collected_on)}` : undefined}
            kind="results"
            recordId={r.id}
            profileId={profile.id}
            canEdit={canEdit}
            fields={[
              { label: 'Collected on', value: formatDateOnly(r.collected_on) },
              { label: 'Results came on', value: formatDateOnly(r.reported_on) },
              { label: 'What it showed', value: r.summary },
              { label: 'What the doctor said', value: doctorViewLabel(r.doctor_view) },
              { label: 'Ordered by', value: r.ordered_by?.name ?? null },
              { label: 'Lab', value: r.lab?.name ?? null },
              { label: 'What it is for', value: r.condition?.name ?? null },
            ]}
            links={[
              ...(r.appointment ? [{ label: 'From the appointment', value: `${r.appointment.title}${r.appointment.starts_at ? `, ${format(new Date(r.appointment.starts_at), 'd MMM yyyy')}` : ''}`, to: `/app/${profile.id}/appointments?record=${r.appointment.id}` }] : []),
            ]}
            onEdit={() => setEditing({ result: r })}
            onDelete={() => {
              deleteResult(r);
              panel.close();
            }}
            onClose={panel.close}
          >
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">To talk about at</h3>
              {r.review_appointment ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-ink">To talk about at {visitLine(r.review_appointment)}.</p>
                  {canEdit ? <Button size="xs" variant="ghost" onClick={() => setEditing({ result: r })}>Change</Button> : null}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-muted">No visit booked to talk about it yet.</p>
                  {canEdit ? (
                    <Button size="xs" variant="secondary" onClick={() => navigate(bookingHref(profile.id, { provider: r.ordered_by?.id ?? null, title: `Talk about the ${r.test_name} results` }))}>
                      Book a visit
                    </Button>
                  ) : null}
                </div>
              )}
            </section>
            {r.values.length > 0 ? <ValuesTable values={r.values} /> : null}
            {r.ordered_by ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Ordered by</h3>
                <ContactStrip contact={r.ordered_by} profileId={profile.id} book={{ title: `Talk about the ${r.test_name} results` }} />
              </section>
            ) : null}
          </RecordPanel>
        );
      })() : null}

      {editing ? (
        <ResultEditor
          profileId={profile.id}
          result={editing.result}
          initialAppointmentId={editing.appointmentId}
          initialTestName={editing.testName}
          fromJourneyItemId={editing.fromJourneyItemId}
          onClose={() => setEditing(null)}
          onSaved={(saved) => panel.open(saved.id)}
        />
      ) : null}
    </div>
  );
}

const VALUE_SORTS: DataSort<ResultValue>[] = [
  { key: 'v_order', label: 'As on the report', compare: () => 0 },
  { key: 'v_name', label: 'Measure', compare: (a, b) => a.name.localeCompare(b.name) },
  { key: 'v_result', label: 'Result', compare: (a, b) => (a.value_number ?? Number.POSITIVE_INFINITY) - (b.value_number ?? Number.POSITIVE_INFINITY) || byText(a.value_text, b.value_text) },
  { key: 'v_unit', label: 'Unit', compare: (a, b) => byText(a.unit, b.unit) },
  { key: 'v_low', label: 'Normal range from', compare: (a, b) => (a.range_low ?? Number.POSITIVE_INFINITY) - (b.range_low ?? Number.POSITIVE_INFINITY) },
  { key: 'v_high', label: 'Normal range to', compare: (a, b) => (a.range_high ?? Number.POSITIVE_INFINITY) - (b.range_high ?? Number.POSITIVE_INFINITY) },
  { key: 'v_flag', label: 'Flag', compare: (a, b) => byText(flagLabel(a.flag), flagLabel(b.flag)) },
];

/** Each measure of a result, one column per detail. */
function ValuesTable({ values }: { values: ResultValue[] }) {
  const dv = useDataView<ResultValue>({
    rows: values,
    getId: (v) => `${v.name}:${v.id ?? ''}`,
    searchText: (v) => v.name,
    sorts: VALUE_SORTS,
    filters: [],
    defaultPageSize: 100,
  });
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Each measure</h3>
      {values.length > 8 ? (
        <div className="mb-2">
          <DataToolbar search={dv.search} onSearch={dv.setSearch} searchPlaceholder="Search measures…" sorts={VALUE_SORTS.map((s) => ({ key: s.key, label: s.label }))} sortKey={dv.sortKey} onSort={dv.setSortKey} />
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <SortableTh label="Measure" sortKey="v_name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
              <SortableTh label="Result" sortKey="v_result" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
              <SortableTh label="Unit" sortKey="v_unit" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
              <SortableTh label="Normal range from" sortKey="v_low" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
              <SortableTh label="Normal range to" sortKey="v_high" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
              <SortableTh label="Flag" sortKey="v_flag" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
            </tr>
          </thead>
          <tbody>
            {dv.view.map((v, i) => (
              <tr key={`${v.name}-${i}`} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5 text-ink">{v.name}</td>
                <td className={`px-3 py-1.5 ${v.flag === 'low' || v.flag === 'high' ? 'font-semibold text-red-700 dark:text-red-300' : 'text-ink'}`}>{v.value_number ?? v.value_text ?? ''}</td>
                <td className="px-3 py-1.5 text-muted">{v.unit ?? ''}</td>
                <td className="px-3 py-1.5 text-muted">{v.range_low ?? ''}</td>
                <td className="px-3 py-1.5 text-muted">{v.range_high ?? ''}</td>
                <td className="px-3 py-1.5">{flagLabel(v.flag)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
