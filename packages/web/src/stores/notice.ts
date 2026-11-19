import { create } from 'zustand';
import type { QueryClient } from '@tanstack/react-query';

/**
 * A short note that something happened out of sight, such as someone being
 * added to Contacts while an appointment was saved, with a link to see it.
 * Shows for a few seconds; a newer note replaces an older one.
 */

const SHOW_MS = 9000;

export interface Notice {
  key: number;
  message: string;
  link?: { label: string; to: string };
}

interface NoticeState {
  notice: Notice | null;
  show: (n: Omit<Notice, 'key'>) => void;
  dismiss: () => void;
}

let nextKey = 1;
let timer: number | undefined;

export const useNoticeStore = create<NoticeState>((set) => ({
  notice: null,
  show: (n) => {
    const key = nextKey++;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => set((s) => (s.notice?.key === key ? { notice: null } : s)), SHOW_MS);
    set({ notice: { ...n, key } });
  },
  dismiss: () => {
    window.clearTimeout(timer);
    set({ notice: null });
  },
}));

/** Say who was just added to Contacts, linking to them when it is one person. */
export function noticeFiled(profileId: string, filed: Array<{ id: string; name: string }> | undefined) {
  if (!filed || filed.length === 0) return;
  const names = filed.map((f) => f.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  useNoticeStore.getState().show({
    message: `Added ${list} to Contacts, with everything you entered for ${names.length === 1 ? 'them' : 'each of them'}.`,
    link: filed.length === 1
      ? { label: `Open ${filed[0].name}`, to: `/app/${profileId}/providers?record=${filed[0].id}` }
      : { label: 'Open Contacts', to: `/app/${profileId}/providers` },
  });
}

/**
 * Saving an appointment can add someone to Contacts or fill in their address,
 * so every view of Contacts is refreshed rather than showing an old copy.
 */
export function refreshContacts(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    predicate: (q) => {
      const k = String(q.queryKey[0] ?? '');
      return k === 'providers' || k === 'provider-search' || k.startsWith('directory');
    },
  });
}
