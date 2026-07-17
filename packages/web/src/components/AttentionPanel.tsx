import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAssistantStore } from '../stores/assistant';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { browserTimeZone } from '../lib/datetime';
import { SEVERITY_LABELS } from '../pages/app/profile/ConditionSymptoms';

export interface AttentionItem {
  profile_id: string;
  profile_name: string;
  kind: 'overdue_task' | 'unrecorded_dose' | 'stale_question' | 'out_of_stock' | 'unresolved_outcome';
  label: string;
  detail: string | null;
  section: string;
  key: string;
  urgent: boolean;
  dismissible: boolean;
}

export interface HealthAlert {
  key: string;
  profile_id: string;
  profile_name: string;
  kind: 'persistent_symptoms' | 'unresolved_injury';
  condition_id: string;
  condition_name: string;
  condition_category: string | null;
  since: string;
  days: number;
  symptoms: Array<{ id: string; name: string; severity: number }>;
  gp: { id: string; name: string; organisation: string | null; phone: string | null; booking_link: string | null } | null;
}

const ATTENTION_ICON: Record<AttentionItem['kind'], string> = {
  overdue_task: '⏰',
  unrecorded_dose: '💊',
  stale_question: '❓',
  out_of_stock: '📦',
  unresolved_outcome: '⚠️',
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
    case 'unrecorded_dose':
      return `Record all the doses due for ${who} now${it.detail ? `: ${it.detail}` : ''}. `
        + `Log every one of them in a single action at their scheduled times, using the exact medication names from the record. `
        + `Do not ask me to confirm each one and do not walk me through them one at a time; just log them and tell me what you recorded.`;
    case 'stale_question':
      return `Let's follow up the open question(s) for ${who} that have had no reply. ${useRecord}Draft the actual message to chase an answer here now.`;
    case 'unresolved_outcome':
      return `A task for ${who} was completed with a poor outcome: "${it.detail ?? it.label}". ${useRecord}Help me work out what went wrong and what to do next.`;
    default:
      return `Help me deal with this for ${who}: ${it.label}. ${useRecord}`;
  }
}

const symptomSummary = (a: HealthAlert): string =>
  a.symptoms.map((s) => `${s.name} ${s.severity}/5 ${SEVERITY_LABELS[s.severity - 1] ?? ''}`.trim()).join(', ');

function alertHeadline(a: HealthAlert): string {
  if (a.kind === 'persistent_symptoms') {
    return `${a.condition_name}: symptoms have stayed above moderate for ${a.days} ${a.days === 1 ? 'day' : 'days'}`;
  }
  const months = Math.max(1, Math.round(a.days / 30));
  return `${a.condition_name}: still unresolved after ${months} ${months === 1 ? 'month' : 'months'}`;
}

function alertBrief(a: HealthAlert): string {
  const who = a.profile_name;
  const what =
    a.kind === 'persistent_symptoms'
      ? `${who}'s ${a.condition_name} has had symptoms above moderate for ${a.days} days (${symptomSummary(a)}).`
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
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState<{ key: string; who: string; what: string; warning: string } | null>(null);

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

  if (count === 0) return null;

  return (
    <div className="card py-3 px-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-ink">Needs attention today</span>
        <span className="text-xs text-muted">{count === 1 ? '1 thing' : `${count} things`}</span>
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
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="xs"
                    variant="ghost"
                    className="whitespace-nowrap"
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
                    Dismiss
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    className="whitespace-nowrap"
                    onClick={() => openWithMessage(alertBrief(a), a.profile_id)}
                  >
                    Ask Pare
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-7 text-sm">
                {a.gp ? (
                  <>
                    <span className="text-ink">
                      Consider contacting their GP: <span className="font-medium">{a.gp.name}</span>
                      {a.gp.organisation ? <span className="text-muted"> · {a.gp.organisation}</span> : null}
                    </span>
                    {a.gp.phone ? (
                      <a href={`tel:${a.gp.phone.replace(/[^\d+]/g, '')}`} className="text-primary hover:underline">
                        {a.gp.phone}
                      </a>
                    ) : null}
                    <Link to={`/app/${a.profile_id}/appointments?new=1&provider=${a.gp.id}`}>
                      <Button size="xs" variant="secondary">Book appointment</Button>
                    </Link>
                  </>
                ) : (
                  <span className="text-ink">
                    Consider contacting their GP. No GP is on file yet:{' '}
                    <Link to={`/app/${a.profile_id}/providers`} className="text-primary hover:underline">
                      add their GP under Providers
                    </Link>
                  </span>
                )}
              </div>
            </li>
          ))}
          {items.map((it) => (
            <li
              key={it.key}
              className={`flex flex-wrap items-start gap-x-3 gap-y-2 py-2 -mx-2 px-2 rounded ${
                it.urgent ? 'border-l-2 border-red-500 bg-red-50 dark:bg-red-900/10' : ''
              }`}
            >
              <Link
                to={`/app/${it.profile_id}/${it.section}`}
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
              <div className="flex items-center gap-1 shrink-0">
                {it.dismissible ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="whitespace-nowrap"
                    onClick={() =>
                      setConfirmDismiss({
                        key: it.key,
                        who: it.profile_name,
                        what: it.detail ?? it.label,
                        warning:
                          it.kind === 'out_of_stock'
                            ? 'This is an urgent item. It will stop showing here until the medication is restocked, so only dismiss it if you have the repeat in hand.'
                            : 'It will stop showing here.',
                      })
                    }
                  >
                    Dismiss
                  </Button>
                ) : null}
                <Button
                  size="xs"
                  variant="secondary"
                  className="whitespace-nowrap"
                  onClick={() => openWithMessage(itemBrief(it), it.profile_id)}
                >
                  Ask Pare
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

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
