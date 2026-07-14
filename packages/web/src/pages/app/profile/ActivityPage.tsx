import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { entityLabel, type ActivityEntry } from '../../../lib/care';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar } from '../../../components/data/DataToolbar';
import { useProfile } from './ProfileLayout';

const ACTION_STYLES: Record<ActivityEntry['action'], string> = {
  created: 'bg-primary-50 text-primary',
  updated: 'bg-amber-50 text-amber-700',
  deleted: 'bg-red-50 text-red-700',
};

const ENTITY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'circle', label: 'Care circle member' },
  { value: 'log', label: 'Care log entry' },
  { value: 'plan', label: 'Care plan' },
  { value: 'checklists', label: 'Checklist item' },
  { value: 'questions', label: 'Question' },
  { value: 'documents', label: 'Document' },
  { value: 'providers', label: 'Provider' },
  { value: 'reminders', label: 'Task' },
  { value: 'messages', label: 'Message' },
  { value: 'journeys', label: 'Care journey' },
  { value: 'memory-book', label: 'Memory' },
  { value: 'care-profiles', label: 'Profile' },
  { value: 'ai', label: 'AI conversation' },
  { value: 'treatments', label: 'Treatment' },
];

const ACTIVITY_SORTS: DataSort<ActivityEntry>[] = [
  {
    key: 'newest',
    label: 'Newest first',
    compare: (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  },
  {
    key: 'oldest',
    label: 'Oldest first',
    compare: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  },
];

const ACTION_FILTER: DataFilter<ActivityEntry> = {
  key: 'action',
  label: 'Action',
  options: [
    { value: 'created', label: 'Created' },
    { value: 'updated', label: 'Updated' },
    { value: 'deleted', label: 'Deleted' },
  ],
  match: (e, v) => e.action === v,
};

export function ActivityPage() {
  const { profile, careName } = useProfile();

  const { data, isLoading } = useQuery({
    queryKey: ['activity', profile.id],
    queryFn: () =>
      api.get<{ entries: ActivityEntry[]; total: number }>(
        `/care-profiles/${profile.id}/activity?limit=5000`
      ),
  });
  const entries = data?.entries ?? [];

  // Build entity type filter from actual data so only relevant options appear.
  const entityTypeFilter: DataFilter<ActivityEntry> = {
    key: 'entity_type',
    label: 'Type',
    options: ENTITY_TYPE_OPTIONS.filter((opt) =>
      entries.some((e) => e.entity_type === opt.value)
    ),
    match: (e, v) => e.entity_type === v,
  };

  const dv = useDataView<ActivityEntry>({
    rows: entries,
    getId: (e) => e.id,
    searchText: (e) =>
      [e.actor_name, e.action, entityLabel(e.entity_type), e.summary].filter(Boolean).join(' '),
    sorts: ACTIVITY_SORTS,
    filters: [ACTION_FILTER, entityTypeFilter],
    defaultPageSize: 50,
  });

  return (
    <div className="card max-w-3xl">
      <h2 className="text-base font-semibold text-ink mb-1">Activity</h2>
      <p className="text-sm text-muted mb-4">
        Every change made to {careName}'s records: who did what, and when.
        Nobody can edit or remove this list.
      </p>

      <DataToolbar
        search={dv.search}
        onSearch={dv.setSearch}
        searchPlaceholder="Search activity..."
        sorts={ACTIVITY_SORTS.map((s) => ({ key: s.key, label: s.label }))}
        sortKey={dv.sortKey}
        onSort={dv.setSortKey}
        filters={[ACTION_FILTER, entityTypeFilter].map((f) => ({
          key: f.key,
          label: f.label,
          options: f.options,
        }))}
        filterValues={dv.filterValues}
        onFilter={dv.setFilter}
        page={dv.page}
        totalPages={dv.totalPages}
        pageSize={dv.pageSize}
        totalFiltered={dv.totalFiltered}
        onPageChange={dv.setPage}
        onPageSizeChange={dv.setPageSize}
      />

      {isLoading ? (
        <p className="text-sm text-muted mt-4">Loading...</p>
      ) : dv.view.length === 0 ? (
        <p className="text-sm text-muted mt-4">
          {entries.length === 0
            ? 'No activity recorded yet.'
            : 'No activity matches your search or filters.'}
        </p>
      ) : (
        <ul className="space-y-3 mt-4">
          {dv.view.map((e) => (
            <li key={e.id} className="flex items-start gap-3 border-b border-border last:border-0 pb-3 last:pb-0">
              <span className={`badge text-xs capitalize shrink-0 ${ACTION_STYLES[e.action]}`}>{e.action}</span>
              <div className="flex-1">
                <p className="text-sm text-ink">
                  <span className="font-medium">{e.actor_name ?? 'A former member'}</span> {e.action} a{' '}
                  {entityLabel(e.entity_type)}
                  {e.summary ? <span className="text-muted">: "{e.summary}"</span> : null}
                </p>
                <p className="text-xs text-muted">{format(new Date(e.created_at), 'EEE d MMM yyyy, HH:mm')}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
