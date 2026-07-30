import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { CardShell } from '../CardShell';
import type { CardProps } from '../types';

/** What this care is costing, and what has been claimed back. */
export function HealthSpendCard({ profileId, careName }: CardProps) {
  return (
    <CardShell>
      <HealthSpendOverview profileId={profileId} careName={careName} />
    </CardShell>
  );
}

interface SpendReceipt { id: string; filename: string }
interface SpendEntry {
  id: string;
  amount: number;
  spent_on: string;
  category: 'medication' | 'appointment' | 'other';
  status: 'confirmed' | 'estimated';
  description: string | null;
  item_name: string | null;
  tax_amount: number | null;
  funding_source: string | null;
  claimable_amount: number | null;
  claim_status: 'none' | 'unclaimed' | 'submitted' | 'reimbursed';
  reimbursed_amount: number | null;
  account_code: string | null;
  receipts: SpendReceipt[] | null;
}
interface SpendResponse {
  summary: {
    currency: string;
    currency_symbol: string;
    by_category: { medication: number; appointment: number; other: number };
    total: number;
    pending_total: number;
    tax_total: number;
    claimable_total: number;
    reimbursed_total: number;
    outstanding_total: number;
    net_total: number;
  };
  entries: SpendEntry[];
}

type SpendRange = '12m' | 'year' | 'fy' | 'all';

const CATEGORY_LABEL: Record<SpendEntry['category'], string> = {
  medication: 'Medication',
  appointment: 'Appointment',
  other: 'Other',
};
const FUNDING_SOURCES = ['self', 'ndis', 'private_health', 'medicare', 'government', 'other'] as const;
const FUNDING_LABEL: Record<string, string> = {
  self: 'Self funded', ndis: 'NDIS', private_health: 'Private health', medicare: 'Medicare', government: 'Government', other: 'Other',
};
const CLAIM_STATUSES = ['none', 'unclaimed', 'submitted', 'reimbursed'] as const;
const CLAIM_LABEL: Record<string, string> = {
  none: 'Not claimable', unclaimed: 'Unclaimed', submitted: 'Submitted', reimbursed: 'Reimbursed',
};

function spendRangeParams(range: SpendRange): string {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (range === 'all') return '';
  if (range === 'fy') return '?range=fy';
  if (range === 'year') return `?from=${today.getFullYear()}-01-01&to=${iso(today)}`;
  const from = new Date(today);
  from.setFullYear(from.getFullYear() - 1);
  return `?from=${iso(from)}&to=${iso(today)}`;
}

/**
 * A person's actual health spend over a chosen window: the total, the net after
 * reimbursements, what is claimable and outstanding, the split by category, and
 * each dated entry with its claim status. Costs carry accounting details (tax,
 * funding source, claim, receipts) an accountant can reconcile and export.
 * Owner and admin only.
 */
function HealthSpendOverview({ profileId, careName }: { profileId: string; careName: string }) {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<SpendRange>('12m');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SpendEntry | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['health-spend', profileId, range],
    queryFn: () => api.get<SpendResponse>(`/care-profiles/${profileId}/health-spend${spendRangeParams(range)}`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['health-spend', profileId] });

  const sym = data?.summary.currency_symbol ?? '$';
  const money = (n: number): string => `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDay = (d: string) => { try { return format(new Date(d), 'd MMM yyyy'); } catch { return d; } };

  const exportCsv = async () => {
    const blob = await api.blob(`/care-profiles/${profileId}/health-spend/export${spendRangeParams(range)}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `health-spend-${careName.replace(/[^\w]+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = data?.summary;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          {([['12m', 'Last 12 months'], ['year', 'This year'], ['fy', 'This financial year'], ['all', 'All time']] as [SpendRange, string][]).map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={`px-2.5 py-1 ${range === val ? 'bg-primary text-white' : 'bg-card text-muted hover:text-ink'}`}
              onClick={() => setRange(val)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => void exportCsv()}>Export for accounting</Button>
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add a cost</Button>
        </div>
      </div>

      {isLoading || !data || !s ? (
        <p className="text-sm text-muted">Adding up the spend…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="text-xs text-muted">Total spent</p>
              <p className="text-lg font-semibold text-ink">{money(s.total)}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Net out of pocket</p>
              <p className="text-lg font-semibold text-ink">{money(s.net_total)}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Reimbursed</p>
              <p className="text-lg font-semibold text-ink">{money(s.reimbursed_total)}</p>
            </div>
            <div className={`rounded-lg border p-3 ${s.outstanding_total > 0 ? 'border-amber-400/60 bg-amber-50 dark:bg-amber-900/20' : 'border-border'}`}>
              <p className="text-xs text-muted">Claims outstanding</p>
              <p className="text-lg font-semibold text-ink">{money(s.outstanding_total)}</p>
            </div>
          </div>

          <p className="text-xs text-muted">
            Medications {money(s.by_category.medication)} · Appointments {money(s.by_category.appointment)} · Other {money(s.by_category.other)}
            {s.tax_total > 0 ? <> · Tax within total {money(s.tax_total)}</> : null}
          </p>

          {s.pending_total > 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {money(s.pending_total)} in booked appointments is still an estimate, not counted above until the actual cost is confirmed.
            </p>
          ) : null}

          {data.entries.length === 0 ? (
            <p className="text-sm text-muted">
              No costs recorded in this window. A medication cost is logged when a repeat is replenished, an appointment when
              you confirm what it cost, and one-off costs with Add a cost.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.entries.map((e) => (
                <li key={e.id}>
                  <button type="button" className="w-full flex items-center justify-between gap-3 py-1.5 text-left hover:bg-surface-2/50 rounded px-1 -mx-1" onClick={() => setEditing(e)}>
                    <div className="min-w-0">
                      <span className="text-ink">{e.item_name || CATEGORY_LABEL[e.category]}</span>
                      <span className="block text-xs text-muted">
                        {fmtDay(e.spent_on)} · {CATEGORY_LABEL[e.category]}
                        {e.status === 'estimated' ? ' · estimate' : ''}
                        {e.claim_status && e.claim_status !== 'none' ? ` · ${CLAIM_LABEL[e.claim_status]}` : ''}
                        {e.receipts && e.receipts.length > 0 ? ` · ${e.receipts.length} receipt${e.receipts.length === 1 ? '' : 's'}` : ''}
                      </span>
                    </div>
                    <span className={e.status === 'estimated' ? 'text-muted italic shrink-0' : 'text-ink font-medium shrink-0'}>{money(e.amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">Tap a cost to add its tax, funding source, claim and receipts. Reports do custom date ranges and the claims breakdown.</p>
        </>
      )}

      {adding ? (
        <EntryModal mode="add" profileId={profileId} careName={careName} currencySymbol={sym} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void refresh(); }} />
      ) : null}
      {editing ? (
        <EntryModal mode="edit" profileId={profileId} careName={careName} currencySymbol={sym} entry={editing} onClose={() => setEditing(null)} onSaved={() => { void refresh(); }} onClosed={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

/**
 * Add or edit a health cost with its accounting details: amount, tax, funding
 * source, claim and reimbursement, account code, and (when editing) receipts.
 */
function EntryModal({ mode, profileId, careName, currencySymbol, entry, onClose, onSaved, onClosed }: {
  mode: 'add' | 'edit';
  profileId: string;
  careName: string;
  currencySymbol: string;
  entry?: SpendEntry;
  onClose: () => void;
  onSaved: () => void;
  onClosed?: () => void;
}) {
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [spentOn, setSpentOn] = useState(entry?.spent_on ?? new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState(entry?.description ?? '');
  const [tax, setTax] = useState(entry?.tax_amount != null ? String(entry.tax_amount) : '');
  const [funding, setFunding] = useState(entry?.funding_source ?? '');
  const [claimable, setClaimable] = useState(entry?.claimable_amount != null ? String(entry.claimable_amount) : '');
  const [claimStatus, setClaimStatus] = useState<string>(entry?.claim_status ?? 'none');
  const [reimbursed, setReimbursed] = useState(entry?.reimbursed_amount != null ? String(entry.reimbursed_amount) : '');
  const [accountCode, setAccountCode] = useState(entry?.account_code ?? '');
  const [status, setStatus] = useState<string>(entry?.status ?? 'confirmed');
  const [receipts, setReceipts] = useState<SpendReceipt[]>(entry?.receipts ?? []);
  const [error, setError] = useState('');
  const selectClass = 'w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

  const body = () => ({
    amount: Number(amount),
    spent_on: spentOn,
    description: note.trim() || null,
    tax_amount: tax.trim() === '' ? null : Number(tax),
    funding_source: funding || null,
    claimable_amount: claimable.trim() === '' ? null : Number(claimable),
    claim_status: claimStatus,
    reimbursed_amount: reimbursed.trim() === '' ? null : Number(reimbursed),
    account_code: accountCode.trim() || null,
    ...(mode === 'edit' ? { status } : {}),
  });

  const mutation = useMutation({
    mutationFn: () => mode === 'add'
      ? api.post(`/care-profiles/${profileId}/health-spend`, body())
      : api.patch(`/care-profiles/${profileId}/health-spend/${entry!.id}`, body()),
    onSuccess: () => { onSaved(); if (mode === 'add') onClose(); },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the cost.'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/care-profiles/${profileId}/health-spend/${entry!.id}`),
    onSuccess: () => { onSaved(); (onClosed ?? onClose)(); },
  });

  const uploadReceipt = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<{ receipt: SpendReceipt }>(`/care-profiles/${profileId}/health-spend/${entry!.id}/receipts`, form);
    },
    onSuccess: (res) => { setReceipts((prev) => [...prev, res.receipt]); onSaved(); },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not upload the receipt.'),
  });

  const deleteReceipt = useMutation({
    mutationFn: (receiptId: string) => api.delete(`/care-profiles/${profileId}/health-spend/${entry!.id}/receipts/${receiptId}`),
    onSuccess: (_r, receiptId) => { setReceipts((prev) => prev.filter((x) => x.id !== receiptId)); onSaved(); },
  });

  const downloadReceipt = async (r: SpendReceipt) => {
    const blob = await api.blob(`/care-profiles/${profileId}/health-spend/${entry!.id}/receipts/${r.id}/download`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = r.filename; a.click();
    URL.revokeObjectURL(url);
  };

  const title = mode === 'add' ? `Add a cost for ${careName}` : `${entry?.item_name ?? 'Cost'}`;
  return (
    <Modal open onClose={onClose} title={title} wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (amount.trim()) mutation.mutate(); }}>
        <div className="grid grid-cols-2 gap-2">
          <Input label={`Amount (${currencySymbol})`} type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <Input label="Date spent" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} required />
        </div>
        {mode === 'add' ? (
          <Input label="What was it for" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Mobility aid, dental treatment" />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1">Kind</span>
              <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="confirmed">Confirmed spend</option>
                <option value="estimated">Estimate (not counted yet)</option>
              </select>
            </label>
          </div>
        )}

        <div className="rounded-lg border border-border p-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Accounting</p>
          <div className="grid grid-cols-2 gap-2">
            <Input label={`Tax within amount (${currencySymbol})`} type="number" min="0" step="any" value={tax} onChange={(e) => setTax(e.target.value)} hint="The GST or VAT part of the total." />
            <Input label="Account code" value={accountCode} onChange={(e) => setAccountCode(e.target.value)} placeholder="For your accounting software" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1">Funding source</span>
              <select className={selectClass} value={funding} onChange={(e) => setFunding(e.target.value)}>
                <option value="">Not set</option>
                {FUNDING_SOURCES.map((f) => <option key={f} value={f}>{FUNDING_LABEL[f]}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1">Claim status</span>
              <select className={selectClass} value={claimStatus} onChange={(e) => setClaimStatus(e.target.value)}>
                {CLAIM_STATUSES.map((c) => <option key={c} value={c}>{CLAIM_LABEL[c]}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input label={`Claimable (${currencySymbol})`} type="number" min="0" step="any" value={claimable} onChange={(e) => setClaimable(e.target.value)} hint="How much you expect back." />
            <Input label={`Reimbursed (${currencySymbol})`} type="number" min="0" step="any" value={reimbursed} onChange={(e) => setReimbursed(e.target.value)} hint="How much has come back." />
          </div>
        </div>

        {mode === 'edit' ? (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Receipts</p>
            {receipts.length > 0 ? (
              <ul className="space-y-1">
                {receipts.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <button type="button" className="text-primary hover:underline truncate text-left" onClick={() => void downloadReceipt(r)}>{r.filename}</button>
                    <button type="button" className="text-muted hover:text-red-600 text-xs shrink-0" onClick={() => deleteReceipt.mutate(r.id)}>Remove</button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted">No receipts attached.</p>}
            <label className="inline-flex items-center gap-2 text-sm text-primary cursor-pointer">
              <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadReceipt.mutate(f); e.target.value = ''; }} />
              <span className="rounded-md border border-border px-2 py-1 hover:bg-surface-2">{uploadReceipt.isPending ? 'Uploading…' : 'Attach a receipt'}</span>
            </label>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex items-center justify-between gap-2">
          {mode === 'edit' ? (
            <Button type="button" variant="danger" size="sm" onClick={() => deleteMutation.mutate()}>Delete cost</Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{mode === 'edit' ? 'Done' : 'Cancel'}</Button>
            <Button type="submit" loading={mutation.isPending} disabled={!amount.trim()}>Save</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** A phone number as a tap-to-call link. */
