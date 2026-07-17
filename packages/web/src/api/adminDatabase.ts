import { api } from './client';

export interface DbTable {
  name: string;
  label: string;
  group: string;
  approx_rows: number;
}

export interface DbColumn {
  name: string;
  data_type: string;
  is_nullable: boolean;
  default: string | null;
  is_primary_key: boolean;
}

export interface DbTableSchema {
  table: string;
  columns: DbColumn[];
  primary_key: string[];
}

export type DbRow = Record<string, unknown>;

export interface DbRowList {
  rows: DbRow[];
  total: number;
  page: number;
  per_page: number;
}

export interface DbRowsParams {
  page?: number;
  per_page?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
}

/** Values sent to the API: strings that Postgres casts, or explicit null. */
export type DbValues = Record<string, string | null>;

export const adminDatabaseApi = {
  listTables: () => api.get<{ tables: DbTable[] }>('/admin/database/tables'),
  getSchema: (table: string) => api.get<DbTableSchema>(`/admin/database/tables/${table}`),
  listRows: (table: string, params: DbRowsParams = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const query = qs.toString();
    return api.get<DbRowList>(`/admin/database/tables/${table}/rows${query ? `?${query}` : ''}`);
  },
  insertRow: (table: string, values: DbValues) =>
    api.post<{ row: DbRow }>(`/admin/database/tables/${table}/rows`, { values }),
  updateRow: (table: string, pk: DbValues, values: DbValues) =>
    api.post<{ row: DbRow }>(`/admin/database/tables/${table}/rows/update`, { pk, values }),
  deleteRow: (table: string, pk: DbValues) =>
    api.post<{ deleted: number }>(`/admin/database/tables/${table}/rows/delete`, { pk }),
};
