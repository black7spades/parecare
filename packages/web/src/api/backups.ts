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

export interface Keyholder {
  id: string;
  display_name: string;
  email: string;
  /** Has it because of their role, so it cannot be taken away here. */
  by_role: boolean;
}

export interface Person {
  id: string;
  display_name: string;
  email: string;
}

export interface BackupsOverview {
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
  keyholders: Keyholder[];
  could_help: Person[];
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
  disconnectStorage: () => api.post<{ message: string }>('/admin/backups/storage/disconnect'),
  addKeyholder: (accountId: string) => api.post<{ message: string }>('/admin/backups/keyholders', { account_id: accountId }),
  removeKeyholder: (accountId: string) => api.delete<{ message: string }>(`/admin/backups/keyholders/${accountId}`),
  sendOffsite: (id: string) => api.post<{ message: string }>(`/admin/backups/${id}/send-offsite`),
};
