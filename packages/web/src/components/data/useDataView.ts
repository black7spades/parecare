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
  options: { value: string; label: string }[];
  match: (row: T, value: string) => boolean;
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
  const [sortKey, setSortKey] = useState(sorts[0]?.key ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(sorts[0]?.defaultDir ?? 'asc');
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
  const handleSetSortKey = (key: string) => {
    setSortKey(key);
    setSortDir(sorts.find((s) => s.key === key)?.defaultDir ?? 'asc');
  };

  const toggleSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else handleSetSortKey(key);
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
