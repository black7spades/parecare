import { api, ApiError } from '../api/client';

/**
 * The offline queue for captured notes. A note saved with no connection is kept
 * on the device and sent when the connection returns, so capture is trustworthy
 * in a hospital basement or a lift. The device makes a key for each note, and
 * the server ignores a repeat of that key, so a note sent more than once (a
 * flaky reconnect, the app reopened mid-send) still lands exactly once.
 */
const KEY = 'parecare-capture-queue';

export interface QueuedNote {
  client_key: string;
  profile_id: string;
  entry_type: string;
  body: string;
  occurred_at: string;
  queued_at: number;
}

type NewNote = Omit<QueuedNote, 'queued_at'>;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
export function onQueueChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function read(): QueuedNote[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedNote[];
  } catch {
    return [];
  }
}
function write(q: QueuedNote[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage full or private mode: the note stays in memory only */
  }
  notify();
}
export function queuedCount(): number {
  return read().length;
}

function enqueue(note: NewNote): void {
  const q = read();
  if (q.some((n) => n.client_key === note.client_key)) return;
  q.push({ ...note, queued_at: Date.now() });
  write(q);
}

async function send(note: NewNote): Promise<void> {
  await api.post(`/care-profiles/${note.profile_id}/log`, {
    entry_type: note.entry_type,
    body: note.body,
    occurred_at: note.occurred_at,
    client_key: note.client_key,
  });
}

/** A failure that means the server could not be reached, not that it refused. */
const unreachable = (err: unknown): boolean =>
  !navigator.onLine || (err instanceof ApiError && [0, 502, 503, 504].includes(err.status));

/** Save a note now, or keep it on this device when there is no connection. */
export async function submitNote(note: NewNote): Promise<'sent' | 'queued'> {
  if (!navigator.onLine) {
    enqueue(note);
    return 'queued';
  }
  try {
    await send(note);
    return 'sent';
  } catch (err) {
    if (unreachable(err)) {
      enqueue(note);
      return 'queued';
    }
    throw err;
  }
}

/** Try to send everything waiting; keep only what still cannot be reached. */
export async function flushQueue(): Promise<void> {
  const q = read();
  if (q.length === 0) return;
  const remaining: QueuedNote[] = [];
  for (const note of q) {
    try {
      // The server ignores a repeat by client_key, so re-sending is safe.
      await send(note);
    } catch (err) {
      if (unreachable(err)) remaining.push(note);
      // A note the server refuses outright (a deleted profile, say) is dropped
      // rather than retried forever.
    }
  }
  write(remaining);
}

export function initCaptureQueue(): void {
  window.addEventListener('online', () => {
    void flushQueue();
  });
  if (navigator.onLine) void flushQueue();
}
