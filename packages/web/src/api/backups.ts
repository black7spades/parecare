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
  stored: boolean;
}

export type BackupState = 'protected' | 'here_only' | 'stale' | 'none' | 'off' | 'no_room';

export interface Keyholder {
  id: string;
  display_name: string;
  email: string;
}

export interface BackupsOverview {
  status: { state: BackupState; message: string };
  settings: { enabled: boolean; frequency: 'hourly' | 'daily' | 'weekly' | 'monthly'; keep_days: number };
  space: { room_for_more: number; used_by_copies: number };
  keyholders: Keyholder[];
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
};
