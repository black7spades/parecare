import { create } from 'zustand';
import { APP_VERSION } from '../lib/version';

/**
 * Whether this build's What's new has been seen, so the sidebar can show a
 * quiet notification when there is something new to read rather than a
 * permanent link. A fresh install starts caught up, so nobody is nagged about
 * updates that predate them; after an upgrade the stored version differs from
 * the running one until the Updates page is opened.
 */
const KEY = 'parecare-updates-seen';

function readOrInit(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v !== null) return v;
    localStorage.setItem(KEY, APP_VERSION);
  } catch {
    /* private mode: fall through, treated as caught up */
  }
  return APP_VERSION;
}

interface UpdatesState {
  seen: string;
  markSeen: () => void;
}

export const useUpdates = create<UpdatesState>((set) => ({
  seen: readOrInit(),
  markSeen: () => {
    try {
      localStorage.setItem(KEY, APP_VERSION);
    } catch {
      /* ignore */
    }
    set({ seen: APP_VERSION });
  },
}));

export const hasUnseenUpdate = (seen: string): boolean => seen !== APP_VERSION;
