import { create } from 'zustand';
import { siteCopyApi } from '../api/siteCopy';
import { SITE_COPY_DEFAULTS } from '../lib/siteCopyDefaults';

interface SiteCopyState {
  copy: Record<string, string>;
  loaded: boolean;
  load: () => Promise<void>;
  setCopy: (copy: Record<string, string>) => void;
}

export const useSiteCopyStore = create<SiteCopyState>((set, get) => ({
  copy: {},
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const resp = await siteCopyApi.get();
      set({ copy: resp.copy, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  setCopy: (copy) => set({ copy }),
}));

export function resolveCopy(key: string, vars?: Record<string, string>): string {
  const store = useSiteCopyStore.getState();
  let text = store.copy[key] ?? SITE_COPY_DEFAULTS[key] ?? '';
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return text;
}
