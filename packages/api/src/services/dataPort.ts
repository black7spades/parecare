/**
 * Reusable data import/export toolkit.
 *
 * Domain-agnostic: give it a set of columns (how each field serialises and
 * which header names to accept on import) and a per-record coercion function
 * (typically a zod parse), and it will export rows to CSV or JSON and import
 * CSV or JSON back into validated records. Any resource in the system can plug
 * in a small descriptor rather than re-implementing parsing and file handling.
 */

export type PortFormat = 'csv' | 'json';

export interface PortColumn<Row> {
  /** Canonical field key used in the coerced record. */
  key: string;
  /** Header written on export and the primary header matched on import. */
  header: string;
  /** Extra header spellings accepted on import (matched case/space-insensitively). */
  aliases?: string[];
  /** How this field renders in an exported row. */
  toCell: (row: Row) => string;
}

export interface PortDescriptor<Row, Parsed> {
  /** Human name, e.g. "medications" — used for filenames and messages. */
  resource: string;
  columns: PortColumn<Row>[];
  /**
   * Turn one raw imported record (canonical key -> string) into a validated
   * value, or an error message. Usually wraps a zod schema.
   */
  coerce: (raw: Record<string, string>, rowNumber: number) => { ok: true; value: Parsed } | { ok: false; error: string };
}

export interface ImportResult<Parsed> {
  records: Parsed[];
  errors: { row: number; message: string }[];
  /** Total data records seen (excludes the CSV header row). */
  total: number;
}

// --- CSV primitives (RFC 4180-ish: quoted fields, doubled quotes, CRLF) ---

function needsQuoting(value: string): boolean {
  return /[",\r\n]/.test(value);
}

function encodeCell(value: string): string {
  return needsQuoting(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCSV(headers: string[], rows: string[][]): string {
  const lines = [headers.map(encodeCell).join(',')];
  for (const row of rows) lines.push(row.map(encodeCell).join(','));
  return lines.join('\r\n');
}

/** Parse CSV text into an array of rows, each an array of cell strings. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  // Strip a UTF-8 BOM if present.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  // Flush the final cell/row unless the input ended on a clean newline.
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

// --- Header normalisation for import matching ---

function normHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[\s_-]+/g, ' ');
}

/** Build a lookup from any accepted header spelling to the canonical key. */
function headerIndex<Row>(columns: PortColumn<Row>[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const col of columns) {
    idx.set(normHeader(col.header), col.key);
    idx.set(normHeader(col.key), col.key);
    for (const a of col.aliases ?? []) idx.set(normHeader(a), col.key);
  }
  return idx;
}

// --- Export ---

export function exportRecords<Row, Parsed>(
  descriptor: PortDescriptor<Row, Parsed>,
  rows: Row[],
  format: PortFormat
): { body: string; contentType: string; filename: string } {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    const objects = rows.map((r) => {
      const o: Record<string, string> = {};
      for (const col of descriptor.columns) o[col.key] = col.toCell(r);
      return o;
    });
    return {
      body: JSON.stringify(objects, null, 2),
      contentType: 'application/json',
      filename: `${descriptor.resource}-${stamp}.json`,
    };
  }
  const headers = descriptor.columns.map((c) => c.header);
  const cells = rows.map((r) => descriptor.columns.map((c) => c.toCell(r)));
  return {
    body: toCSV(headers, cells),
    contentType: 'text/csv; charset=utf-8',
    filename: `${descriptor.resource}-${stamp}.csv`,
  };
}

// --- Import ---

export function importRecords<Row, Parsed>(
  descriptor: PortDescriptor<Row, Parsed>,
  text: string,
  format: PortFormat
): ImportResult<Parsed> {
  const idx = headerIndex(descriptor.columns);
  const raws: Record<string, string>[] = [];

  if (format === 'json') {
    let data: unknown;
    try { data = JSON.parse(text); } catch { return { records: [], errors: [{ row: 0, message: 'File is not valid JSON.' }], total: 0 }; }
    const arr = Array.isArray(data) ? data : [data];
    for (const item of arr) {
      if (!item || typeof item !== 'object') { raws.push({}); continue; }
      const raw: Record<string, string> = {};
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        const key = idx.get(normHeader(k));
        if (key) raw[key] = v == null ? '' : String(v);
      }
      raws.push(raw);
    }
  } else {
    const grid = parseCSV(text).filter((r) => r.some((c) => c.trim() !== ''));
    if (grid.length === 0) return { records: [], errors: [], total: 0 };
    const headers = grid[0]!.map((h) => idx.get(normHeader(h)) ?? null);
    for (let r = 1; r < grid.length; r++) {
      const raw: Record<string, string> = {};
      grid[r]!.forEach((cell, c) => {
        const key = headers[c];
        if (key) raw[key] = cell.trim();
      });
      raws.push(raw);
    }
  }

  const records: Parsed[] = [];
  const errors: { row: number; message: string }[] = [];
  raws.forEach((raw, i) => {
    const result = descriptor.coerce(raw, i + 1);
    if (result.ok) records.push(result.value);
    else errors.push({ row: i + 1, message: result.error });
  });
  return { records, errors, total: raws.length };
}
