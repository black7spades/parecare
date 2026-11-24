/**
 * Keeping an emergency sheet on this phone, so it opens with no signal.
 * Nothing is kept unless asked. The page hands the offline helper what it
 * needs to start and the data it shows; logging out forgets all of it.
 */

const SHEET_KEY_PREFIX = 'parecare.emergency-sheet.';

/** The scripts and styles this page started with, so it can start again offline. */
function pageAssets(): string[] {
  try {
    return (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((e) => ['script', 'link', 'css'].includes(e.initiatorType))
      .map((e) => e.name)
      .filter((u) => {
        const url = new URL(u, window.location.origin);
        return url.origin === window.location.origin && !url.pathname.startsWith('/api/');
      });
  } catch {
    return [];
  }
}

function post(message: unknown): boolean {
  try {
    const sw = navigator.serviceWorker;
    if (!sw) return false;
    if (sw.controller) {
      sw.controller.postMessage(message);
      return true;
    }
    // A first visit: the helper is still starting, so hand it over once it is ready.
    void sw.ready.then((reg) => reg.active?.postMessage(message)).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Keep this page and its data for opening with no signal. */
export function keepOffline(json: Array<{ url: string; body: unknown }>): void {
  post({ type: 'keep-offline', assets: pageAssets(), json: json.map((j) => ({ url: `/api/v1${j.url}`, body: j.body })) });
}

/** Forget kept data: some links, or everything. */
export function forgetOffline(urls?: string[]): void {
  post({ type: 'forget', urls: urls?.map((u) => `/api/v1${u}`) });
}

/** On logout: nothing about anyone stays on a shared device. */
export function forgetEverythingOffline(): void {
  forgetOffline();
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(SHEET_KEY_PREFIX)) window.localStorage.removeItem(k);
    }
  } catch {
    /* nothing kept, or storage is blocked */
  }
}

export const sheetStoreKey = (profileId: string) => `${SHEET_KEY_PREFIX}${profileId}`;
