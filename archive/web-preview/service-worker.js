// Increment this version when the app shell or precached assets change.
const CACHE_NAME = 'petak-web-shell-v4';
const PRECACHE_URLS = [
  './index.html',
  './manifest.webmanifest',
  './style.css',
  './app.js',
  './assets/logo-splash.png',
  './assets/pwa/favicon-16.png',
  './assets/pwa/favicon-32.png',
  './assets/pwa/favicon-48.png',
  './assets/pwa/icon-72.png',
  './assets/pwa/icon-96.png',
  './assets/pwa/icon-128.png',
  './assets/pwa/icon-144.png',
  './assets/pwa/icon-152.png',
  './assets/pwa/apple-touch-icon.png',
  './assets/pwa/icon-192.png',
  './assets/pwa/icon-256.png',
  './assets/pwa/icon-384.png',
  './assets/pwa/icon-512.png',
  './assets/pwa/maskable-192.png',
  './assets/pwa/maskable-512.png',
  './assets/avatars/seeker.webp',
  './assets/avatars/hider.webp',
  './assets/avatars/impostor.webp',
];

const cacheUrls = PRECACHE_URLS.map((path) => new URL(path, self.registration.scope).href);
const appShellUrl = new URL('index.html', self.registration.scope).href;
const appRootPath = new URL(self.registration.scope).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(cacheUrls);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('petak-web-shell-') && cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const requestUrl = new URL(request.url);
  const isAppNavigation =
    request.mode === 'navigate' &&
    (requestUrl.pathname === appRootPath || requestUrl.pathname === `${appRootPath}index.html`);

  if (isAppNavigation) {
    event.respondWith((async () => {
      let response;
      try {
        response = await fetch(request);
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        const cachedShell = await cache.match(appShellUrl);
        if (cachedShell) return cachedShell;
        console.error('Gagal memuat halaman PETAK dan cache offline belum tersedia', error);
        return Response.error();
      }

      if (response.ok) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(appShellUrl, response.clone());
        } catch (error) {
          console.error('Gagal memperbarui cache halaman PETAK', error);
        }
      }
      return response;
    })());
    return;
  }

  if (!cacheUrls.includes(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;

    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
