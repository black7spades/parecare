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
  helpLink?: { label: string; url: string };
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

export interface InstalledModel {
  name: string;
  size: number | null;
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
}

export interface AiModelPull {
  model: string | null;
  status: string;
  completed: number;
  total: number;
  done: boolean;
  error: string | null;
  finishedAt: number | null;
}

export interface AiModelInfo {
  provider: string;
  local: boolean;
  active: string;
  activeDetails: InstalledModel | null;
  mediationModel: string;
  state: 'preparing' | 'ready' | 'unavailable';
  installed: InstalledModel[];
  pull: AiModelPull;
}

export const settingsApi = {
  get: () => api.get<SettingsResponse>('/admin/settings'),
  update: (body: Record<string, unknown>) => api.patch<SettingsResponse>('/admin/settings', body),
  testEmail: () => api.post<{ ok: boolean; sentTo?: string; error?: string }>('/admin/settings/test-email'),
  testAi: () => api.post<{ ok: boolean; provider?: string; sample?: string; error?: string }>('/admin/settings/test-ai'),
  aiModel: () => api.get<AiModelInfo>('/admin/settings/ai/model'),
  pullModel: (model: string) => api.post<{ pull: AiModelPull }>('/admin/settings/ai/model/pull', { model }),
};
