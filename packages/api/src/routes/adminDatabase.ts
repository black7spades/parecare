import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { toCSV, parseCSV } from '../services/dataPort';

/**
 * Super-admin data tools: browse, edit, import and export the data the app
 * itself manages, for the "someone saved Austism and now it shows up
 * everywhere" kind of tidy-up. Deliberately NOT the whole database: only
 * the curated tables below are reachable; accounts, tokens, billing,
 * audit and AI internals are not.
 *
 * Safety model: the table must be on the curated list, every table and
 * column name arriving from the client is checked against the live
 * information_schema before it is used, and all values travel as bound
 * parameters, so nothing user-supplied is ever spliced into SQL.
 */
export const adminDatabaseRouter = Router();

adminDatabaseRouter.use(requireAuth, requireRole('super_admin'));

/**
 * The tables surfaced for editing: the shared catalogues that feed
 * suggestions everywhere, and the care records behind the main
 * navigation. One entry per table, with the label the screen shows.
 */
const CURATED_TABLES: Record<string, { label: string; group: string }> = {
  // Shared catalogues: instance-wide lists that feed suggestions, so a
  // typo here repeats everywhere until it is fixed here.
  condition_catalogue: { label: 'Conditions catalogue', group: 'Shared catalogues' },
  symptom_catalogue: { label: 'Symptoms catalogue', group: 'Shared catalogues' },
  medication_catalogue: { label: 'Medications catalogue', group: 'Shared catalogues' },
  option_catalogue: { label: 'Option lists', group: 'Shared catalogues' },
  life_stages: { label: 'Life stages', group: 'Shared catalogues' },
  journey_templates: { label: 'Journey templates', group: 'Shared catalogues' },
  // Care records: the per-person data behind the profile navigation.
  care_profiles: { label: 'Care profiles', group: 'Care records' },
  medical_conditions: { label: 'Conditions', group: 'Care records' },
  condition_symptoms: { label: 'Condition symptoms', group: 'Care records' },
  allergies: { label: 'Allergies', group: 'Care records' },
  medications: { label: 'Medications', group: 'Care records' },
  treatments: { label: 'Treatments', group: 'Care records' },
  appointments: { label: 'Appointments', group: 'Care records' },
  reminders: { label: 'Tasks and reminders', group: 'Care records' },
  providers: { label: 'Providers', group: 'Care records' },
  care_circle_members: { label: 'Care circle members', group: 'Care records' },
  documents: { label: 'Documents', group: 'Care records' },
  open_questions: { label: 'Questions', group: 'Care records' },
  care_log_entries: { label: 'Care log entries', group: 'Care records' },
  memory_book_entries: { label: 'Memory book entries', group: 'Care records' },
};

interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default: string | null;
  is_primary_key: boolean;
}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

async function listTableNames(): Promise<string[]> {
  const rows = await db('information_schema.tables')
    .where({ table_schema: 'public', table_type: 'BASE TABLE' })
    .select('table_name')
    .orderBy('table_name');
  return rows.map((r: { table_name: string }) => r.table_name).filter((name) => name in CURATED_TABLES);
}

async function getColumns(table: string): Promise<ColumnInfo[]> {
  const [cols, pkRows] = await Promise.all([
    db('information_schema.columns')
      .where({ table_schema: 'public', table_name: table })
      .select('column_name', 'data_type', 'is_nullable', 'column_default')
      .orderBy('ordinal_position'),
    db.raw(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public' AND tc.table_name = ? AND tc.constraint_type = 'PRIMARY KEY'`,
      [table]
    ),
  ]);
  const pk = new Set((pkRows.rows as Array<{ column_name: string }>).map((r) => r.column_name));
  return (cols as Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>).map(
    (c) => ({
      name: c.column_name,
      data_type: c.data_type,
      is_nullable: c.is_nullable === 'YES',
      default: c.column_default,
      is_primary_key: pk.has(c.column_name),
    })
  );
}

/** Resolve and validate the :table param; responds 404 itself on failure. */
async function resolveTable(
  tableParam: string | undefined,
  res: { status: (n: number) => { json: (b: unknown) => void } }
): Promise<{ table: string; columns: ColumnInfo[] } | null> {
  const table = tableParam ?? '';
  if (!IDENTIFIER.test(table) || !(await listTableNames()).includes(table)) {
    res.status(404).json({ error: 'Table not found', code: 'NOT_FOUND' });
    return null;
  }
  return { table, columns: await getColumns(table) };
}

/**
 * Values arrive from the client as strings (or JSON values on import).
 * Postgres casts text parameters to the column's type on its own; the only
 * case needing help is a JS object or array headed for a json/jsonb column,
 * which the pg driver would otherwise mis-serialise.
 */
function coerceValue(column: ColumnInfo, value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'object' && (column.data_type === 'json' || column.data_type === 'jsonb')) {
    return JSON.stringify(value);
  }
  return value;
}

/** Render one cell for export: null as empty, objects as JSON, dates as ISO. */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const valuesSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.unknown()), z.array(z.unknown())]));

/** Validate a primary-key object from the request against the table's PK columns. */
function parsePk(
  columns: ColumnInfo[],
  body: unknown
): { ok: true; pk: Record<string, unknown> } | { ok: false; error: string } {
  const pkCols = columns.filter((c) => c.is_primary_key).map((c) => c.name);
  if (pkCols.length === 0) return { ok: false, error: 'This table has no primary key, so rows cannot be targeted individually.' };
  const parsed = z.object({ pk: valuesSchema }).safeParse(body);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };
  const pk: Record<string, unknown> = {};
  for (const col of pkCols) {
    const v = parsed.data.pk[col];
    if (v === undefined || v === null) return { ok: false, error: `Missing primary key value for "${col}".` };
    pk[col] = v;
  }
  return { ok: true, pk };
}

// --- Table catalogue ---

adminDatabaseRouter.get('/tables', async (_req, res) => {
  const names = await listTableNames();
  // n_live_tup is Postgres's own live-row estimate: cheap and close enough
  // for a catalogue listing; the rows endpoint returns exact totals.
  const stats = await db.raw(`SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname = 'public'`);
  const counts = new Map((stats.rows as Array<{ relname: string; n_live_tup: string }>).map((r) => [r.relname, Number(r.n_live_tup)]));
  const tables = names.map((name) => ({
    name,
    label: CURATED_TABLES[name]!.label,
    group: CURATED_TABLES[name]!.group,
    approx_rows: counts.get(name) ?? 0,
  }));
  // Catalogues first (the usual tidy-up target), then care records, each
  // alphabetical by the label people actually see.
  tables.sort((a, b) => b.group.localeCompare(a.group) || a.label.localeCompare(b.label));
  res.json({ tables });
});

adminDatabaseRouter.get('/tables/:table', async (req, res) => {
  const resolved = await resolveTable(req.params.table, res);
  if (!resolved) return;
  res.json({
    table: resolved.table,
    columns: resolved.columns,
    primary_key: resolved.columns.filter((c) => c.is_primary_key).map((c) => c.name),
  });
});

// --- Rows: paginated, sortable, searchable ---

const rowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.string().regex(IDENTIFIER).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().max(500).optional(),
});

adminDatabaseRouter.get('/tables/:table/rows', async (req, res) => {
  const resolved = await resolveTable(req.params.table, res);
  if (!resolved) return;
  const { table, columns } = resolved;

  const parsed = rowsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', code: 'VALIDATION_ERROR' });
    return;
  }
  const { page, per_page, sort, order, search } = parsed.data;
  if (sort && !columns.some((c) => c.name === sort)) {
    res.status(400).json({ error: 'Unknown sort column', code: 'VALIDATION_ERROR' });
    return;
  }

  const base = () => {
    const q = db(table);
    if (search) {
      q.where((qb) => {
        for (const col of columns) {
          qb.orWhereRaw('CAST(?? AS TEXT) ILIKE ?', [col.name, `%${search}%`]);
        }
      });
    }
    return q;
  };

  const pkCols = columns.filter((c) => c.is_primary_key).map((c) => c.name);
  const rowsQuery = base();
  if (sort) rowsQuery.orderBy(sort, order);
  // A stable tiebreak keeps pagination consistent between requests.
  for (const pkCol of pkCols) {
    if (pkCol !== sort) rowsQuery.orderBy(pkCol, 'asc');
  }

  const [rows, totalRow] = await Promise.all([
    rowsQuery.limit(per_page).offset((page - 1) * per_page),
    base().count<{ count: string }>('* as count').first(),
  ]);

  res.json({ rows, total: Number(totalRow?.count ?? 0), page, per_page });
});

// --- Row writes ---

adminDatabaseRouter.post('/tables/:table/rows', async (req, res) => {
  const resolved = await resolveTable(req.params.table, res);
  if (!resolved) return;
  const parsed = z.object({ values: valuesSchema }).safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data.values).length === 0) {
    res.status(400).json({ error: 'Provide at least one column value', code: 'VALIDATION_ERROR' });
    return;
  }
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data.values)) {
    const column = resolved.columns.find((c) => c.name === key);
    if (!column) {
      res.status(400).json({ error: `Unknown column "${key}"`, code: 'VALIDATION_ERROR' });
      return;
    }
    record[key] = coerceValue(column, value);
  }
  try {
    const [row] = await db(resolved.table).insert(record).returning('*');
    res.status(201).json({ row });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, code: 'DB_ERROR' });
  }
});

adminDatabaseRouter.post('/tables/:table/rows/update', async (req, res) => {
  const resolved = await resolveTable(req.params.table, res);
  if (!resolved) return;
  const pkResult = parsePk(resolved.columns, req.body);
  if (!pkResult.ok) {
    res.status(400).json({ error: pkResult.error, code: 'VALIDATION_ERROR' });
    return;
  }
  const parsed = z.object({ values: valuesSchema }).safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data.values).length === 0) {
    res.status(400).json({ error: 'Provide at least one column value', code: 'VALIDATION_ERROR' });
    return;
  }
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data.values)) {
    const column = resolved.columns.find((c) => c.name === key);
    if (!column) {
      res.status(400).json({ error: `Unknown column "${key}"`, code: 'VALIDATION_ERROR' });
      return;
    }
    updates[key] = coerceValue(column, value);
  }
  try {
    const rows = await db(resolved.table).where(pkResult.pk).update(updates).returning('*');
    if (rows.length === 0) {
      res.status(404).json({ error: 'Row not found', code: 'NOT_FOUND' });
      return;
    }
    res.json({ row: rows[0] });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, code: 'DB_ERROR' });
  }
});

adminDatabaseRouter.post('/tables/:table/rows/delete', async (req, res) => {
  const resolved = await resolveTable(req.params.table, res);
  if (!resolved) return;
  const pkResult = parsePk(resolved.columns, req.body);
  if (!pkResult.ok) {
    res.status(400).json({ error: pkResult.error, code: 'VALIDATION_ERROR' });
    return;
  }
  try {
    const deleted = await db(resolved.table).where(pkResult.pk).delete();
    if (deleted === 0) {
      res.status(404).json({ error: 'Row not found', code: 'NOT_FOUND' });
      return;
    }
    res.json({ deleted });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, code: 'DB_ERROR' });
  }
});

// --- Export ---

adminDatabaseRouter.get('/tables/:table/export', async (req, res) => {
  const resolved = await resolveTable(req.params.table, res);
  if (!resolved) return;
  const format = req.query['format'] === 'json' ? 'json' : 'csv';
  const { table, columns } = resolved;

  const query = db(table);
  for (const pkCol of columns.filter((c) => c.is_primary_key)) query.orderBy(pkCol.name, 'asc');
  const rows: Array<Record<string, unknown>> = await query;

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${table}-${stamp}.json"`);
    res.send(JSON.stringify(rows, null, 2));
    return;
  }
  const headers = columns.map((c) => c.name);
  const cells = rows.map((r) => headers.map((h) => cellToString(r[h])));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${table}-${stamp}.csv"`);
  res.send(toCSV(headers, cells));
});

// --- Import: adds rows, never overwrites ---

const importSchema = z.object({
  format: z.enum(['csv', 'json']),
  data: z.string().min(1),
});

function normHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[\s_-]+/g, '_');
}

adminDatabaseRouter.post('/tables/:table/import', async (req, res) => {
  const resolved = await resolveTable(req.params.table, res);
  if (!resolved) return;
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
    return;
  }
  const { table, columns } = resolved;
  const byHeader = new Map(columns.map((c) => [normHeader(c.name), c]));

  // Each record maps a column to its incoming value. A blank CSV cell or a
  // missing JSON key means "not provided": the column is omitted so the
  // database default applies.
  const records: Array<Record<string, unknown>> = [];
  if (parsed.data.format === 'json') {
    let data: unknown;
    try {
      data = JSON.parse(parsed.data.data);
    } catch {
      res.status(400).json({ error: 'File is not valid JSON.', code: 'VALIDATION_ERROR' });
      return;
    }
    for (const item of Array.isArray(data) ? data : [data]) {
      const record: Record<string, unknown> = {};
      if (item && typeof item === 'object') {
        for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
          const column = byHeader.get(normHeader(key));
          if (column && value !== undefined) record[column.name] = coerceValue(column, value);
        }
      }
      records.push(record);
    }
  } else {
    const grid = parseCSV(parsed.data.data).filter((r) => r.some((c) => c.trim() !== ''));
    if (grid.length > 0) {
      const headerCols = grid[0]!.map((h) => byHeader.get(normHeader(h)) ?? null);
      for (let r = 1; r < grid.length; r++) {
        const record: Record<string, unknown> = {};
        grid[r]!.forEach((cell, c) => {
          const column = headerCols[c];
          if (column && cell.trim() !== '') record[column.name] = cell;
        });
        records.push(record);
      }
    }
  }

  let imported = 0;
  const errors: Array<{ row: number; message: string }> = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (Object.keys(record).length === 0) {
      errors.push({ row: i + 1, message: `Row ${i + 1}: no columns matched this table.` });
      continue;
    }
    try {
      await db(table).insert(record);
      imported++;
    } catch (err) {
      errors.push({ row: i + 1, message: `Row ${i + 1}: ${(err as Error).message}` });
    }
  }
  res.json({ imported, skipped: errors.length, errors });
});
