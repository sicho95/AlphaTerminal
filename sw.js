const CACHE_VERSION = 'alphaterminal-v23';
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
  './js/market-alerts.js',
  './js/push-sync.js',
  './js/sync-client.js',
  './js/monitor-rules.js',
  './shared/monitor-rules.json',
  './js/backup.js',
  './js/backup-ui.js',
  './js/sync-ui.js',
  './pages/dashboard.html',
  './pages/analyse.html',
  './pages/signaux.html',
  './pages/inventaire.html',
  './pages/parametres.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
  './examples/alphaterminal-sample-import.json'
];

const OPTIONAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400,0,0'
];

/** Persistent event inbox for future SichoRuntime Web Push delivery.
 * Stored independently of localStorage (not accessible inside a service worker).
 */
function openPushDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AlphaTerminalPushV1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePendingPush(alert) {
  const db = await openPushDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('pending', 'readwrite');
      transaction.objectStore('pending').put(alert);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data?.json() || {}; } catch { payload = { message: event.data?.text() || '' }; }
    const alert = {
      id: String(payload.id || `push-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      title: String(payload.title || 'AlphaTerminal'),
      message: String(payload.message || payload.body || 'Nouvelle alerte'),
      severity: String(payload.severity || 'info'),
      type: String(payload.type || 'remote'),
      timestamp: payload.timestamp || new Date().toISOString(),
      read: false,
      url: typeof payload.url === 'string' && /^https:\/\//.test(payload.url) ? payload.url : ''
    };
    try { await savePendingPush(alert); } catch (error) { console.warn('Push storage unavailable', error); }
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) client.postMessage({ type: 'alphaterminal:push', id: alert.id });
    await self.registration.showNotification(alert.title, {
      body: alert.message,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: alert.id,
      data: { alertId: alert.id }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const alertId = String(event.notification.data?.alertId || '');
  const target = new URL('./index.html', self.registration.scope);
  if (alertId) target.searchParams.set('alert', alertId);
  target.hash = '#/dashboard';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).pathname.startsWith(new URL(self.registration.scope).pathname)) {
        try { await client.navigate(target.href); await client.focus(); return; } catch { /* fallback */ }
      }
    }
    await self.clients.openWindow(target.href);
  })());
});

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
  return url.hostname.includes('marketaux.com')
    || url.hostname.includes('finnhub.io')
    || url.hostname.includes('query1.finance.yahoo.com')
    || url.hostname.includes('api.allorigins.win')
    || url.hostname.includes('proxy.sicho95.workers.dev')
    || url.hostname.includes('proxy.sicho.workers.dev')
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
