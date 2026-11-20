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
 * Opening the emergency sheet with no signal. Network first, so it is always
 * the latest when there is a connection; the last good copy when there is
 * not. Only the emergency sheet, a shared link, and what the app needs to
 * start are kept, never anything else.
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
const KEPT_API = [
  /^\/api\/v1\/care-profiles\/[0-9a-f-]{36}\/emergency-sheet$/i,
  /^\/api\/v1\/care-profiles\/[0-9a-f-]{36}$/i,
  /^\/api\/v1\/shared\/[0-9a-f]{64}$/i,
  /^\/api\/v1\/auth\/me$/i,
];

function keptRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (request.mode === 'navigate') return SHEET_PAGE.test(url.pathname) || SHARED_PAGE.test(url.pathname);
  if (KEPT_API.some((re) => re.test(url.pathname))) return true;
  // The scripts and styles the app starts with.
  return ['script', 'style', 'font'].includes(request.destination) && !url.pathname.startsWith('/@');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!keptRequest(request)) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(OFFLINE_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit || (request.mode === 'navigate' ? caches.match('/index.html') : undefined)).then(
          (hit) => hit || Response.error()
        )
      )
  );
});

// "Save on this phone" asks for the page itself to be kept now.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'keep-offline' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((cache) =>
      Promise.all(
        data.urls
          .filter((u) => typeof u === 'string' && (SHEET_PAGE.test(u) || SHARED_PAGE.test(u)))
          .map((u) => fetch(u, { credentials: 'same-origin' }).then((r) => (r.ok ? cache.put(u, r) : undefined)).catch(() => undefined))
      )
    )
  );
});
