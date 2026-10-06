const CACHE = 'expenseflow-shell-v7';
const STATIC_SHELL = [
  '/styles.css?v=7',
  '/app.js?v=7',
  '/api.js?v=7',
  '/router.js?v=7',
  '/charts.js?v=7',
  '/auth.css?v=7',
  '/auth.js?v=7',
  '/manifest.json?v=7',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(STATIC_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'CLEAR_PRIVATE_CACHE') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.delete('/index.html');
    await cache.delete('/');
  })());
});

async function cacheStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function navigate(event) {
  try {
    const response = await event.preloadResponse || await fetch(event.request);
    const finalPath = new URL(response.url || event.request.url).pathname;
    if (response.ok && finalPath !== '/login' && finalPath !== '/login.html') {
      const cache = await caches.open(CACHE);
      await cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(CACHE);
    return await cache.match('/index.html') || Response.error();
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(navigate(event));
    return;
  }
  event.respondWith(cacheStatic(event.request));
});
