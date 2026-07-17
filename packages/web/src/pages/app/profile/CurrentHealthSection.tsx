import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import {
  conditionCategoryLabel,
  conditionStatusLabel,
  type MedicalCondition,
} from '../../../lib/care';
import { SymptomsSection } from './ConditionSymptoms';

/**
 * A condition that belongs in Current Health: something the person is going
 * through right now (an illness, an injury, a recovery), not a permanent or
 * long-term condition. Mirrors the server-side classification in
 * services/healthAlerts.ts.
 */
const TEMPORARY_CATEGORIES = new Set(['illness', 'injury', 'post_operative', 'recovery', 'chronic_flare', 'acute_illness']);

export function isCurrentHealthCondition(c: MedicalCondition): boolean {
  if (c.status === 'resolved' || c.resolved_on) return false;
  if (c.is_permanent) return false;
  if (c.category === 'neurotype' || c.category === 'disability') return false;
  if (c.category && TEMPORARY_CATEGORIES.has(c.category)) return true;
  if (c.is_temporary) return true;
  if (c.condition_type === 'acute') return true;
  if (c.expected_duration === 'self_limiting' || c.expected_duration === 'short_term') return true;
  return false;
}

const STATUS_DOT: Record<string, string> = {
  active: 'bg-red-500',
  improving: 'bg-blue-500',
  managed: 'bg-amber-500',
};

/**
 * What the person is going through right now: every unresolved illness,
 * injury or recovery from Conditions, each with its symptom sliders so a
 * change can be logged on the spot. Every slider move is kept as a dated
 * reading against that specific illness, which is what drives the GP
 * alert banners.
 */
export function CurrentHealthSection({
  profileId,
  canEdit,
  careName,
}: {
  profileId: string;
  canEdit: boolean;
  careName: string;
}) {
  const { data } = useQuery({
    queryKey: ['conditions', profileId],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profileId}/conditions`),
  });
  const current = (data?.conditions ?? [])
    .filter(isCurrentHealthCondition)
    .sort((a, b) => (b.started_on ?? '').localeCompare(a.started_on ?? '') || a.name.localeCompare(b.name));

  if (current.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing going on right now. When {careName} has an illness or injury, record it under{' '}
        <Link to="conditions" className="text-primary hover:underline">
          Conditions
        </Link>{' '}
        and it will show here with its symptoms.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Illnesses and injuries {careName} is going through right now. Slide a symptom to log how it is
          today; every change is kept as a dated reading for that illness.
        </p>
        <Link to="conditions" className="text-xs text-primary hover:underline whitespace-nowrap">
          Manage conditions
        </Link>
      </div>
      {current.map((c) => (
        <div key={c.id} className="rounded-md border border-border p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[c.status] ?? 'bg-surface-2'}`} />
            <span className="text-sm font-medium text-ink">{c.name}</span>
            {c.category ? <span className="text-xs text-muted">{conditionCategoryLabel(c.category)}</span> : null}
            <span className="text-xs text-muted">{conditionStatusLabel(c.status)}</span>
            {c.started_on ? (
              <span className="text-xs text-muted">since {format(new Date(c.started_on), 'd MMM yyyy')}</span>
            ) : null}
            {c.is_contagious ? (
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">Contagious</span>
            ) : null}
            {c.region ? <span className="text-xs text-muted">{c.region}</span> : null}
          </div>
          <div className="mt-3">
            <SymptomsSection profileId={profileId} conditionId={c.id} canEdit={canEdit} showIntro={false} />
          </div>
        </div>
      ))}
    </div>
  );
}
