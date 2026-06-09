const CACHE_VERSION = 'alphaterminal-v15';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './404.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/data.js',
  './js/charts.js',
  './js/notifications.js',
  './pages/dashboard.html',
  './pages/analyse.html',
  './pages/signaux.html',
  './pages/inventaire.html',
  './pages/parametres.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
  './examples/alphaterminal-sample-import.json',
  './examples/alphaterminal-official-import-2026-06-08.json'
];

const OPTIONAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400,0,0'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(STATIC_ASSETS);
    await Promise.allSettled(OPTIONAL_ASSETS.map(asset => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => !key.startsWith(CACHE_VERSION)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isMarketData(url)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE, './index.html'));
    return;
  }

  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

function isMarketData(url) {
  return url.hostname.includes('twelvedata.com')
    || url.hostname.includes('marketaux.com')
    || url.hostname.includes('finnhub.io')
    || url.hostname.includes('gdeltproject.org')
    || url.hostname.includes('query1.finance.yahoo.com')
    || url.hostname.includes('api.allorigins.win')
    || url.hostname.includes('proxy.sicho95.workers.dev')
    || url.hostname.includes('ok.surf');
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return cached || Response.error();
  }
}

async function networkFirst(request, cacheName, fallbackUrl = null) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      return response;
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) return caches.match(fallbackUrl);
    return Response.error();
  }
}
