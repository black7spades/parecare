import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { browserTimeZone } from '../../lib/datetime';

/**
 * What's new: everything happening across the care circles this person can
 * see, on one page. The same feed as the header bell, given room to breathe:
 * what needs attention first, then the rest by recency. Opening one marks it
 * read and goes to where it lives.
 *
 * The alerts a person sets up for themselves (a medication running low, an
 * appointment coming up, a digest by email) are arranged under Notifications;
 * this page is the always-on record of what has actually happened.
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
  if (item.kind === 'supply_out') return `${item.profile_name}'s prescription for ${item.medication_name} is out of stock.`;
  if (item.kind === 'supply_low') return `${item.profile_name}'s prescription for ${item.medication_name} is low.`;
  if (item.kind === 'care_plan_ready') return `${item.profile_name}'s care plan is ready to review.`;
  const who = item.actor_name ?? 'Someone';
  if (item.entity_type === 'messages' && item.action === 'created') return `${who} posted in ${item.profile_name}'s messages.`;
  const target = ENTITY_TARGETS[item.entity_type ?? ''];
  const noun = target?.noun ?? 'a record';
  const verb = VERBS[item.action ?? ''] ?? 'changed';
  return `${who} ${verb} ${noun} for ${item.profile_name}${item.summary ? `: ${item.summary}` : ''}.`;
}

function itemPath(item: NotificationItem): string {
  if (item.kind === 'dose_overdue') return `/app/${item.profile_id}/mar`;
  const page = ENTITY_TARGETS[item.entity_type ?? '']?.page ?? '';
  return `/app/${item.profile_id}${page ? `/${page}` : ''}`;
}

export function WhatsNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tz = browserTimeZone();

  const { data, isLoading } = useQuery({
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

  const open = (item: NotificationItem) => {
    if (!item.read) markRead.mutate([item.key]);
    navigate(itemPath(item));
  };

  const urgent = items.filter((i) => i.urgent);
  const rest = items.filter((i) => !i.urgent);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1>What's new</h1>
          <p className="text-sm text-muted">
            Everything happening across the people in your care. Choose what reaches you, and where, in{' '}
            <Link to="/account/notifications" className="text-primary hover:underline">Notifications</Link>.
          </p>
        </div>
        {unread > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => markAllRead.mutate()} loading={markAllRead.isPending}>
            Mark all read
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-muted">Nothing new right now.</p>
          <p className="text-sm text-muted mt-1">Anything added or changed anywhere in your care circles will show up here.</p>
        </div>
      ) : (
        <>
          {urgent.length > 0 ? <FeedList title="Needs attention" items={urgent} onOpen={open} /> : null}
          <FeedList title={urgent.length > 0 ? 'Everything else' : 'Recent'} items={rest} onOpen={open} />
        </>
      )}
    </div>
  );
}

function FeedList({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: NotificationItem[];
  onOpen: (item: NotificationItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <ul className="card divide-y divide-border p-0 overflow-hidden">
        {items.map((item) => {
          const medical = item.kind === 'supply_low' || item.kind === 'supply_out' || item.kind === 'dose_overdue';
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className={`w-full text-left px-4 py-3 hover:bg-surface-2 transition-colors flex gap-2 ${item.read ? 'opacity-60' : ''}`}
              >
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.read ? '' : 'bg-primary'}`} />
                <span className="min-w-0">
                  <span className={`block text-sm ${medical ? 'text-red-700 dark:text-red-300' : 'text-ink'}`}>
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
          );
        })}
      </ul>
    </section>
  );
}
