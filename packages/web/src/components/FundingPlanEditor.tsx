import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { ContactPicker, emptyContact, pickedFrom, type PickedContact } from './ContactPicker';
import { noticeFiled, refreshContacts } from '../stores/notice';
import { MANAGEMENT, SCHEMES, addDays, type FundingPlan } from '../lib/lifeEvents';

const selectClass =
  'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

interface BudgetDraft {
  key: number;
  id: string | null;
  name: string;
  amount: string;
}

const contactRef = (v: PickedContact, before: { id: string | null } | null | undefined) => {
  if (v.providerId) return { id: v.providerId, ...(v.phone.trim() ? { phone: v.phone.trim() } : {}) };
  if (v.name.trim()) return { name: v.name.trim(), phone: v.phone.trim() || null };
  return before?.id ? null : undefined;
};

/**
 * Add a funding plan or change one: an NDIS plan, Support at Home, a Home
 * Care Package. Only what kind of plan it is is needed. Reports are due six
 * weeks before the review unless a day is given.
 */
export function FundingPlanEditor({
  profileId,
  plan,
  onClose,
  fromJourneyItemId,
}: {
  profileId: string;
  plan?: FundingPlan | null;
  onClose: () => void;
  /** The journey step this is recorded from; saving ticks it off. */
  fromJourneyItemId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [scheme, setScheme] = useState<string>(plan?.scheme ?? 'ndis');
  const [starts, setStarts] = useState(plan?.starts_on ?? '');
  const [ends, setEnds] = useState(plan?.ends_on ?? '');
  const [review, setReview] = useState(plan?.review_on ?? '');
  const [reportsDue, setReportsDue] = useState(plan && !plan.reports_due_worked_out ? plan.reports_due_on ?? '' : '');
  const [management, setManagement] = useState<string>(plan?.management ?? '');
  const [planManager, setPlanManager] = useState<PickedContact>(plan?.plan_manager ? pickedFrom(plan.plan_manager) : emptyContact);
  const [coordinator, setCoordinator] = useState<PickedContact>(plan?.support_coordinator ? pickedFrom(plan.support_coordinator) : emptyContact);
  const [lac, setLac] = useState<PickedContact>(plan?.local_area_coordinator ? pickedFrom(plan.local_area_coordinator) : emptyContact);
  const [nextKey, setNextKey] = useState((plan?.budgets.length ?? 0) + 1);
  const [budgets, setBudgets] = useState<BudgetDraft[]>(
    plan?.budgets.length ? plan.budgets.map((b, i) => ({ key: i, id: b.id, name: b.name, amount: String(b.amount) })) : [{ key: 0, id: null, name: '', amount: '' }]
  );
  const [missing, setMissing] = useState('');
  const [error, setError] = useState('');
  const reportsShown = reportsDue || (review ? addDays(review, -42) : '');
  const isNdis = scheme === 'ndis';

  const setBudget = (key: number, patch: Partial<BudgetDraft>) => setBudgets((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        scheme,
        starts_on: starts || null,
        ends_on: ends || null,
        review_on: review || null,
        reports_due_on: reportsDue || null,
        management: management || null,
        budgets: budgets
          .filter((b) => b.name.trim())
          .map((b) => ({ ...(b.id ? { id: b.id } : {}), name: b.name.trim(), amount: Number(b.amount.replace(/[^0-9.]/g, '')) || 0 })),
      };
      const refs: Array<[string, PickedContact, { id: string | null } | null | undefined]> = [
        ['plan_manager', planManager, plan?.plan_manager],
        ['support_coordinator', coordinator, plan?.support_coordinator],
        ['local_area_coordinator', lac, plan?.local_area_coordinator],
      ];
      for (const [k, v, before] of refs) {
        const ref = contactRef(v, before);
        if (ref !== undefined) body[k] = ref;
      }
      return plan
        ? api.patch<{ plan: FundingPlan; filed?: Array<{ id: string; name: string }>; report_tasks: number }>(`/care-profiles/${profileId}/funding-plans/${plan.id}`, body)
        : api.post<{ plan: FundingPlan; filed?: Array<{ id: string; name: string }>; report_tasks: number }>(`/care-profiles/${profileId}/funding-plans`, { ...body, ...(fromJourneyItemId ? { from_journey_item_id: fromJourneyItemId } : {}) });
    },
    onSuccess: (res) => {
      noticeFiled(profileId, res.filed);
      refreshContacts(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['funding-plans', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', profileId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The plan did not save. Check your connection and try again.'),
  });

  return (
    <Modal open onClose={onClose} title={plan ? `Change the ${plan.scheme_label}` : 'Add a plan'} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          const noAmount = budgets.find((b) => b.name.trim() && !b.amount.trim());
          if (noAmount) {
            setMissing(`The ${noAmount.name.trim()} budget needs an amount.`);
            document.getElementById(`budget-amount-${noAmount.key}`)?.focus();
            return;
          }
          if (starts && ends && ends < starts) {
            setMissing('Plan ends is before Plan starts. Check the two dates.');
            document.getElementById('plan-ends')?.focus();
            return;
          }
          setMissing('');
          save.mutate();
        }}
      >
        <div>
          <label htmlFor="plan-scheme" className="block text-sm font-medium text-ink mb-1">Scheme</label>
          <select id="plan-scheme" className={selectClass} value={scheme} onChange={(e) => setScheme(e.target.value)}>
            {SCHEMES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="plan-starts" label="Plan starts" type="date" value={starts} onChange={(e) => setStarts(e.target.value)} />
          <Input id="plan-ends" label="Plan ends" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
          <Input id="plan-review" label="Review meeting" type="date" value={review} onChange={(e) => setReview(e.target.value)} />
          <Input
            id="plan-reports"
            label="Reports due by"
            type="date"
            value={reportsShown}
            onChange={(e) => setReportsDue(e.target.value)}
            hint={!reportsDue && review ? 'Worked out as six weeks before the review.' : undefined}
          />
        </div>
        <div>
          <label htmlFor="plan-management" className="block text-sm font-medium text-ink mb-1">How it is managed</label>
          <select id="plan-management" className={selectClass} value={management} onChange={(e) => setManagement(e.target.value)}>
            <option value="">Not set</option>
            {MANAGEMENT.map((m) => (
              <option key={m.value} value={m.value}>{isNdis || m.value !== 'agency' ? m.label : 'Managed by the provider'}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ContactPicker id="plan-manager" label="Plan manager" profileId={profileId} value={planManager} onChange={setPlanManager} defaultType="Plan manager" placeholder="Search Contacts or type a name" />
          <ContactPicker id="plan-coordinator" label="Support coordinator" profileId={profileId} value={coordinator} onChange={setCoordinator} defaultType="Support coordinator" placeholder="Search Contacts or type a name" />
          {isNdis ? (
            <ContactPicker id="plan-lac" label="Local Area Coordinator" profileId={profileId} value={lac} onChange={setLac} defaultType="Local Area Coordinator" placeholder="Search Contacts or type a name" />
          ) : null}
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Budgets</legend>
          {budgets.map((b) => (
            <div key={b.key} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] items-end">
              <Input id={`budget-name-${b.key}`} label="Name" value={b.name} onChange={(e) => setBudget(b.key, { name: e.target.value })} placeholder="e.g. Capacity building" />
              <Input id={`budget-amount-${b.key}`} label="Amount" value={b.amount} inputMode="decimal" onChange={(e) => setBudget(b.key, { amount: e.target.value })} placeholder="e.g. 12000" />
              <Button type="button" size="xs" variant="ghost-danger" onClick={() => setBudgets((bs) => bs.filter((x) => x.key !== b.key))}>Remove</Button>
            </div>
          ))}
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={() => {
              setBudgets((bs) => [...bs, { key: nextKey, id: null, name: '', amount: '' }]);
              setNextKey((k) => k + 1);
            }}
          >
            Add a budget
          </Button>
        </fieldset>
        <p className="text-xs text-muted">With a review meeting, each therapist in Contacts gets a task to ask for their progress report, due when reports are due.</p>
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>Save the plan</Button>
        </div>
        {missing ? <p className="text-sm text-red-600 text-right" role="alert">{missing}</p> : null}
      </form>
    </Modal>
  );
}
