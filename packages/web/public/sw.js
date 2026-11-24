/**
 * PareCare service worker: receives web push messages and shows them as
 * real device notifications, even when the app is closed. Clicking a
 * notification opens the page the alert points at.
 */
self.addEventListener('push', (event) => {
  let payload = { title: 'PareCare', body: 'Something new happened.', url: '/app' };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    // A payload that is not JSON still shows a generic notification.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: payload.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/app';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) return client.navigate(url);
          return undefined;
        }
      }
      return clients.openWindow(url);
    })
  );
});


/**
 * Opening the emergency sheet with no signal. Nothing is kept unless the
 * person asks: Save on this phone, or opening a shared sheet, hands over the
 * page, what it needs to start and the sheet itself. With a connection the
 * page is always fresh and the kept copy is brought up to date; with none,
 * the kept copy answers and says when it was saved. Logging out, or a link
 * being turned off, forgets it.
 */
const OFFLINE_CACHE = 'parecare-offline-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('parecare-offline-') && k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const SHEET_PAGE = /^\/app\/[0-9a-f-]{36}\/emergency\/?$/i;
const SHARED_PAGE = /^\/shared\/[0-9a-f]{64}\/?$/i;
const keyFor = (url) => {
  const u = new URL(url, self.location.origin);
  return u.origin === self.location.origin ? u.pathname + u.search : null;
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const key = keyFor(request.url);
  if (!key) return;
  const page = request.mode === 'navigate' && (SHEET_PAGE.test(new URL(request.url).pathname) || SHARED_PAGE.test(new URL(request.url).pathname));
  event.respondWith(
    caches.open(OFFLINE_CACHE).then(async (cache) => {
      const kept = await cache.match(page ? '/__shell' : key);
      // Not kept: straight to the network, untouched.
      if (!kept) return fetch(request);
      try {
        const fresh = await fetch(request);
        // Bring the kept copy up to date while there is a connection.
        if (fresh.ok && !page && !(fresh.headers.get('Content-Type') || '').includes('application/json')) {
          await cache.put(key, fresh.clone());
        }
        return fresh;
      } catch {
        return kept;
      }
    })
  );
});

/**
 * Every file the app needs to start, found rather than listed, so it keeps
 * working whatever the build names its files: the scripts and styles the
 * start page names, the ones the page says it used, and every script those
 * scripts load in turn. Scripts loaded only on demand, such as admin pages,
 * are left out.
 */
const ASSET = /\.(?:m?js|jsx|tsx?|css|woff2?|ttf|otf|svg|png|webmanifest)$/i;
const SCRIPT = /\.(?:m?js|jsx|tsx?)$/i;
const sameOriginAsset = (u, base) => {
  try {
    const url = new URL(u, base);
    if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return null;
    return ASSET.test(url.pathname) ? url.pathname + url.search : null;
  } catch {
    return null;
  }
};
const refsInPage = (html, base) => {
  const out = [];
  const tag = /<(?:script|link)\b[^>]*>/gi;
  let m;
  while ((m = tag.exec(html))) {
    const attr = /\b(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(m[0]);
    const path = attr ? sameOriginAsset(attr[1], base) : null;
    if (path) out.push(path);
  }
  return out;
};
// Static imports only: `import x from "./a.js"`, `import "./a.js"`, `export * from "./a.js"`.
// A dynamic import("./a.js") has a bracket and is not matched.
const importsInScript = (code, base) => {
  const out = [];
  const re = /\b(?:from|import)\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(code))) {
    const path = sameOriginAsset(m[1], base);
    if (path) out.push(path);
  }
  return out;
};

async function keepAssets(cache, start) {
  const seen = new Set();
  const queue = [...start];
  while (queue.length && seen.size < 300) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      const r = await fetch(path, { credentials: 'same-origin' });
      if (!r.ok) continue;
      if (SCRIPT.test(new URL(path, self.location.origin).pathname)) {
        const code = await r.clone().text();
        for (const next of importsInScript(code, new URL(path, self.location.origin))) if (!seen.has(next)) queue.push(next);
      }
      await cache.put(path, r);
    } catch {
      /* best effort: what is already kept stays */
    }
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'keep-offline') {
    event.waitUntil(
      caches.open(OFFLINE_CACHE).then(async (cache) => {
        // The page itself: the app's start page, used for any kept page.
        const start = [];
        try {
          const shell = await fetch('/', { credentials: 'same-origin' });
          if (shell.ok) {
            const html = await shell.clone().text();
            start.push(...refsInPage(html, self.location.origin));
            await cache.put('/__shell', shell);
          }
        } catch {
          /* already kept, or no connection */
        }
        for (const u of Array.isArray(data.assets) ? data.assets : []) {
          const path = sameOriginAsset(u, self.location.origin);
          if (path) start.push(path);
        }
        await keepAssets(cache, start);
        // The data the page shows, as the page already has it, marked with when it was saved.
        for (const item of Array.isArray(data.json) ? data.json : []) {
          const key = keyFor(item.url);
          if (!key || item.body === undefined) continue;
          const body = item.body && typeof item.body === 'object' && !Array.isArray(item.body) ? { ...item.body, offline_saved_at: new Date().toISOString() } : item.body;
          await cache.put(key, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
        }
      })
    );
  }
  if (data.type === 'forget') {
    event.waitUntil(
      caches.open(OFFLINE_CACHE).then(async (cache) => {
        if (!Array.isArray(data.urls)) {
          await caches.delete(OFFLINE_CACHE);
          return;
        }
        for (const u of data.urls) {
          const key = keyFor(u);
          if (key) await cache.delete(key);
        }
      })
    );
  }
});
