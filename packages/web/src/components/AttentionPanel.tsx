import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { startOfDay, endOfDay } from 'date-fns';
import { format } from '../lib/dateFormat';
import { api } from '../api/client';
import { useAssistantStore } from '../stores/assistant';
import { Button } from './ui/Button';
import { CrossIcon } from './ui/icons';
import { Modal } from './ui/Modal';
import { GpModal } from './QuickAddModals';
import { IngestModal } from './IngestModal';
import { browserTimeZone } from '../lib/datetime';
import { severityLabel } from '../pages/app/profile/ConditionSymptoms';
import { coverMedDay, type ChartAdmin } from '../lib/marCoverage';
import type { ContactSummary, MedicationRecord } from '../lib/care';
import { ContactStrip, CONTACT_LINK } from './ContactStrip';
import { usePareOn } from '../lib/aiStatus';
import { offerDoseUndo } from '../lib/doseUndo';

export interface AttentionItem {
  profile_id: string;
  profile_name: string;
  kind: 'overdue_task' | 'unrecorded_dose' | 'stale_question' | 'out_of_stock' | 'reorder_overdue' | 'unresolved_outcome' | 'appointment_cost' | 'still_in_hospital';
  label: string;
  detail: string | null;
  section: string;
  key: string;
  urgent: boolean;
  dismissible: boolean;
  /** The one record it is about, so the row opens that record. */
  record_kind?: string | null;
  record_id?: string | null;
  /** Who to call about it. */
  contact?: ContactSummary | null;
  /** The next thing to do: call, email, order online, book, or open. */
  next_action?: { kind: string; label: string; href: string | null } | null;
  /** Out of stock, and a repeat is already on order. */
  on_order?: boolean;
}

/** Where a row opens: the record itself when there is one. */
const itemPath = (it: AttentionItem) => `/app/${it.profile_id}/${it.section}${it.record_id ? `?record=${it.record_id}` : ''}`;

export interface HealthAlert {
  key: string;
  profile_id: string;
  profile_name: string;
  kind: 'persistent_symptoms' | 'unresolved_injury';
  condition_id: string;
  condition_name: string;
  condition_category: string | null;
  /** The person's normal severity for this condition, when a baseline is set. */
  baseline: number | null;
  since: string;
  days: number;
  symptoms: Array<{ id: string; name: string; severity: number }>;
  /** Their GP, as someone to call. */
  gp: ContactSummary | null;
}

const ATTENTION_ICON: Record<AttentionItem['kind'], string> = {
  overdue_task: '⏰',
  unrecorded_dose: '💊',
  stale_question: '❓',
  out_of_stock: '📦',
  reorder_overdue: '🚚',
  unresolved_outcome: '⚠️',
  appointment_cost: '💷',
  still_in_hospital: '🏥',
};

/**
 * A precise brief handed to Pare when the user asks to deal with an item
 * together: what it is, who it is for, and the annoying steps to carry out,
 * so Pare drafts the message, gives a ready-to-send version and helps close
 * the item out.
 */
function itemBrief(it: AttentionItem): string {
  const who = it.profile_name;
  const useRecord = `First look through ${who}'s record you have been given — providers and their contact details, the care plan, recent notes and related tasks — and use what is there. `;
  switch (it.kind) {
    case 'overdue_task':
      return `Let's do this for ${who}: "${it.label}"${it.detail ? ` (${it.detail})` : ''}. ${useRecord}`
        + `If it needs an email or message, write the actual draft here now (a clear subject and body) addressed to the right provider or contact from the record. `
        + `Only if something essential is genuinely not on file (like a missing email address) ask me for just that. Do not say you are drafting without showing the draft. `
        + `Do not mark the task complete yourself; once it is sent, offer me a confirm button to mark it done.`;
    case 'out_of_stock':
      return `${who} has run out of ${it.detail ?? 'a medication'}. ${useRecord}`
        + `Write the actual repeat request here now (a clear subject and body) addressed to their pharmacy or prescriber from the record. `
        + `Only ask me for a detail if it is genuinely missing. Do not change anything yourself; once it is arranged, ask me whether to update the supply.`;
    case 'reorder_overdue':
      return `A repeat for ${who} was ordered but has not arrived: ${it.detail ?? 'a medication'}. ${useRecord}`
        + `Write a short chase-up message here now addressed to their pharmacy or prescriber from the record, asking where the order is. `
        + `Only ask me for a detail if it is genuinely missing. Do not change anything yourself; once it arrives, mark it replenished on the medication.`;
    case 'unrecorded_dose':
      return `Record all the doses due for ${who} now${it.detail ? `: ${it.detail}` : ''}. `
        + `Log every one of them in a single action at their scheduled times, using the exact medication names from the record. `
        + `Do not ask me to confirm each one and do not walk me through them one at a time; just log them and tell me what you recorded.`;
    case 'stale_question':
      return `Let's follow up the open question(s) for ${who} that have had no reply. ${useRecord}Draft the actual message to chase an answer here now.`;
    case 'unresolved_outcome':
      return `A task for ${who} was completed with a poor outcome: "${it.detail ?? it.label}". ${useRecord}Help me work out what went wrong and what to do next.`;
    case 'appointment_cost':
      return `An appointment for ${who} was booked with an estimated cost but the actual cost has not been confirmed: ${it.detail ?? it.label}. `
        + `Remind me to open the appointment and log what it actually cost so the health spend stays accurate.`;
    default:
      return `Help me deal with this for ${who}: ${it.label}. ${useRecord}`;
  }
}

const symptomSummary = (a: HealthAlert): string =>
  a.symptoms.map((s) => `${s.name} ${s.severity}/10 ${severityLabel(s.severity)}`).join(', ');

// "above their normal of 7 out of 10" when a baseline is set, otherwise the
// standard "above moderate".
const aboveWhat = (a: HealthAlert): string =>
  a.baseline != null ? `above their normal of ${a.baseline} out of 10` : 'above moderate';

function alertHeadline(a: HealthAlert): string {
  if (a.kind === 'persistent_symptoms') {
    return `${a.condition_name}: symptoms have stayed ${aboveWhat(a)} for ${a.days} ${a.days === 1 ? 'day' : 'days'}`;
  }
  const months = Math.max(1, Math.round(a.days / 30));
  return `${a.condition_name}: still unresolved after ${months} ${months === 1 ? 'month' : 'months'}`;
}

function alertBrief(a: HealthAlert): string {
  const who = a.profile_name;
  const what =
    a.kind === 'persistent_symptoms'
      ? `${who}'s ${a.condition_name} has had symptoms ${aboveWhat(a)} for ${a.days} days (${symptomSummary(a)}).`
      : `${who}'s ${a.condition_name} is still unresolved ${Math.max(1, Math.round(a.days / 30))} months on${a.symptoms.length > 0 ? ` (${symptomSummary(a)})` : ''}.`;
  return `${what} It is probably time they saw their GP. Look through ${who}'s record for the GP's contact details, `
    + `help me decide how soon they should be seen, and draft the booking call script or message here now. `
    + `Do not change any records yourself; once an appointment is made, offer to record it.`;
}

/**
 * The things needing attention today, listed in full so the user can see
 * and act on each one without opening the assistant. The same panel serves
 * the Homeboard (everyone) and a profile's overview (just that person), so
 * the design stays consistent. Health alerts lead: an illness whose
 * symptoms have stayed above moderate, or an injury unresolved for months,
 * each with the GP's details and a booking shortcut. Urgent items stand
 * out. Each row has "Ask Pare" and, when allowed, "Dismiss" behind an
 * "are you sure?" confirm. The panel header has one control, the Hide and
 * Show collapse toggle.
 */
export function AttentionPanel({ profileId }: { profileId?: string }) {
  const openWithMessage = useAssistantStore((s) => s.openWithMessage);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState<{ key: string; who: string; what: string; warning: string } | null>(null);
  const [addGpFor, setAddGpFor] = useState<string | null>(null);
  const [ingestFor, setIngestFor] = useState<string | null>(null);
  // Doses not yet recorded for several people show as one row, with the
  // per-person detail one tap away.
  const [showDoseDetail, setShowDoseDetail] = useState(false);
  // With no assistant attached, the Pare buttons give way to the plain way.
  const pareOn = usePareOn();

  const tz = browserTimeZone();
  const { data: attentionData } = useQuery({
    queryKey: ['pare-attention'],
    queryFn: () =>
      api.get<{ count: number; items: AttentionItem[] }>(`/ai/dashboard/attention${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`),
  });
  const { data: alertData } = useQuery({
    queryKey: ['health-alerts'],
    queryFn: () => api.get<{ alerts: HealthAlert[] }>('/ai/dashboard/health-alerts'),
  });

  const items = (attentionData?.items ?? []).filter((i) => !profileId || i.profile_id === profileId);
  const alerts = (alertData?.alerts ?? []).filter((a) => !profileId || a.profile_id === profileId);
  const count = items.length + alerts.length;

  const dismiss = useMutation({
    mutationFn: (key: string) => api.post('/ai/dashboard/attention/dismiss', { key }),
    onSuccess: () => {
      setConfirmDismiss(null);
      void queryClient.invalidateQueries({ queryKey: ['pare-attention'] });
      void queryClient.invalidateQueries({ queryKey: ['health-alerts'] });
    },
  });

  // Log every dose due today for a profile straight from the panel, using the
  // same slot-coverage logic as the medication record's "Log all due doses"
  // button: fetch today's chart, record each passed scheduled slot that has no
  // dose against it, then refresh so the alert clears.
  const logAllDoses = useMutation({
    mutationFn: async (profileId: string) => {
      const from = startOfDay(new Date());
      const to = endOfDay(new Date());
      const chart = await api.get<{ medications: MedicationRecord[]; administrations: ChartAdmin[] }>(
        `/care-profiles/${profileId}/medications/chart?from=${from.toISOString()}&to=${to.toISOString()}`
      );
      const now = new Date();
      const dayStr = format(now, 'yyyy-MM-dd');
      const entries: Array<{ medication_id: string; scheduled_for: string; administered_at: string; status: string; right_dose: boolean; right_route: boolean }> = [];
      for (const m of chart.medications) {
        for (const sv of coverMedDay(m, dayStr, chart.administrations, now).slots) {
          if (sv.past && !sv.covered) {
            // Logged as prescribed, so the dose and route checks are confirmed.
            entries.push({ medication_id: m.id, scheduled_for: sv.iso, administered_at: sv.iso, status: 'given', right_dose: true, right_route: true });
          }
        }
      }
      if (!entries.length) return { count: 0, ids: [] as string[] };
      const res = await api.post<{ ids?: string[] }>(`/care-profiles/${profileId}/medications/administrations/batch`, { entries });
      return { count: entries.length, ids: res?.ids ?? [] };
    },
    onSuccess: (done, profileId) => {
      const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: ['pare-attention'] });
        void queryClient.invalidateQueries({ queryKey: ['med-chart', profileId] });
        void queryClient.invalidateQueries({ queryKey: ['calendar-upcoming', profileId] });
      };
      refresh();
      offerDoseUndo({ profileId, ids: done.ids, message: `${done.count} ${done.count === 1 ? 'dose' : 'doses'} recorded as given.`, onChanged: refresh });
    },
  });

  // Mark a medicine as ordered straight from its alert: the plain next step
  // once the pharmacy has been rung.
  const [orderError, setOrderError] = useState<{ key: string; text: string } | null>(null);
  const markOrdered = useMutation({
    mutationFn: (it: AttentionItem) => api.post(`/care-profiles/${it.profile_id}/medications/${it.record_id}/reorder`, { action: 'ordered' }),
    onSuccess: () => {
      setOrderError(null);
      void queryClient.invalidateQueries({ queryKey: ['pare-attention'] });
    },
    // Silence is not success: say it did not happen, and what to do.
    onError: (err, it) =>
      setOrderError({ key: it.key, text: err instanceof Error ? `${err.message} It is still not marked as ordered.` : 'It was not marked as ordered. Try again in a moment.' }),
  });

  const doseItems = items.filter((i) => i.kind === 'unrecorded_dose');
  const groupDoses = !profileId && doseItems.length >= 2;
  const firstDoseKey = doseItems[0]?.key;
  const listed = groupDoses ? items.filter((i) => i.kind !== 'unrecorded_dose' || i.key === firstDoseKey) : items;
  const shownCount = groupDoses ? count - doseItems.length + 1 : count;

  if (count === 0) return null;

  const doseActions = (it: AttentionItem) => (
    <>
      <Link to={`/app/${it.profile_id}/mar`} className={`${CONTACT_LINK} text-xs whitespace-nowrap px-1`}>
        Check records
      </Link>
      <Button
        size="xs"
        variant="secondary"
        className="whitespace-nowrap"
        loading={logAllDoses.isPending && logAllDoses.variables === it.profile_id}
        onClick={() => logAllDoses.mutate(it.profile_id)}
      >
        Log all doses
      </Button>
    </>
  );

  return (
    <div className="card py-3 px-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-ink">Needs attention today</span>
        <span className="text-xs text-muted">{shownCount === 1 ? '1 thing' : `${shownCount} things`}</span>
        <div className="ml-auto">
          <Button size="sm" variant="ghost" onClick={() => setCollapsed((v) => !v)} aria-expanded={!collapsed}>
            {collapsed ? 'Show' : 'Hide'}
          </Button>
        </div>
      </div>
      {!collapsed ? (
        <ul className="mt-2 divide-y divide-border">
          {alerts.map((a) => (
            <li
              key={a.key}
              className="py-2 -mx-2 px-2 rounded border-l-2 border-red-500 bg-red-50 dark:bg-red-900/10 space-y-1.5"
            >
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <Link
                  to={`/app/${a.profile_id}/conditions`}
                  className="flex items-start gap-2 min-w-0 flex-1 text-sm hover:underline"
                >
                  <span aria-hidden className="mt-0.5">🩺</span>
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{a.profile_name}</span>
                    <span className="text-red-700 dark:text-red-300"> · {alertHeadline(a)}</span>
                    {a.symptoms.length > 0 ? (
                      <span className="text-red-700 dark:text-red-300"> ({symptomSummary(a)})</span>
                    ) : null}
                    <span className="ml-2 align-middle rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">
                      Health alert
                    </span>
                  </span>
                </Link>
                <div className="flex items-center justify-end gap-1 shrink-0 ml-auto">
                  <Button
                    size="xs"
                    variant="ghost"
                    className="whitespace-nowrap"
                    aria-label="Dismiss health alert"
                    title="Dismiss"
                    onClick={() =>
                      setConfirmDismiss({
                        key: a.key,
                        who: a.profile_name,
                        what: alertHeadline(a),
                        warning:
                          'It will not come back for this episode, so only dismiss it once the GP visit is arranged or the alert is not needed.',
                      })
                    }
                  >
                    <CrossIcon />
                  </Button>
                  {pareOn ? (
                    <Button
                      size="xs"
                      variant="secondary"
                      className="whitespace-nowrap"
                      onClick={() => openWithMessage(alertBrief(a), a.profile_id)}
                    >
                      Ask Pare
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 pl-7 text-sm">
                {a.gp ? (
                  <ContactStrip
                    contact={a.gp}
                    profileId={a.profile_id}
                    lead="Consider contacting their GP"
                    size="compact"
                    book={{ condition: a.condition_id }}
                  />
                ) : (
                  <>
                    <span className="text-ink">Consider contacting their GP. No GP is on file yet.</span>
                    <Button size="xs" variant="secondary" onClick={() => setAddGpFor(a.profile_id)}>
                      Add their GP
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
          {listed.map((it) => groupDoses && it.kind === 'unrecorded_dose' ? (
            <li key="unrecorded_dose:group" className="py-2 -mx-2 px-2 space-y-2">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <span className="flex items-start gap-2 min-w-0 flex-1 text-sm">
                  <span aria-hidden className="mt-0.5">{ATTENTION_ICON.unrecorded_dose}</span>
                  <span className="min-w-0">
                    <span className="font-medium text-ink">Doses not yet recorded</span>
                    <span className="text-muted"> · for {doseItems.length} people</span>
                  </span>
                </span>
                <div className="flex flex-wrap items-center justify-end gap-1 shrink-0 ml-auto">
                  <Button size="xs" variant="ghost" className="whitespace-nowrap" aria-expanded={showDoseDetail} onClick={() => setShowDoseDetail((v) => !v)}>
                    {showDoseDetail ? 'Hide who' : 'Show who'}
                  </Button>
                  <Button size="xs" variant="secondary" className="whitespace-nowrap" onClick={() => navigate('/app/round')}>
                    Start the medicine round
                  </Button>
                </div>
              </div>
              {showDoseDetail ? (
                <ul className="pl-7 divide-y divide-border">
                  {doseItems.map((d) => (
                    <li key={d.key} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-1.5">
                      <Link to={itemPath(d)} className="min-w-0 flex-1 text-sm hover:underline">
                        <span className="font-medium text-ink">{d.profile_name}</span>
                        {d.detail ? <span className="text-muted"> ({d.detail})</span> : null}
                      </Link>
                      <div className="flex items-center gap-1 shrink-0 ml-auto">{doseActions(d)}</div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ) : (
            <li
              key={it.key}
              className={`flex flex-wrap items-start gap-x-3 gap-y-2 py-2 -mx-2 px-2 rounded ${
                it.urgent ? 'border-l-2 border-red-500 bg-red-50 dark:bg-red-900/10' : ''
              }`}
            >
              <Link
                to={itemPath(it)}
                className="flex items-start gap-2 min-w-0 flex-1 text-sm hover:underline"
              >
                <span aria-hidden className="mt-0.5">{ATTENTION_ICON[it.kind]}</span>
                <span className="min-w-0">
                  <span className="font-medium text-ink">{it.profile_name}</span>
                  <span className={it.urgent ? 'text-red-700 dark:text-red-300' : 'text-muted'}> · {it.label}</span>
                  {it.detail ? <span className={it.urgent ? 'text-red-700 dark:text-red-300' : 'text-muted'}> ({it.detail})</span> : null}
                  {it.urgent ? (
                    <span className="ml-2 align-middle rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">
                      Urgent
                    </span>
                  ) : null}
                </span>
              </Link>
              {orderError?.key === it.key ? (
                <p className="basis-full order-last pl-7 text-sm text-red-600" role="alert">{orderError.text}</p>
              ) : null}
              {it.contact ? (
                <div className="basis-full order-last pl-7">
                  <ContactStrip
                    contact={it.contact}
                    profileId={it.profile_id}
                    size="compact"
                    lead={it.kind === 'out_of_stock' || it.kind === 'reorder_overdue' ? 'Reorder from' : 'Who with'}
                    book={false}
                  />
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-1 shrink-0 ml-auto">
                {it.next_action && (it.next_action.kind === 'call' || it.next_action.kind === 'email' || it.next_action.kind === 'order_online') && it.next_action.href ? (
                  // Call, email or order straight from the alert: these are links.
                  <a
                    href={it.next_action.href}
                    {...(it.next_action.kind === 'order_online' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className={`${CONTACT_LINK} text-xs whitespace-nowrap px-1`}
                  >
                    {it.next_action.label}
                  </a>
                ) : null}
                {it.next_action?.kind === 'book' && it.next_action.href ? (
                  <Button size="xs" variant="secondary" className="whitespace-nowrap" onClick={() => navigate(it.next_action!.href!)}>
                    {it.next_action.label}
                  </Button>
                ) : null}
                {it.kind === 'unrecorded_dose' ? doseActions(it) : null}
                {it.kind === 'still_in_hospital' ? (
                  <>
                    {/* Asked again in a fortnight while the stay stays open. */}
                    <Button size="xs" variant="ghost" className="whitespace-nowrap" loading={dismiss.isPending && dismiss.variables === it.key} onClick={() => dismiss.mutate(it.key)}>
                      Yes, still there
                    </Button>
                    {it.next_action?.href ? (
                      <Button size="xs" variant="secondary" className="whitespace-nowrap" onClick={() => navigate(it.next_action!.href!)}>
                        {it.next_action.label}
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {it.dismissible && it.kind !== 'still_in_hospital' ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="whitespace-nowrap"
                    aria-label="Dismiss item"
                    title="Dismiss"
                    onClick={() =>
                      setConfirmDismiss({
                        key: it.key,
                        who: it.profile_name,
                        what: it.detail ?? it.label,
                        warning:
                          it.kind === 'out_of_stock'
                            ? 'This is an urgent item. It will stop showing here until the medication is restocked, so only dismiss it if you have the repeat in hand.'
                            : it.kind === 'reorder_overdue'
                              ? 'It will stop showing here until this medication is marked replenished, so only dismiss it if the order is genuinely in hand.'
                              : 'It will stop showing here.',
                      })
                    }
                  >
                    <CrossIcon />
                  </Button>
                ) : null}
                {pareOn && (it.kind === 'out_of_stock' || it.kind === 'reorder_overdue' || it.kind === 'appointment_cost') ? (
                  <Button
                    size="xs"
                    variant="secondary"
                    className="whitespace-nowrap"
                    title="Upload a receipt or invoice for Pare to file"
                    onClick={() => setIngestFor(it.profile_id)}
                  >
                    File with Pare
                  </Button>
                ) : null}
                {/* The plain next step, with or without Pare: the order is in. */}
                {it.kind === 'out_of_stock' && it.record_id && !it.on_order ? (
                  <Button
                    size="xs"
                    variant="secondary"
                    className="whitespace-nowrap"
                    loading={markOrdered.isPending && markOrdered.variables?.key === it.key}
                    onClick={() => markOrdered.mutate(it)}
                  >
                    Mark as ordered
                  </Button>
                ) : null}
                {!pareOn && (it.kind === 'reorder_overdue' || it.kind === 'appointment_cost') ? (
                  <Link to={itemPath(it)} className={`${CONTACT_LINK} text-xs whitespace-nowrap px-1`}>
                    {it.kind === 'reorder_overdue' ? 'Mark as arrived' : 'Add what it cost'}
                  </Link>
                ) : null}
                {/* The plain next step when nothing else is offered: open the record itself. */}
                {it.next_action?.kind === 'open' && it.next_action.href ? (
                  <Link to={it.next_action.href} className={`${CONTACT_LINK} text-xs whitespace-nowrap px-1`} aria-label={`Open ${it.label}`}>
                    {it.next_action.label}
                  </Link>
                ) : null}
                {pareOn ? (
                  <Button
                    size="xs"
                    variant="secondary"
                    className="whitespace-nowrap"
                    onClick={() => openWithMessage(itemBrief(it), it.profile_id)}
                  >
                    Ask Pare
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {addGpFor ? <GpModal profileId={addGpFor} open onClose={() => setAddGpFor(null)} /> : null}
      {ingestFor ? <IngestModal profileId={ingestFor} onClose={() => setIngestFor(null)} /> : null}

      <Modal open={confirmDismiss !== null} onClose={() => setConfirmDismiss(null)} title="Dismiss this alert">
        <p className="text-sm text-muted mb-4">
          Set aside <span className="font-medium text-ink">{confirmDismiss?.what}</span> for{' '}
          <span className="font-medium text-ink">{confirmDismiss?.who}</span>? {confirmDismiss?.warning}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDismiss(null)}>Cancel</Button>
          <Button variant="danger" loading={dismiss.isPending} onClick={() => confirmDismiss && dismiss.mutate(confirmDismiss.key)}>
            Yes, dismiss
          </Button>
        </div>
      </Modal>
    </div>
  );
}
