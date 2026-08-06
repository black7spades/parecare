import { create } from 'zustand';
import { APP_VERSION } from '../lib/version';
import { RELEASES } from '../lib/releaseNotes';

/**
 * Whether this build's What's new has been read, so the sidebar can show a
 * quiet mark by the version number when something has changed rather than a
 * permanent link, and whether the person wants that mark at all.
 *
 * The mark appears whenever the read version differs from the running one, and
 * clears once the What's new screen is opened.
 */
const SEEN_KEY = 'parecare-updates-seen';
const NOTIFY_KEY = 'parecare-updates-notify';

/**
 * The newest version we have notes for that is not the one running. On a
 * browser that has never recorded anything, this is what we seed as "already
 * read", so a real upgrade always surfaces exactly one mark for the new
 * version instead of the mark being swallowed. (Seeding the running version, as
 * this once did, meant anyone whose first visit landed on the newest build was
 * silently marked caught up and never told an update had arrived.)
 */
const seedSeen = RELEASES.find((r) => r.version !== APP_VERSION)?.version ?? APP_VERSION;

function readSeen(): string {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    if (v !== null) return v;
    localStorage.setItem(SEEN_KEY, seedSeen);
  } catch {
    /* private mode: treat as the seed, so the mark can still show once */
  }
  return seedSeen;
}

/** On unless explicitly switched off, so a person is told about changes by default. */
function readNotify(): boolean {
  try {
    return localStorage.getItem(NOTIFY_KEY) !== '0';
  } catch {
    return true;
  }
}

interface UpdatesState {
  seen: string;
  notify: boolean;
  markSeen: () => void;
  setNotify: (on: boolean) => void;
}

export const useUpdates = create<UpdatesState>((set) => ({
  seen: readSeen(),
  notify: readNotify(),
  markSeen: () => {
    try {
      localStorage.setItem(SEEN_KEY, APP_VERSION);
    } catch {
      /* ignore */
    }
    set({ seen: APP_VERSION });
  },
  setNotify: (on) => {
    try {
      localStorage.setItem(NOTIFY_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ notify: on });
  },
}));

export const hasUnseenUpdate = (seen: string): boolean => seen !== APP_VERSION;
