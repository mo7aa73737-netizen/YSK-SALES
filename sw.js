// Robust Service Worker for PWA + Offline-first
// - Handles base path automatically (works on GitHub Pages or subfolders)
// - Precaches app shell and public images
// - Runtime-caches same-origin assets (JS/CSS/images)
// - Caches external resources (Google Fonts, CDN) to enable offline after first load

const APP_CACHE = 'ysk-app-shell-v3';
const RUNTIME_CACHE = 'ysk-runtime-v3';
const EXT_STYLES = 'ysk-ext-styles-v1';
const EXT_FONTS = 'ysk-ext-fonts-v1';
const EXT_LIBS = 'ysk-ext-libs-v1';

// Build absolute URL from SW scope + relative path
const toURL = (path) => new URL(path, self.registration.scope).toString();

const PRECACHE_URLS = [
  '',               // scope root
  'index.html',
  'manifest.json',
  // Public images and icons
  'YSK-SALES.png',
  'mobile.png',
  'whatsapp.png',
  'web-domain.png',
  'gmail.png',
  // Other public pages if any
  'scanner.html'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      // Add items individually to avoid failing whole install if one URL is missing
      await Promise.allSettled(PRECACHE_URLS.map((p) => cache.add(toURL(p))));
    })()
  );
});

self.addEventListener('activate', (event) => {
  const whitelist = [APP_CACHE, RUNTIME_CACHE, EXT_STYLES, EXT_FONTS, EXT_LIBS];
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((n) => (whitelist.includes(n) ? Promise.resolve() : caches.delete(n)))
      );
      await self.clients.claim();
    })()
  );
});

function isSameOrigin(request) {
  try {
    const url = new URL(request.url);
    return url.origin === self.location.origin;
  } catch (_) {
    return false;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // SPA navigation requests: network-first with offline fallback to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, networkResponse.clone());
          return networkResponse;
        } catch (err) {
          const cache = await caches.open(APP_CACHE);
          const cached = await cache.match(toURL('index.html'));
          return (
            cached ||
            new Response('You are offline and no cached content is available.', {
              status: 503,
              statusText: 'Offline'
            })
          );
        }
      })()
    );
    return;
  }

  // Same-origin assets: cache-first, then network and cache
  if (isSameOrigin(request)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, response.clone());
          return response;
        } catch (err) {
          // Fallback for images: show app icon if available
          if (request.destination === 'image') {
            const appCache = await caches.open(APP_CACHE);
            const fallback = await appCache.match(toURL('YSK-SALES.png'));
            if (fallback) return fallback;
          }
          throw err;
        }
      })()
    );
    return;
  }

  // External resources: apply appropriate caching strategies
  if (url.hostname.includes('fonts.googleapis.com')) {
    event.respondWith(staleWhileRevalidate(request, EXT_STYLES));
    return;
  }
  if (url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(request, EXT_FONTS));
    return;
  }
  if (
    url.hostname.includes('cdn.tailwindcss.com') ||
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('esm.sh')
  ) {
    event.respondWith(cacheFirst(request, EXT_LIBS));
    return;
  }
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || networkPromise || new Response('', { status: 504 });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}
