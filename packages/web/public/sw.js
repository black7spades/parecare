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
