/**
 * A table column header that sorts a useDataView list: click to sort by the
 * column, click again to flip ascending/descending. The arrow marks the
 * active column and direction. Pair with the `sortKey`, `sortDir` and
 * `toggleSort` a useDataView instance returns.
 */
export function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onToggle,
  className = '',
}: {
  label: string;
  sortKey: string;
  activeKey: string;
  dir: 'asc' | 'desc';
  onToggle: (key: string) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th
      className={`px-3 py-2 font-medium ${className}`}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        className={`flex items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}
        onClick={() => onToggle(sortKey)}
        title={active ? `Sorted ${dir === 'asc' ? 'ascending' : 'descending'}. Click to reverse.` : `Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span aria-hidden="true" className={active ? '' : 'opacity-0'}>
          {active && dir === 'desc' ? '▼' : '▲'}
        </span>
      </button>
    </th>
  );
}
