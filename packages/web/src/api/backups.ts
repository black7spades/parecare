import { api } from './client';

export interface Backup {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'failed';
  kind: 'scheduled' | 'manual';
  filename: string | null;
  size_bytes: number | null;
  source_rows: number | null;
  verified_rows: number | null;
  verified_at: string | null;
  error: string | null;
  downloaded_at: string | null;
  offsite_at: string | null;
  offsite_kind: string | null;
  offsite_error: string | null;
  stored: boolean;
}

export type BackupState = 'protected' | 'here_only' | 'stale' | 'none' | 'off' | 'no_room';

export type Destination = 'none' | 'google' | 'dropbox' | 's3';

export interface DestinationState {
  id: Destination;
  /** Whether the details needed to use it have been filled in. */
  available: boolean;
  /** Whether it is ready to receive copies right now. */
  ready: boolean;
  account: string | null;
}

export interface StorageDetails {
  bucket: string;
  region?: string;
  access_key: string;
  secret_key: string;
  endpoint?: string;
}

export interface BackupLevel {
  level: number;
  title: string;
  meaning: string;
  reached: boolean;
  next?: string;
}

export interface LevelReport {
  current: number;
  total: number;
  levels: BackupLevel[];
  headline: string;
}

export interface Drill {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'passed' | 'failed';
  stage: string | null;
  rows_before: number | null;
  rows_after_destroy: number | null;
  rows_restored: number | null;
  files_before: number | null;
  files_restored: number | null;
  error: string | null;
}

/** One stage of a practice run, with how long it took and what it found. */
export interface DrillStep {
  id: string;
  position: number;
  started_at: string;
  finished_at: string | null;
  seconds: string | number | null;
  title: string;
  detail: string | null;
  outcome: 'done' | 'failed';
}

/** One kind of record, counted and fingerprinted at all three points. */
export interface DrillTable {
  id: string;
  table_name: string;
  kind: string;
  rows_before: number;
  rows_after_destroy: number;
  rows_restored: number;
  fingerprint_before: string | null;
  fingerprint_after: string | null;
}

/** One real, named record followed all the way through. */
export interface DrillRecord {
  id: string;
  table_name: string;
  kind: string;
  label: string;
  owner_label: string | null;
  fingerprint_before: string | null;
  present_after_destroy: boolean;
  fingerprint_after: string | null;
}

export interface DrillEvidence {
  drill: Drill;
  steps: DrillStep[];
  tables: DrillTable[];
  records: DrillRecord[];
}

export interface BackupsOverview {
  levels: LevelReport;
  last_drill: DrillEvidence | null;
  status: { state: BackupState; message: string };
  settings: { enabled: boolean; frequency: 'hourly' | 'daily' | 'weekly' | 'monthly'; keep_days: number };
  space: { room_for_more: number; used_by_copies: number };
  cloud: {
    active: Destination;
    ready: boolean;
    destinations: DestinationState[];
    google_redirect_uri: string;
    dropbox_redirect_uri: string;
  };
  last_backup_at: string | null;
  backups: Backup[];
}

export const backupsApi = {
  overview: () => api.get<BackupsOverview>('/admin/backups'),
  runNow: () => api.post<{ backup: Backup }>('/admin/backups/run'),
  check: (id: string) => api.post<{ ok: boolean; message: string; backup: Backup }>(`/admin/backups/${id}/check`),
  restore: (id: string, confirm: string) => api.post<{ message: string }>(`/admin/backups/${id}/restore`, { confirm }),
  downloadUrl: (id: string) => `/admin/backups/${id}/download`,
  save: (settings: Record<string, string>) => api.patch<unknown>('/admin/settings', settings),
  connect: (provider: 'google' | 'dropbox') => api.post<{ url: string }>(`/admin/backups/${provider}/connect`),
  disconnect: (provider: 'google' | 'dropbox') => api.post<{ message: string }>(`/admin/backups/${provider}/disconnect`),
  saveStorage: (details: StorageDetails) => api.post<{ message: string }>('/admin/backups/storage', details),
  saveApp: (provider: 'google' | 'dropbox', values: Record<string, string>) =>
    api.post<{ message: string }>(`/admin/backups/${provider}/app`, values),
  disconnectStorage: () => api.post<{ message: string }>('/admin/backups/storage/disconnect'),
  sendOffsite: (id: string) => api.post<{ message: string }>(`/admin/backups/${id}/send-offsite`),
  runDrill: () => api.post<DrillEvidence & { message: string }>('/admin/backups/drill'),
  drill: (id: string) => api.get<DrillEvidence>(`/admin/backups/drills/${id}`),
};
