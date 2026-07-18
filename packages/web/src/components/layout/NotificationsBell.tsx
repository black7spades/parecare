import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { api } from '../../api/client';
import { browserTimeZone } from '../../lib/datetime';

/**
 * The notification bell. Counts everything new across every care profile
 * this account can see — one notification per new thing in any section —
 * and clicking a notification marks it read and goes to the page where the
 * new thing lives.
 */

interface NotificationItem {
  key: string;
  kind: 'activity' | 'supply_low' | 'supply_out' | 'dose_overdue' | 'care_plan_ready';
  profile_id: string;
  profile_name: string;
  actor_name: string | null;
  action: 'created' | 'updated' | 'deleted' | null;
  entity_type: string | null;
  summary: string | null;
  medication_name: string | null;
  missed_count: number | null;
  urgent: boolean;
  created_at: string;
  read: boolean;
}

/** Where each kind of record lives, and what to call it in a sentence. */
const ENTITY_TARGETS: Record<string, { page: string; noun: string }> = {
  circle: { page: 'circle', noun: 'a care circle member' },
  log: { page: '', noun: 'a care log entry' },
  plan: { page: 'plan', noun: 'the care plan' },
  checklists: { page: 'journey', noun: 'a care journey item' },
  journeys: { page: 'journey', noun: 'a care journey' },
  allergies: { page: 'plan', noun: 'an allergy' },
  conditions: { page: '', noun: 'a condition' },
  questions: { page: 'questions', noun: 'a question' },
  documents: { page: 'documents', noun: 'a document' },
  providers: { page: 'providers', noun: 'a provider' },
  reminders: { page: 'tasks', noun: 'a task' },
  medications: { page: 'medications', noun: 'a treatment' },
  treatments: { page: 'medications', noun: 'a treatment' },
  messages: { page: 'messages', noun: 'a message' },
  'memory-book': { page: 'memory-book', noun: 'a memory' },
  calendar: { page: 'calendar', noun: 'a calendar event' },
};

const VERBS: Record<string, string> = { created: 'added', updated: 'updated', deleted: 'removed' };

function itemText(item: NotificationItem): string {
  if (item.kind === 'dose_overdue') {
    const n = item.missed_count ?? 1;
    return n === 1
      ? `${item.profile_name}'s dose of ${item.medication_name} is due and not yet recorded.`
      : `${item.profile_name} has ${n} doses of ${item.medication_name} due and not yet recorded today.`;
  }
  if (item.kind === 'supply_out') {
    return `${item.profile_name}'s prescription for ${item.medication_name} is out of stock.`;
  }
  if (item.kind === 'supply_low') {
    return `${item.profile_name}'s prescription for ${item.medication_name} is low.`;
  }
  if (item.kind === 'care_plan_ready') {
    return `${item.profile_name}'s care plan is ready to review.`;
  }
  const who = item.actor_name ?? 'Someone';
  if (item.entity_type === 'messages' && item.action === 'created') {
    return `${who} posted in Messages.`;
  }
  const target = ENTITY_TARGETS[item.entity_type ?? ''];
  const noun = target?.noun ?? 'a record';
  const verb = VERBS[item.action ?? ''] ?? 'changed';
  return `${who} ${verb} ${noun} for ${item.profile_name}${item.summary ? `: ${item.summary}` : ''}.`;
}

function itemPath(item: NotificationItem): string {
  // An unrecorded dose is logged on the Medication record page, not the list.
  if (item.kind === 'dose_overdue') return `/app/${item.profile_id}/mar`;
  const page = ENTITY_TARGETS[item.entity_type ?? '']?.page ?? '';
  return `/app/${item.profile_id}${page ? `/${page}` : ''}`;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // The browser's zone rides along so "a scheduled time has passed today"
  // is judged on the user's clock, not the server's.
  const tz = browserTimeZone();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationItem[]; unread: number }>(`/notifications${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`),
    refetchInterval: 60_000,
  });
  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  const markRead = useMutation({
    mutationFn: (keys: string[]) => api.post('/notifications/read', { keys }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/read-all', {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Close when clicking anywhere outside the panel.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const openItem = (item: NotificationItem) => {
    if (!item.read) markRead.mutate([item.key]);
    setOpen(false);
    navigate(itemPath(item));
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative p-2 rounded-md text-muted hover:text-ink hover:bg-surface-2 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center px-1">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-card shadow-xl z-50">
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border sticky top-0 bg-card">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            <span className="flex items-center gap-3">
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={() => markAllRead.mutate()}
                  className="text-xs text-primary hover:underline"
                >
                  Mark all read
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate('/account/notifications');
                }}
                className="text-xs text-muted hover:text-ink"
              >
                Settings
              </button>
            </span>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">Nothing new. Anything added anywhere in your care circles will show up here.</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={`w-full text-left px-4 py-3 hover:bg-surface-2 transition-colors flex gap-2 ${
                      item.read ? 'opacity-60' : ''
                    }`}
                  >
                    {!item.read ? (
                      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    ) : (
                      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className={`block text-sm ${item.kind === 'supply_low' || item.kind === 'supply_out' || item.kind === 'dose_overdue' ? 'text-red-700 dark:text-red-300' : 'text-ink'}`}>
                        {item.urgent ? (
                          <span className="mr-1.5 align-middle rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">
                            Urgent
                          </span>
                        ) : null}
                        {itemText(item)}
                      </span>
                      <span className="block text-xs text-muted mt-0.5">
                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
