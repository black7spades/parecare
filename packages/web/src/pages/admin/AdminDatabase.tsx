import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { PencilIcon, TrashIcon } from '../../components/ui/icons';
import { Input, Textarea } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { ImportExport } from '../../components/ImportExport';
import {
  adminDatabaseApi,
  type DbColumn,
  type DbRow,
  type DbTable,
  type DbTableSchema,
  type DbValues,
} from '../../api/adminDatabase';

const SELECT_CLASS =
  'rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/** String form of a cell for display and for prefilling the editor. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Column types that get a multi-line editor instead of a single-line input. */
function isLongType(column: DbColumn): boolean {
  return ['json', 'jsonb', 'text', 'ARRAY'].includes(column.data_type);
}

/** The primary key values that target one row, as strings for the API. */
function pkOf(schema: DbTableSchema, row: DbRow): DbValues {
  return Object.fromEntries(schema.primary_key.map((k) => [k, cellText(row[k])]));
}

/**
 * A column header that sorts the table: first click sorts by the column,
 * clicking again flips between ascending and descending.
 */
function SortableHeader({
  column,
  activeKey,
  dir,
  onToggle,
}: {
  column: DbColumn;
  activeKey: string;
  dir: 'asc' | 'desc';
  onToggle: (key: string) => void;
}) {
  const active = activeKey === column.name;
  return (
    <th
      className="px-3 py-2 font-medium whitespace-nowrap"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        className={`flex items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}
        onClick={() => onToggle(column.name)}
        title={
          active
            ? `Sorted ${dir === 'asc' ? 'ascending' : 'descending'}. Click to reverse.`
            : `Sort by ${column.name}`
        }
      >
        {column.name}
        {column.is_primary_key ? (
          <span className="text-muted" title="Primary key: uniquely identifies each row">
            🔑
          </span>
        ) : null}
        <span aria-hidden="true" className={active ? '' : 'opacity-0'}>
          {active && dir === 'desc' ? '▼' : '▲'}
        </span>
      </button>
    </th>
  );
}

/**
 * The add and edit dialog: one field per column, exactly as stored. Values
 * are sent as text and the database casts them to the column's type, so
 * what you type is what psql would accept.
 */
function RowModal({
  schema,
  label,
  row,
  onClose,
  onSaved,
}: {
  schema: DbTableSchema;
  /** The friendly name shown in the dialog title, e.g. "Conditions catalogue". */
  label: string;
  row: DbRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = row !== null;
  const initial = useMemo(() => {
    const values: Record<string, string> = {};
    const nulls = new Set<string>();
    for (const c of schema.columns) {
      values[c.name] = isEdit ? cellText(row[c.name]) : '';
      if (isEdit && (row[c.name] === null || row[c.name] === undefined)) nulls.add(c.name);
    }
    return { values, nulls };
  }, [schema, row, isEdit]);

  const [values, setValues] = useState<Record<string, string>>(initial.values);
  const [nulls, setNulls] = useState<Set<string>>(initial.nulls);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function setValue(name: string, v: string) {
    setValues((prev) => ({ ...prev, [name]: v }));
  }
  function toggleNull(name: string) {
    setNulls((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const out: DbValues = {};
      for (const c of schema.columns) {
        const isNull = nulls.has(c.name);
        const text = values[c.name] ?? '';
        if (isEdit) {
          if (c.is_primary_key) continue;
          const wasNull = initial.nulls.has(c.name);
          if (isNull === wasNull && text === initial.values[c.name]) continue;
          out[c.name] = isNull ? null : text;
        } else {
          // Blank and not explicitly null means the database default applies.
          if (isNull) out[c.name] = null;
          else if (text !== '') out[c.name] = text;
        }
      }
      if (Object.keys(out).length === 0) {
        onClose();
        return;
      }
      if (isEdit) await adminDatabaseApi.updateRow(schema.table, pkOf(schema, row), out);
      else await adminDatabaseApi.insertRow(schema.table, out);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit row in ${label}` : `Add row to ${label}`} wide>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          {isEdit
            ? 'Only the fields you change are written. Tick Null to clear a field entirely.'
            : 'Fields left blank use the database default. Tick Null to store an explicitly empty value.'}
        </p>
        <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          {schema.columns.map((c) => {
            const readOnly = isEdit && c.is_primary_key;
            const isNull = nulls.has(c.name);
            const fieldId = `db-field-${c.name}`;
            return (
              <div key={c.name}>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor={fieldId} className="text-sm font-medium text-ink">
                    {c.name}
                    <span className="ml-2 text-xs font-normal text-muted">
                      {c.data_type}
                      {c.is_primary_key ? ' · primary key' : c.is_nullable ? ' · nullable' : ' · required'}
                    </span>
                  </label>
                  {!readOnly && c.is_nullable ? (
                    <label className="flex items-center gap-1 text-xs text-muted">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary"
                        checked={isNull}
                        onChange={() => toggleNull(c.name)}
                      />
                      Null
                    </label>
                  ) : null}
                </div>
                {readOnly ? (
                  <p className="text-sm text-muted break-all rounded-md border border-border bg-surface px-3 py-2">
                    {cellText(row[c.name]) || 'null'}
                  </p>
                ) : isLongType(c) ? (
                  <Textarea
                    id={fieldId}
                    rows={3}
                    className="font-mono"
                    value={isNull ? '' : values[c.name] ?? ''}
                    disabled={isNull}
                    onChange={(e) => setValue(c.name, e.target.value)}
                  />
                ) : (
                  <Input
                    id={fieldId}
                    className="font-mono"
                    value={isNull ? '' : values[c.name] ?? ''}
                    disabled={isNull}
                    onChange={(e) => setValue(c.name, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            {isEdit ? 'Save changes' : 'Add row'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function AdminDatabase() {
  const [tables, setTables] = useState<DbTable[]>([]);
  const [tableFilter, setTableFilter] = useState('');
  const [table, setTable] = useState('');
  const [schema, setSchema] = useState<DbTableSchema | null>(null);

  const [rows, setRows] = useState<DbRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [sort, setSort] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DbRow | null>(null);
  const [deleting, setDeleting] = useState<DbRow | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    adminDatabaseApi
      .listTables()
      .then((r) => setTables(r.tables))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load tables'));
  }, []);

  // Type-to-search with a short debounce, like every other list.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const openTable = useCallback((name: string) => {
    setTable(name);
    setSchema(null);
    setRows([]);
    setTotal(0);
    setPage(1);
    setSearch('');
    setQuery('');
    setError('');
    adminDatabaseApi
      .getSchema(name)
      .then((s) => {
        setSchema(s);
        // Newest first when the table records creation time, otherwise the
        // primary key, otherwise the first column.
        if (s.columns.some((c) => c.name === 'created_at')) {
          setSort('created_at');
          setOrder('desc');
        } else {
          setSort(s.primary_key[0] ?? s.columns[0]?.name ?? '');
          setOrder('asc');
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load table'));
  }, []);

  const loadRows = useCallback(() => {
    if (!table || !sort) return;
    setLoading(true);
    setError('');
    adminDatabaseApi
      .listRows(table, { page, per_page: perPage, sort, order, search: query || undefined })
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load rows'))
      .finally(() => setLoading(false));
  }, [table, page, perPage, sort, order, query]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  function toggleSort(key: string) {
    if (sort === key) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setOrder('asc');
    }
    setPage(1);
  }

  async function confirmDelete() {
    if (!schema || !deleting) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await adminDatabaseApi.deleteRow(schema.table, pkOf(schema, deleting));
      setDeleting(null);
      loadRows();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleteBusy(false);
    }
  }

  const filteredTables = tables.filter(
    (t) =>
      t.label.toLowerCase().includes(tableFilter.toLowerCase()) ||
      t.name.toLowerCase().includes(tableFilter.toLowerCase())
  );
  const groups = [...new Set(filteredTables.map((t) => t.group))];
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const hasPk = (schema?.primary_key.length ?? 0) > 0;
  const tableLabel = tables.find((t) => t.name === table)?.label ?? table;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-ink">Data tools</h1>
        <p className="text-sm text-muted">
          Tidy the data behind the app: fix a misspelt name in a shared catalogue or correct a care record. Only
          the lists and records already managed in the main navigation are shown here.
        </p>
      </div>

      <div
        className="mb-6 rounded-md border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-900/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
        role="note"
      >
        Edits apply to live records immediately. Fixing a value is safe; be careful with Delete, which permanently
        removes the row and anything recorded against it.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6 items-start">
        <aside className="card p-0 overflow-hidden lg:sticky lg:top-4">
          <div className="p-3 border-b border-border">
            <h2 className="text-sm font-semibold text-ink mb-2">Lists and records</h2>
            <Input
              placeholder="Filter…"
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              aria-label="Filter lists and records"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {groups.map((group) => (
              <div key={group}>
                <h3 className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{group}</h3>
                <ul>
                  {filteredTables
                    .filter((t) => t.group === group)
                    .map((t) => (
                      <li key={t.name}>
                        <button
                          type="button"
                          title={t.name}
                          className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm border-b border-border last:border-0 transition-colors ${
                            t.name === table ? 'bg-primary-50 text-primary font-medium' : 'text-ink hover:bg-surface-2'
                          }`}
                          onClick={() => openTable(t.name)}
                        >
                          <span className="truncate">{t.label}</span>
                          <span className="text-xs text-muted ml-2 shrink-0">{t.approx_rows.toLocaleString()}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
            {filteredTables.length === 0 ? <p className="px-3 py-4 text-sm text-muted">No tables match.</p> : null}
          </div>
          <p className="px-3 py-2 text-xs text-muted border-t border-border">Row counts are estimates.</p>
        </aside>

        <section className="min-w-0">
          {!table ? (
            <div className="card py-12 text-center text-sm text-muted">Choose a list on the left to view its rows.</div>
          ) : !schema ? (
            <div className="card py-12 text-center text-sm text-muted">Loading…</div>
          ) : (
            <>
              <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <Input
                    placeholder="Search all columns…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label={`Search rows in ${tableLabel}`}
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted whitespace-nowrap">
                  Rows per page
                  <select
                    className={SELECT_CLASS}
                    value={perPage}
                    onChange={(e) => {
                      setPerPage(Number(e.target.value));
                      setPage(1);
                    }}
                  >
                    {[25, 50, 100, 200].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-2">
                  <ImportExport
                    key={table}
                    basePath={`/admin/database/tables/${table}`}
                    resource={table}
                    canImport
                    onImported={loadRows}
                    templateHeaders={schema.columns.map((c) => c.name)}
                  />
                  <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
                    Add row
                  </Button>
                </div>
              </div>

              {error ? <p className="text-sm text-red-600 mb-3">{error}</p> : null}
              {!hasPk ? (
                <p className="text-xs text-muted mb-3">
                  This table has no primary key, so rows can be viewed and added but not edited or deleted here.
                </p>
              ) : null}

              <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted border-b border-border">
                      {schema.columns.map((c) => (
                        <SortableHeader key={c.name} column={c} activeKey={sort} dir={order} onToggle={toggleSort} />
                      ))}
                      {hasPk ? <th className="px-3 py-2 font-medium text-right">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={schema.columns.length + 1} className="px-4 py-8 text-center text-muted">
                          Loading…
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={schema.columns.length + 1} className="px-4 py-8 text-center text-muted">
                          {query ? 'No rows match your search.' : 'This table is empty.'}
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, i) => (
                        <tr key={hasPk ? JSON.stringify(pkOf(schema, row)) : i} className="border-b border-border last:border-0 align-top">
                          {schema.columns.map((c) => {
                            const raw = row[c.name];
                            const text = cellText(raw);
                            return (
                              <td key={c.name} className="px-3 py-2 max-w-[16rem]">
                                {raw === null || raw === undefined ? (
                                  <span className="text-xs text-muted italic">null</span>
                                ) : (
                                  <span className="block truncate font-mono text-xs text-ink" title={text}>
                                    {text}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          {hasPk ? (
                            <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                              <Button size="xs" variant="ghost" aria-label="Edit row" title="Edit" onClick={() => setEditing(row)}>
                                <PencilIcon />
                              </Button>
                              <Button size="xs" variant="ghost-danger" aria-label="Delete row" title="Delete" onClick={() => { setDeleting(row); setDeleteError(''); }}>
                                <TrashIcon />
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between text-sm text-muted">
                <span>
                  Page {page} of {totalPages} · {total.toLocaleString()} rows
                </span>
                <div className="space-x-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {schema && adding ? (
        <RowModal schema={schema} label={tableLabel} row={null} onClose={() => setAdding(false)} onSaved={loadRows} />
      ) : null}
      {schema && editing ? (
        <RowModal schema={schema} label={tableLabel} row={editing} onClose={() => setEditing(null)} onSaved={loadRows} />
      ) : null}

      {schema && deleting ? (
        <Modal open onClose={() => setDeleting(null)} title={`Delete row from ${tableLabel}`}>
          <div className="space-y-4">
            <p className="text-sm text-ink">
              This permanently destroys the row and anything that depends on it. There is no undo.
            </p>
            <div className="rounded-md border border-border bg-surface p-3 text-xs font-mono text-muted space-y-1">
              {Object.entries(pkOf(schema, deleting)).map(([k, v]) => (
                <div key={k} className="break-all">
                  <span className="text-ink">{k}</span>: {v}
                </div>
              ))}
            </div>
            {deleteError ? <p className="text-sm text-red-600">{deleteError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={deleteBusy} onClick={() => void confirmDelete()}>
                Delete row
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
