import { useMemo, useState } from 'react';

/**
 * Generic client-side sort / filter / paginate / multi-select for any list of
 * records.
 *
 * The domain supplies how to identify a row, its searchable text, the
 * available sorts (each a comparator, so domain sorts like "by time of day"
 * live at the call site), and faceted filters. The hook manages the state and
 * returns the processed view plus a selection set for bulk actions. Pair with
 * <DataToolbar> for the controls.
 */

export interface DataSort<T> {
  key: string;
  label: string;
  /** Ascending comparator; the hook reverses it for descending. */
  compare: (a: T, b: T) => number;
  /** Direction applied when this sort is first chosen. Defaults to 'asc'. */
  defaultDir?: 'asc' | 'desc';
}

export interface DataFilter<T> {
  key: string;
  label: string;
  /** What the "no filter" choice says, when "Any <label>" reads badly. */
  anyLabel?: string;
  options: { value: string; label: string }[];
  match: (row: T, value: string) => boolean;
}

/**
 * Every table remembers the order it was last put in, on this device, so a
 * list sorted newest first stays newest first next time. Keyed by the page
 * (with record ids taken out, so it holds for everyone in your care) and the
 * table's own sort choices, so two tables on one page do not share.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function sortMemoryKey(sortKeys: string[]): string | null {
  if (sortKeys.length === 0 || typeof window === 'undefined') return null;
  return `pc-sort:${window.location.pathname.replace(UUID, ':id')}:${sortKeys.join(',')}`;
}
function readSort(key: string | null): { key: string; dir: 'asc' | 'desc' } | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { key?: unknown; dir?: unknown };
    if (typeof v.key === 'string' && (v.dir === 'asc' || v.dir === 'desc')) return { key: v.key, dir: v.dir };
  } catch {
    // Storage blocked or unreadable: fall back to the table's default.
  }
  return null;
}
function writeSort(key: string | null, value: { key: string; dir: 'asc' | 'desc' }) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the order simply is not remembered.
  }
}

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

interface UseDataViewOptions<T> {
  rows: T[];
  getId: (row: T) => string;
  searchText?: (row: T) => string;
  sorts?: DataSort<T>[];
  filters?: DataFilter<T>[];
  defaultPageSize?: number;
}

export function useDataView<T>({ rows, getId, searchText, sorts = [], filters = [], defaultPageSize = 10 }: UseDataViewOptions<T>) {
  const [search, setSearch] = useState('');
  const memoryKey = useMemo(() => sortMemoryKey(sorts.map((s) => s.key)), [sorts]);
  const [remembered] = useState(() => {
    const r = readSort(memoryKey);
    return r && sorts.some((s) => s.key === r.key) ? r : null;
  });
  const [sortKey, setSortKey] = useState(remembered?.key ?? sorts[0]?.key ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(remembered?.dir ?? sorts[0]?.defaultDir ?? 'asc');

  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const filtered = useMemo(() => {
    let out = rows;
    const q = search.trim().toLowerCase();
    if (q && searchText) out = out.filter((r) => searchText(r).toLowerCase().includes(q));
    for (const f of filters) {
      const v = filterValues[f.key];
      if (v) out = out.filter((r) => f.match(r, v));
    }
    const sort = sorts.find((s) => s.key === sortKey);
    if (sort) {
      out = [...out].sort(sort.compare);
      if (sortDir === 'desc') out.reverse();
    }
    return out;
  }, [rows, search, sortKey, sortDir, filterValues, sorts, filters, searchText]);

  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(page, totalPages);

  const view = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  const setFilter = (key: string, value: string) => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  // Choosing a sort (from a dropdown) starts at its natural direction;
  // clicking the same column header again flips it.
  // Only a choice someone made is remembered, never the default.
  const handleSetSortKey = (key: string) => {
    const dir = sorts.find((s) => s.key === key)?.defaultDir ?? 'asc';
    setSortKey(key);
    setSortDir(dir);
    writeSort(memoryKey, { key, dir });
  };

  const toggleSort = (key: string) => {
    if (key === sortKey) {
      const dir = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(dir);
      writeSort(memoryKey, { key, dir });
    } else handleSetSortKey(key);
  };

  const handleSetPageSize = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const visibleIds = view.map(getId);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => n.delete(id));
      else visibleIds.forEach((id) => n.add(id));
      return n;
    });

  const clearSelection = () => setSelected(new Set());
  const selectedRows = filtered.filter((r) => selected.has(getId(r)));

  return {
    search, setSearch: handleSearch,
    sortKey, setSortKey: handleSetSortKey, sortDir, toggleSort,
    filterValues, setFilter,
    view,
    filtered,
    totalFiltered,
    page: safePage, setPage, totalPages, pageSize, setPageSize: handleSetPageSize,
    selected, toggle, toggleAll, allSelected, clearSelection, selectedRows,
  };
}
