/**
 * Making PareCare installable, so it can live on a home screen and open like an
 * app. Two small pieces: registering the service worker (which also powers push
 * notifications), and holding on to the browser's install prompt so a quiet
 * "add to your home screen" can be offered at a sensible moment rather than the
 * browser's own, which most people miss.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Whether the app already runs as an installed, standalone window. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari uses a non-standard flag.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function initPwa(): void {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* registration is best-effort; the app works without it */
      });
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the event so the prompt can be offered later, in our own words.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/** Whether the browser has offered an install we are holding for later. */
export function canInstall(): boolean {
  return deferred !== null;
}

/** Subscribe to changes in install availability; returns an unsubscribe. */
export function onInstallChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Show the held install prompt. Returns whether the person accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const choice = await deferred.userChoice;
  deferred = null;
  notify();
  return choice.outcome === 'accepted';
}
