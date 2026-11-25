import { format } from '../lib/dateFormat';
import { SortableTh } from './data/SortableTh';
import { useDataView, type DataSort } from './data/useDataView';
import { DataToolbar } from './data/DataToolbar';
import { phaseLabel } from '../lib/care';
import { formatDateOnly } from '../lib/datetime';

export interface ReportField {
  key: string;
  label: string;
  type: string;
  enumValues?: string[];
}

export interface ReportSectionResult {
  key: string;
  label: string;
  rows: Record<string, unknown>[];
  fields: ReportField[];
}

export interface ReportResult {
  generatedAt: string;
  profileCount: number;
  sections: ReportSectionResult[];
  aiNarrative?: string;
}

type Row = Record<string, unknown> & { _i: number };

const cellText = (value: unknown, type: string): string => {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'boolean') return value ? 'Yes' : 'No';
  if (type === 'date') {
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatDateOnly(s, 'd MMM yyyy');
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return format(d, 'd MMM yyyy');
  }
  if (type === 'enum') {
    const s = String(value);
    const phase = phaseLabel(s);
    return phase !== s ? phase : s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }
  return String(value);
};

const sortValue = (value: unknown, type: string): string | number => {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value ? 1 : 0;
  if (type === 'date') return new Date(String(value)).getTime() || 0;
  return String(value).toLowerCase();
};

/**
 * One section of a report as a table: one column per detail, every column
 * sortable both ways, with search and pages for a long section.
 */
export function ReportSectionTable({ section }: { section: ReportSectionResult }) {
  const rows: Row[] = section.rows.map((r, i) => ({ ...r, _i: i }));
  const columns: ReportField[] = [{ key: '_profile_name', label: 'Person', type: 'text' }, ...section.fields];
  const sorts: DataSort<Row>[] = columns.map((c) => ({
    key: c.key,
    label: c.label,
    compare: (a, b) => {
      const x = sortValue(a[c.key], c.type);
      const y = sortValue(b[c.key], c.type);
      if (x === '' && y !== '') return 1;
      if (y === '' && x !== '') return -1;
      return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    },
  }));
  const dv = useDataView<Row>({
    rows,
    getId: (r) => String(r._i),
    searchText: (r) => columns.map((c) => cellText(r[c.key], c.type)).join(' '),
    sorts,
    defaultPageSize: 25,
  });
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-ink mb-1">{section.label}</h3>
      <p className="text-xs text-muted mb-3">
        {section.rows.length} {section.rows.length === 1 ? 'record' : 'records'}
      </p>
      {section.rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing to show for this section.</p>
      ) : (
        <div className="space-y-2">
          {section.rows.length > 10 ? (
            <div className="print:hidden">
              <DataToolbar
                search={dv.search}
                onSearch={dv.setSearch}
                searchPlaceholder={`Search ${section.label.toLowerCase()}...`}
                sorts={sorts.map((s) => ({ key: s.key, label: s.label }))}
                sortKey={dv.sortKey}
                onSort={dv.setSortKey}
                page={dv.page}
                totalPages={dv.totalPages}
                pageSize={dv.pageSize}
                totalFiltered={dv.totalFiltered}
                onPageChange={dv.setPage}
                onPageSizeChange={dv.setPageSize}
              />
            </div>
          ) : null}
          <div className="fit-table">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  {columns.map((c) => (
                    <SortableTh key={c.key} label={c.label} sortKey={c.key} activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {(section.rows.length > 10 ? dv.view : dv.filtered).map((row) => (
                  <tr key={row._i} className="border-b border-border last:border-0">
                    {columns.map((c, ci) => {
                      const text = cellText(row[c.key], c.type);
                      return (
                        <td key={c.key} className={`px-3 py-2 ${ci === 0 ? 'font-medium' : ''} ${c.type === 'date' || c.type === 'number' ? 'tabular-nums' : ''}`}>
                          {text ? text : <span className="text-muted">-</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
