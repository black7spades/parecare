import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { ConditionModal } from '../../../components/QuickAddModals';
import { conditionCategoryLabel, conditionStatusLabel, type MedicalCondition } from '../../../lib/care';
import { CardShell } from '../CardShell';
import type { CardProps } from '../types';

/** What is going on with somebody's health, and a way to add to it. */
export function ConditionsCard({ profileId, canEdit, careName }: CardProps) {
  return (
    <CardShell>
      <ConditionsOverview profileId={profileId} canEdit={canEdit} careName={careName} />
    </CardShell>
  );
}

function buildConditionsSummary(conditions: MedicalCondition[], careName: string): string {
  if (conditions.length === 0) return '';
  const active = conditions.filter((c) => c.status !== 'resolved');
  const resolved = conditions.filter((c) => c.status === 'resolved');
  const neurotypes = active.filter((c) => c.category === 'neurotype');
  const chronic = active.filter((c) => c.condition_type === 'chronic' && c.category !== 'neurotype');
  const acute = active.filter((c) => c.condition_type === 'acute' || c.category === 'illness' || c.category === 'acute_illness');
  const other = active.filter(
    (c) => !neurotypes.includes(c) && !chronic.includes(c) && !acute.includes(c)
  );

  const parts: string[] = [];

  if (neurotypes.length > 0) {
    parts.push(
      `${careName} is neurodivergent: ${neurotypes.map((c) => c.name).join(', ')}.`
    );
  }

  if (chronic.length > 0) {
    const managed = chronic.filter((c) => c.status === 'managed');
    if (managed.length === chronic.length) {
      parts.push(`${chronic.length === 1 ? 'Has' : 'Has'} ${chronic.map((c) => c.name).join(', ')}, currently managed.`);
    } else {
      parts.push(`Living with ${chronic.map((c) => `${c.name}${c.severity ? ` (${c.severity})` : ''}`).join(', ')}.`);
    }
  }

  if (acute.length > 0) {
    parts.push(`Currently dealing with ${acute.map((c) => c.name).join(', ')}.`);
  }

  if (other.length > 0) {
    parts.push(`Also recorded: ${other.map((c) => c.name).join(', ')}.`);
  }

  if (resolved.length > 0) {
    parts.push(`${resolved.length} resolved ${resolved.length === 1 ? 'condition' : 'conditions'}.`);
  }

  return parts.join(' ');
}

function ConditionsOverview({
  profileId,
  canEdit,
  careName,
}: {
  profileId: string;
  canEdit: boolean;
  careName: string;
}) {
  const [viewMode, setViewMode] = useState<'summary' | 'list'>('summary');
  const [adding, setAdding] = useState(false);

  const { data } = useQuery({
    queryKey: ['conditions', profileId],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profileId}/conditions`),
  });
  const conditions = data?.conditions ?? [];
  const sorted = [...conditions].sort((a, b) => a.name.localeCompare(b.name));

  if (conditions.length === 0) {
    return (
      <div>
        <p className="text-sm text-muted">No conditions recorded yet.</p>
        {canEdit ? (
          <>
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => setAdding(true)}>
              Add condition
            </Button>
            <ConditionModal profileId={profileId} open={adding} onClose={() => setAdding(false)} />
          </>
        ) : null}
      </div>
    );
  }

  const summary = buildConditionsSummary(conditions, careName);

  const pillClass = (active: boolean) =>
    active
      ? 'px-3 py-1 text-xs rounded-full bg-card text-ink font-medium shadow-sm'
      : 'px-3 py-1 text-xs rounded-full text-muted hover:text-ink';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-full bg-surface-2 p-0.5">
          <button type="button" className={pillClass(viewMode === 'summary')} onClick={() => setViewMode('summary')}>
            Summary
          </button>
          <button type="button" className={pillClass(viewMode === 'list')} onClick={() => setViewMode('list')}>
            A-Z list
          </button>
        </div>
        <Link to="conditions" className="text-xs text-primary hover:underline">
          Manage conditions
        </Link>
      </div>

      {viewMode === 'summary' ? (
        <p className="text-sm text-ink leading-relaxed">{summary}</p>
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map((c) => (
            <li key={c.id} className="py-1.5 flex items-center gap-3 text-sm">
              <span className="text-ink font-medium min-w-0 truncate">{c.name}</span>
              {c.category ? <span className="text-xs text-muted">{conditionCategoryLabel(c.category)}</span> : null}
              <span className="text-xs text-muted">{conditionStatusLabel(c.status)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
