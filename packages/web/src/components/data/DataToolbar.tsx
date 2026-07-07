import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

const SELECT = 'rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export interface ToolbarBulkAction {
  key: string;
  label: string;
  destructive?: boolean;
  onRun: () => void;
}

interface DataToolbarProps {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  sorts?: { key: string; label: string }[];
  sortKey?: string;
  onSort?: (key: string) => void;
  filters?: { key: string; label: string; options: { value: string; label: string }[] }[];
  filterValues?: Record<string, string>;
  onFilter?: (key: string, value: string) => void;
  // Selection / bulk actions (only supply actions the viewer is allowed to run).
  selectedCount?: number;
  bulkActions?: ToolbarBulkAction[];
  onClearSelection?: () => void;
}

/**
 * Reusable controls for a listed data view: search, sort, faceted filters,
 * and — when rows are selected and the viewer has permitted actions — a bulk
 * action bar. Drop above any table and drive it with useDataView.
 */
export function DataToolbar({
  search, onSearch, searchPlaceholder = 'Search…',
  sorts = [], sortKey, onSort,
  filters = [], filterValues = {}, onFilter,
  selectedCount = 0, bulkActions = [], onClearSelection,
}: DataToolbarProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[12rem]">
          <Input aria-label="Search" placeholder={searchPlaceholder} value={search} onChange={(e) => onSearch(e.target.value)} />
        </div>
        {filters.filter((f) => f.options.length > 0).map((f) => (
          <select
            key={f.key}
            className={SELECT}
            aria-label={f.label}
            value={filterValues[f.key] ?? ''}
            onChange={(e) => onFilter?.(f.key, e.target.value)}
          >
            <option value="">All {f.label.toLowerCase()}</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {sorts.length > 0 ? (
          <select className={SELECT} aria-label="Sort" value={sortKey} onChange={(e) => onSort?.(e.target.value)}>
            {sorts.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        ) : null}
      </div>

      {selectedCount > 0 && bulkActions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary-100 bg-primary-50 px-3 py-2">
          <span className="text-sm text-ink font-medium">{selectedCount} selected</span>
          <div className="flex flex-wrap gap-2">
            {bulkActions.map((a) => (
              <Button key={a.key} size="sm" variant={a.destructive ? 'danger' : 'secondary'} onClick={a.onRun}>
                {a.label}
              </Button>
            ))}
          </div>
          <button type="button" className="ml-auto text-xs text-primary hover:underline" onClick={onClearSelection}>
            Clear selection
          </button>
        </div>
      ) : null}
    </div>
  );
}
