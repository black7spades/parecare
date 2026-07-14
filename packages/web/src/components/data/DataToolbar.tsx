import { useState } from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { PAGE_SIZE_OPTIONS } from './useDataView';

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
  // Pagination (supply all four to enable the pager row).
  page?: number;
  totalPages?: number;
  pageSize?: number;
  totalFiltered?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

/**
 * Reusable controls for a listed data view: search, sort, faceted filters,
 * pagination, and — when rows are selected and the viewer has permitted
 * actions — a bulk action bar. Drop above any table and drive it with
 * useDataView.
 */
export function DataToolbar({
  search, onSearch, searchPlaceholder = 'Search…',
  sorts = [], sortKey, onSort,
  filters = [], filterValues = {}, onFilter,
  selectedCount = 0, bulkActions = [], onClearSelection,
  page, totalPages, pageSize, totalFiltered,
  onPageChange, onPageSizeChange,
}: DataToolbarProps) {
  const hasPagination = page != null && totalPages != null && onPageChange != null;

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
            {bulkActions.filter((a) => !a.destructive).map((a) => (
              <Button key={a.key} size="sm" variant="secondary" onClick={a.onRun}>{a.label}</Button>
            ))}
          </div>
          <button type="button" className="ml-auto text-xs text-primary hover:underline" onClick={onClearSelection}>
            Clear selection
          </button>
          {bulkActions.filter((a) => a.destructive).map((a) => (
            <Button key={a.key} size="sm" variant="danger" onClick={a.onRun}>{a.label}</Button>
          ))}
        </div>
      ) : null}

      {hasPagination && totalFiltered != null && totalFiltered > 0 ? (
        <Pagination
          page={page!}
          totalPages={totalPages!}
          pageSize={pageSize}
          totalFiltered={totalFiltered}
          onPageChange={onPageChange!}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  pageSize,
  totalFiltered,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize?: number;
  totalFiltered: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const [customSize, setCustomSize] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const start = (page - 1) * (pageSize ?? 10) + 1;
  const end = Math.min(page * (pageSize ?? 10), totalFiltered);

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
      <span>
        {start}–{end} of {totalFiltered}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="px-2 py-1 rounded-md hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span className="px-2">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          className="px-2 py-1 rounded-md hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
      {onPageSizeChange && pageSize != null ? (
        <div className="ml-auto flex items-center gap-1.5">
          <span>Show</span>
          <select
            className="rounded-md border border-border bg-card px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={showCustom ? 'custom' : String(pageSize)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom') {
                setShowCustom(true);
                setCustomSize(String(pageSize));
              } else {
                setShowCustom(false);
                onPageSizeChange(Number(v));
              }
            }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={String(n)}>{n}</option>
            ))}
            <option value="custom">Custom</option>
          </select>
          {showCustom ? (
            <input
              type="number"
              min="1"
              max="1000"
              className="w-16 rounded-md border border-border bg-card px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={customSize}
              onChange={(e) => setCustomSize(e.target.value)}
              onBlur={() => {
                const n = parseInt(customSize, 10);
                if (n > 0) onPageSizeChange(n);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = parseInt(customSize, 10);
                  if (n > 0) onPageSizeChange(n);
                }
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
