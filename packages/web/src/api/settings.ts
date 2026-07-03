import { api } from './client';

export type SettingSource = 'db' | 'env' | 'default';

export interface SettingField {
  key: string;
  group: string;
  label: string;
  type: 'string' | 'number' | 'enum';
  enumValues?: string[];
  secret: boolean;
  help?: string;
  source: SettingSource;
  /** Present for non-secret fields. */
  value?: string | number | null;
  /** Present for secret fields. */
  isSet?: boolean;
}

export interface SettingGroup {
  group: string;
  fields: SettingField[];
}

export interface SettingsResponse {
  groups: SettingGroup[];
}

export const settingsApi = {
  get: () => api.get<SettingsResponse>('/admin/settings'),
  update: (body: Record<string, unknown>) => api.patch<SettingsResponse>('/admin/settings', body),
  testEmail: () => api.post<{ ok: boolean; sentTo?: string; error?: string }>('/admin/settings/test-email'),
  testAi: () => api.post<{ ok: boolean; provider?: string; sample?: string; error?: string }>('/admin/settings/test-ai'),
};
