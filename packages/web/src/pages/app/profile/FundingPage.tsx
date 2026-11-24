import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { CONTACT_LINK, ContactStrip } from '../../../components/ContactStrip';
import { PhoneLink } from '../../../components/cards/profile/links';
import { useDataView, type DataSort } from '../../../components/data/useDataView';
import { DataToolbar } from '../../../components/data/DataToolbar';
import { SortableTh } from '../../../components/data/SortableTh';
import { FundingPlanEditor } from '../../../components/FundingPlanEditor';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { useHealthConfig } from '../../../lib/appConfig';
import { formatDateOnly, todayDateOnly } from '../../../lib/datetime';
import { firstName, whose, type Budget, type FundingPlan } from '../../../lib/lifeEvents';
import { useProfile } from './ProfileLayout';

/**
 * Funding: an NDIS plan or an aged care package, with its dates, who
 * manages it, its budgets with what is spent and left, and the reports due
 * before the review.
 */
export function FundingPage() {
  const { profile, isOwner, access, isSelf } = useProfile();
  const name = firstName(profile);
  const canManage = isOwner || access === 'admin';
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ plan: FundingPlan | null; fromJourneyItemId?: string | null } | null>(null);
  const [params, setParams] = useSearchParams();
  // Opened from a journey step such as "Apply for funding support": the form opens, and saving ticks the step.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (canManage) setEditing({ plan: null, fromJourneyItemId: params.get('from_journey_item') });
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('new');
      next.delete('from_journey_item');
      return next;
    }, { replace: true });
  }, [params, setParams, canManage]);
  const { data, isLoading, error } = useQuery({
    queryKey: ['funding-plans', profile.id],
    queryFn: () => api.get<{ plans: FundingPlan[] }>(`/care-profiles/${profile.id}/funding-plans`),
    enabled: canManage,
    retry: false,
  });
  const hidden = useHiddenIds();
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const plans = (data?.plans ?? []).filter((p) => !hidden.has(p.id));

  if (!canManage) {
    return (
      <div className="card text-center py-10 max-w-3xl">
        <p className="text-sm text-ink">{profile.manager_name ?? 'Whoever manages this profile'} keeps {whose(isSelf, name)} funding plan, because the budgets are the household's money.</p>
      </div>
    );
  }

  const deletePlan = (p: FundingPlan) =>
    deferDelete({
      message: `Deleted the ${p.scheme_label}.`,
      ids: [p.id],
      commit: () => api.delete(`/care-profiles/${profile.id}/funding-plans/${p.id}`),
      onCommitted: () => {
        void queryClient.invalidateQueries({ queryKey: ['funding-plans', profile.id] });
        void queryClient.invalidateQueries({ queryKey: ['tasks', profile.id] });
      },
    });

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-ink">Funding</h2>
          <p className="text-xs text-muted">{whose(isSelf, name, true)} plan, who manages it, the budgets and the reports due before the review.</p>
        </div>
        {plans.length > 0 ? <Button size="sm" onClick={() => setEditing({ plan: null })}>Add a plan</Button> : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600" role="alert">{error instanceof Error ? error.message : 'The plan could not be loaded. Try again in a moment.'}</p>
      ) : plans.length === 0 ? (
        <div className="card text-center py-10 space-y-3">
          <p className="text-sm text-ink">An NDIS plan or an aged care package goes here, with its dates, budgets and reports due.</p>
          <Button onClick={() => setEditing({ plan: null })}>Add a plan</Button>
        </div>
      ) : (
        plans.map((p) => <PlanCard key={p.id} plan={p} profileId={profile.id} onEdit={() => setEditing({ plan: p })} onDelete={() => deletePlan(p)} />)
      )}

      {editing ? <FundingPlanEditor profileId={profile.id} plan={editing.plan} fromJourneyItemId={editing.fromJourneyItemId} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

const BUDGET_SORTS: DataSort<Budget>[] = [
  { key: 'b_order', label: 'As in the plan', compare: () => 0 },
  { key: 'b_name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  { key: 'b_amount', label: 'Amount', compare: (a, b) => a.amount - b.amount },
  { key: 'b_spent', label: 'Spent', compare: (a, b) => a.spent - b.spent },
  { key: 'b_left', label: 'Left', compare: (a, b) => a.left - b.left },
];

function PlanCard({ plan, profileId, onEdit, onDelete }: { plan: FundingPlan; profileId: string; onEdit: () => void; onDelete: () => void }) {
  const health = useHealthConfig();
  const money = (n: number) => `${health.currency_symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dv = useDataView<Budget>({ rows: plan.budgets, getId: (b) => b.id, searchText: (b) => b.name, sorts: BUDGET_SORTS, filters: [], defaultPageSize: 50 });
  const reportTo = plan.ends_on && plan.ends_on < todayDateOnly() ? plan.ends_on : todayDateOnly();
  const reportHref = `/app/reports?${new URLSearchParams({
    preset: 'NDIS progress report',
    profile: profileId,
    ...(plan.starts_on ? { from: plan.starts_on, to: reportTo } : {}),
  }).toString()}`;
  const contacts: Array<[string, FundingPlan['plan_manager']]> = [
    ['Plan manager', plan.plan_manager],
    ['Support coordinator', plan.support_coordinator],
    ['Local Area Coordinator', plan.local_area_coordinator],
  ];
  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-ink">{plan.scheme_label}</h3>
          {plan.management_label ? <p className="text-xs text-muted">{plan.management_label}</p> : null}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="ghost-danger" onClick={onDelete}>Delete</Button>
        </div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-4 text-sm">
        <div><dt className="text-xs text-muted">Plan starts</dt><dd className="text-ink">{formatDateOnly(plan.starts_on) || 'Not set'}</dd></div>
        <div><dt className="text-xs text-muted">Plan ends</dt><dd className="text-ink">{formatDateOnly(plan.ends_on) || 'Not set'}</dd></div>
        <div><dt className="text-xs text-muted">Review meeting</dt><dd className="text-ink">{formatDateOnly(plan.review_on) || 'Not set'}</dd></div>
        <div>
          <dt className="text-xs text-muted">Reports due by</dt>
          <dd className="text-ink">{formatDateOnly(plan.reports_due_on) || 'Not set'}</dd>
          {plan.reports_due_worked_out ? <dd className="text-xs text-muted">Worked out as six weeks before the review.</dd> : null}
        </div>
      </dl>

      {contacts.some(([, c]) => c) ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {contacts.map(([label, c]) => (c ? <div key={label} className="rounded-md border border-border p-3"><ContactStrip contact={c} profileId={profileId} lead={label} /></div> : null))}
        </div>
      ) : null}

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Budgets</h4>
        {plan.budgets.length === 0 ? (
          <p className="text-sm text-muted">No budgets yet. Edit the plan to add them, then a cost counts against one when you record it.</p>
        ) : (
          <>
            {plan.budgets.length > 6 ? (
              <DataToolbar search={dv.search} onSearch={dv.setSearch} searchPlaceholder="Search budgets…" sorts={BUDGET_SORTS.map((s) => ({ key: s.key, label: s.label }))} sortKey={dv.sortKey} onSort={dv.setSortKey} />
            ) : null}
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-border">
                    <SortableTh label="Name" sortKey="b_name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="Amount" sortKey="b_amount" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="Spent" sortKey="b_spent" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="Left" sortKey="b_left" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {dv.view.map((b) => (
                    <tr key={b.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-ink">{b.name}</td>
                      <td className="px-3 py-2">{money(b.amount)}</td>
                      <td className="px-3 py-2">{money(b.spent)}</td>
                      <td className={`px-3 py-2 ${b.left < 0 ? 'font-semibold text-red-700 dark:text-red-300' : ''}`}>{money(b.left)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">Spent counts the costs recorded against each budget between the plan dates.</p>
          </>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Reports for the review</h4>
        {plan.reports_overdue ? (
          <p className="rounded-md border-l-4 border-l-red-500 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/10 dark:text-red-300" role="status">
            Reports are overdue, ask now. They were due by {formatDateOnly(plan.reports_due_on)}, six weeks before the review.
          </p>
        ) : null}
        {plan.report_tasks.length === 0 ? (
          <p className="text-sm text-muted">
            {plan.review_on ? 'No therapist in Contacts writes reports yet. Add their occupational therapist, speech pathologist or physiotherapist and a task is made for each.' : 'Add the review meeting and each therapist gets a task to ask for their report.'}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {plan.report_tasks.map((t) => {
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <Link to={`/app/${profileId}/tasks?record=${t.id}`} className={`text-sm ${CONTACT_LINK} ${t.completed ? 'line-through' : ''}`}>{t.title}</Link>
                  {t.completed ? (
                    <span className="text-xs text-muted">Done</span>
                  ) : t.overdue ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">Overdue</span>
                      <span className="text-xs text-muted">was due {formatDateOnly(t.due_on)}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted">Due {formatDateOnly(t.due_on)}</span>
                  )}
                  {t.provider_phone ? (
                    <span className="ml-auto text-sm">
                      <PhoneLink phone={t.provider_phone} />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {plan.scheme === 'ndis' ? (
          <p className="text-sm">
            <Link to={reportHref} className={CONTACT_LINK}>Make the NDIS progress report for the plan period</Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
