import { api } from './client';

export interface SiteCopyResponse {
  copy: Record<string, string>;
}

export const siteCopyApi = {
  get: () => api.get<SiteCopyResponse>('/admin/site-copy'),
  update: (body: Record<string, string>) => api.patch<SiteCopyResponse>('/admin/site-copy', body),
};
