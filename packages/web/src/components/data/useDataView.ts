import { useMemo, useState } from 'react';

/**
 * Generic client-side sort / filter / multi-select for any list of records.
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
  compare: (a: T, b: T) => number;
}

export interface DataFilter<T> {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  match: (row: T, value: string) => boolean;
}

interface UseDataViewOptions<T> {
  rows: T[];
  getId: (row: T) => string;
  searchText?: (row: T) => string;
  sorts?: DataSort<T>[];
  filters?: DataFilter<T>[];
}

export function useDataView<T>({ rows, getId, searchText, sorts = [], filters = [] }: UseDataViewOptions<T>) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(sorts[0]?.key ?? '');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const view = useMemo(() => {
    let out = rows;
    const q = search.trim().toLowerCase();
    if (q && searchText) out = out.filter((r) => searchText(r).toLowerCase().includes(q));
    for (const f of filters) {
      const v = filterValues[f.key];
      if (v) out = out.filter((r) => f.match(r, v));
    }
    const sort = sorts.find((s) => s.key === sortKey);
    if (sort) out = [...out].sort(sort.compare);
    return out;
  }, [rows, search, sortKey, filterValues, sorts, filters, searchText]);

  const setFilter = (key: string, value: string) => setFilterValues((prev) => ({ ...prev, [key]: value }));

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
  const selectedRows = view.filter((r) => selected.has(getId(r)));

  return {
    search, setSearch,
    sortKey, setSortKey,
    filterValues, setFilter,
    view,
    selected, toggle, toggleAll, allSelected, clearSelection, selectedRows,
  };
}
