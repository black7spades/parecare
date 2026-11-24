/**
 * Keeping an emergency sheet on this phone, so it opens with no signal.
 * Nothing is kept unless asked. The page hands the offline helper what it
 * needs to start and the data it shows; logging out forgets all of it.
 */

const SHEET_KEY_PREFIX = 'parecare.emergency-sheet.';

/**
 * The scripts and styles this page started with, so it can start again
 * offline: every file the browser fetched for it, whatever started the fetch,
 * plus every script and style named in the page. The offline helper follows
 * each script's own imports from there, so new file names never need listing.
 */
function pageAssets(): string[] {
  const urls = new Set<string>();
  try {
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) urls.add(e.name);
  } catch {
    /* no timing list in this browser */
  }
  try {
    document.querySelectorAll<HTMLScriptElement>('script[src]').forEach((s) => urls.add(s.src));
    document.querySelectorAll<HTMLLinkElement>('link[href]').forEach((l) => urls.add(l.href));
  } catch {
    /* nothing named */
  }
  // This file's own script, which holds the page.
  urls.add(import.meta.url);
  return [...urls].filter((u) => {
    try {
      const url = new URL(u, window.location.origin);
      return url.origin === window.location.origin && !url.pathname.startsWith('/api/');
    } catch {
      return false;
    }
  });
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
export function keepOffline(json: Array<{ url: string; body: unknown }>, pageFiles: string[] = []): void {
  post({ type: 'keep-offline', assets: [...pageAssets(), ...pageFiles], json: json.map((j) => ({ url: `/api/v1${j.url}`, body: j.body })) });
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
