const CACHE_PREFIX = 'petak-pwa-';
// Increment this version when the app shell or PWA assets change.
const CACHE_NAME = `${CACHE_PREFIX}v6`;
const APP_ROOT_URL = new URL('./', self.registration.scope).href;
const PRECACHE_URLS = [
  APP_ROOT_URL,
  new URL('manifest.webmanifest', self.registration.scope).href,
  new URL('favicon.png', self.registration.scope).href,
  new URL('logo-splash.png', self.registration.scope).href,
  new URL('icons/favicon-16.png', self.registration.scope).href,
  new URL('icons/favicon-32.png', self.registration.scope).href,
  new URL('icons/favicon-48.png', self.registration.scope).href,
  new URL('icons/apple-touch-icon.png', self.registration.scope).href,
  new URL('icons/icon-192.png', self.registration.scope).href,
  new URL('icons/icon-512.png', self.registration.scope).href,
  new URL('icons/maskable-192.png', self.registration.scope).href,
  new URL('icons/maskable-512.png', self.registration.scope).href,
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS);

    const cachedShell = await cache.match(APP_ROOT_URL);
    if (cachedShell) {
      const html = await cachedShell.text();
      const bundleUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((match) => new URL(match[1], APP_ROOT_URL))
        .filter((url) => url.origin === self.location.origin && url.pathname.startsWith('/_expo/static/'))
        .map((url) => url.href);
      if (bundleUrls.length) await cache.addAll(bundleUrls);
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    if (event.data) {
      try {
        const parsed = event.data.json();
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed;
        } else {
          console.error('Payload push PETAK harus berupa objek JSON.');
        }
      } catch (error) {
        console.error('Payload push PETAK tidak valid.', error);
      }
    }

    const title = typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim().slice(0, 80)
      : 'PETAK UMPET +62';
    const body = typeof payload.body === 'string' ? payload.body.trim().slice(0, 180) : '';
    let targetUrl = APP_ROOT_URL;
    if (typeof payload.url === 'string') {
      try {
        const candidate = new URL(payload.url, self.location.origin);
        if (candidate.origin === self.location.origin) targetUrl = candidate.href;
      } catch (error) {
        console.error('Tautan notifikasi push PETAK tidak valid.', error);
      }
    }

    await self.registration.showNotification(title, {
      body,
      icon: new URL('icons/icon-192.png', self.registration.scope).href,
      badge: new URL('icons/maskable-192.png', self.registration.scope).href,
      tag: typeof payload.tag === 'string' ? payload.tag.slice(0, 120) : 'petak-notification',
      data: { url: targetUrl },
      renotify: false,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const requestedUrl = event.notification.data?.url;
    let targetUrl = APP_ROOT_URL;
    if (typeof requestedUrl === 'string') {
      try {
        const candidate = new URL(requestedUrl);
        if (candidate.origin === self.location.origin) targetUrl = candidate.href;
      } catch (error) {
        console.error('Tautan klik notifikasi PETAK tidak valid.', error);
      }
    }

    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    for (const client of windowClients) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if (client.url !== targetUrl && 'navigate' in client) await client.navigate(targetUrl);
      return client.focus();
    }
    return self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const requestUrl = new URL(request.url);
  if (requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.startsWith('/socket.io/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && requestUrl.pathname === new URL(APP_ROOT_URL).pathname) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(APP_ROOT_URL, response.clone());
        }
        return response;
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        const cachedShell = await cache.match(APP_ROOT_URL);
        if (cachedShell) return cachedShell;
        console.error('Halaman PETAK belum tersedia offline dan gagal dimuat dari jaringan', error);
        return Response.error();
      }
    })());
    return;
  }

  const isExpoStaticAsset = requestUrl.pathname.startsWith('/_expo/static/') ||
    requestUrl.pathname.startsWith('/assets/');
  const isPwaAsset = requestUrl.pathname.startsWith('/icons/') ||
    requestUrl.pathname === '/manifest.webmanifest' ||
    requestUrl.pathname === '/favicon.png';
  if (!isExpoStaticAsset && !isPwaAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;

    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      console.error(`Gagal memuat aset PETAK: ${requestUrl.pathname}`, error);
      return Response.error();
    }
  })());
});
