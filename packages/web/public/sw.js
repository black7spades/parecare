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

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'keep-offline') {
    event.waitUntil(
      caches.open(OFFLINE_CACHE).then(async (cache) => {
        // The page itself: the app's start page, used for any kept page.
        try {
          const shell = await fetch('/', { credentials: 'same-origin' });
          if (shell.ok) await cache.put('/__shell', shell);
        } catch {
          /* already kept, or no connection */
        }
        for (const u of Array.isArray(data.assets) ? data.assets : []) {
          const key = keyFor(u);
          if (!key) continue;
          try {
            const r = await fetch(key, { credentials: 'same-origin' });
            if (r.ok) await cache.put(key, r);
          } catch {
            /* best effort */
          }
        }
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
