import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, isToday, isYesterday } from 'date-fns';
import { api } from '../../../api/client';
import { entityLabel } from '../../../lib/care';
import { useAuthStore } from '../../../stores/auth';
import { CardEmpty, CardShell, CardTrouble, CardWaiting } from '../CardShell';
import type { CardProps } from '../types';

interface RecentEntry {
  id: string;
  action: 'created' | 'updated' | 'deleted';
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  created_at: string;
  source: 'person' | 'pare' | 'assistant' | null;
  actor_account_id: string | null;
  actor_name: string | null;
}

const SHOWN = 8;

/**
 * What changed since this person last looked. Fetching records the visit,
 * so it is fetched once per visit to the page and kept steady while read.
 * The overview shares it to know which cards have news.
 */
export function useRecentActivity(profileId: string) {
  return useQuery({
    queryKey: ['recent-activity', profileId],
    queryFn: () => api.get<{ since: string; entries: RecentEntry[] }>(`/care-profiles/${profileId}/activity/recent`),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** Which overview card each kind of change belongs to. */
const CARD_FOR: Record<string, string> = {
  conditions: 'conditions',
  neurotypes: 'neurotypes',
  'substance-use': 'substance-use',
  'health-statuses': 'health',
  reminders: 'upcoming',
  appointments: 'upcoming',
  calendar: 'upcoming',
  log: 'log',
  'care-profiles': 'profile',
};

/** The overview cards with something new since the last visit. */
export function freshCardKeys(entries: { entity_type: string }[] | undefined): Set<string> {
  const keys = new Set<string>();
  for (const e of entries ?? []) {
    const k = CARD_FOR[e.entity_type];
    if (k) keys.add(k);
  }
  return keys;
}

const VERB: Record<RecentEntry['action'], string> = { created: 'added', updated: 'changed', deleted: 'removed' };

/** Where each kind of record lives in the profile. */
const SECTION: Record<string, string> = {
  documents: 'documents',
  medications: 'medications',
  conditions: 'conditions',
  allergies: 'allergies',
  treatments: 'treatments',
  reminders: 'tasks',
  appointments: 'appointments',
  calendar: 'calendar',
  log: 'logs',
  circle: 'circle',
  plan: 'plan',
  checklists: 'plan',
  questions: 'questions',
  providers: 'providers',
  messages: 'messages',
  journeys: 'journey',
  'memory-book': 'memory-book',
  'health-statuses': 'health-status',
  'care-needs': 'care-needs',
  neurotypes: 'neurotypes',
  'substance-use': 'substance-use',
};

const plural = (word: string, n: number): string => {
  if (n === 1) return word;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|sh|ch|x)$/.test(word)) return `${word}es`;
  return `${word}s`;
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dayHeading(d: Date): string {
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEE d MMM');
}

/** "4 medications, 2 documents and 1 condition" from what was added. */
function addedSummary(entries: RecentEntry[]): string | null {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.action === 'created') counts.set(e.entity_type, (counts.get(e.entity_type) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${n} ${plural(entityLabel(type), n)}`);
  if (parts.length === 0) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Added ${list}.`;
}

/**
 * What changed since this person last looked, newest first, grouped by day.
 * The date in the heading is their last visit, so a busy week shows up and
 * a quiet one says so.
 */
export function RecentActivityCard({ profileId }: CardProps) {
  const myId = useAuthStore((s) => s.account?.id);
  const { data, isLoading, isError } = useRecentActivity(profileId);

  const since = data ? format(new Date(data.since), 'dd/MM/yyyy') : null;
  const title = since ? `Recent activity since ${since}` : undefined;

  if (isLoading) return <CardShell><CardWaiting /></CardShell>;
  if (isError || !data) return <CardShell><CardTrouble what="Recent activity" /></CardShell>;

  const allLink = (
    <Link to={`/app/${profileId}/activity`} className="text-sm text-primary hover:underline">
      See all activity
    </Link>
  );

  if (data.entries.length === 0) {
    return (
      <CardShell title={title}>
        <CardEmpty says={`Nothing new since ${since}.`}>{allLink}</CardEmpty>
      </CardShell>
    );
  }

  const shown = data.entries.slice(0, SHOWN);
  const groups: { day: string; items: RecentEntry[] }[] = [];
  for (const e of shown) {
    const day = dayHeading(new Date(e.created_at));
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }
  const added = addedSummary(data.entries);
  const more = data.entries.length - shown.length;

  return (
    <CardShell title={title}>
      <div className="space-y-3">
        {added ? <p className="text-sm text-ink">{added}</p> : null}
        {groups.map((g) => (
          <div key={g.day}>
            <p className="text-xs font-medium text-muted mb-1">{g.day}</p>
            <ul className="space-y-1">
              {g.items.map((e) => {
                const who =
                  e.source === 'pare' ? 'Pare' : e.actor_account_id && e.actor_account_id === myId ? 'You' : e.actor_name ?? 'Someone';
                const kind = entityLabel(e.entity_type);
                const section = SECTION[e.entity_type];
                const what = e.summary ? (
                  <>
                    <span className="font-medium text-ink">{e.summary}</span>{' '}
                    <span className="text-muted">{kind} {VERB[e.action]}</span>
                  </>
                ) : (
                  <span className="text-ink">{capitalise(kind)} {VERB[e.action]}</span>
                );
                // Every list opens its records by ?record=<id>, so a line goes
                // straight to the record it is about while that record exists.
                const target = section
                  ? `/app/${profileId}/${section}${e.entity_id && e.action !== 'deleted' ? `?record=${e.entity_id}` : ''}`
                  : null;
                return (
                  <li key={e.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words">
                      {target ? (
                        <Link to={target} className="hover:underline">{what}</Link>
                      ) : (
                        what
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {who}, {format(new Date(e.created_at), 'HH:mm')}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <p className="text-xs text-muted">
          {more > 0 ? `${more} more. ` : ''}
          {allLink}
        </p>
      </div>
    </CardShell>
  );
}
