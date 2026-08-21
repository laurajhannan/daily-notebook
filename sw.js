/* sw.js — offline shell for Daily Notebook.
 *
 * App files: cache-first (fast, and works with no signal).
 * data/*.json: network first, falling back to cache, so guidance edits arrive
 * next time the phone is online without needing a new cache name.
 *
 * Bump CACHE_NAME whenever the shell changes — the old cache is then cleaned
 * up on activate.
 */

const CACHE_NAME = 'daily-notebook-v14';

// Paths are relative to this file, which sits at the app root. That keeps
// everything working when the app is served from a subfolder.
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/dom.js',
  './js/entry.js',
  './js/stats.js',
  './js/summary.js',
  './js/backup.js',
  './js/onboard.js',
  './js/guide.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Pre-cached too, so the guidance is there even if she goes offline before
  // ever opening those screens. The network-first handler below still refreshes
  // them whenever the phone is online.
  './data/safety.json',
  './data/guidance.json'
];

const DATA = [
  './data/safety.json',
  './data/guidance.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Added one at a time so a single failure can't abort the whole install.
    await Promise.all(SHELL.concat(DATA).map(async (path) => {
      try {
        // `cache: 'reload'` only bypasses the browser's own cache — the host's
        // CDN can still hand back a stale copy, which would bake the previous
        // release into a brand-new cache and quietly break updates. Adding the
        // cache name as a query string forces a genuinely fresh copy, then we
        // store it under the clean URL so lookups still match.
        const fresh = await fetch(`${path}${path.includes('?') ? '&' : '?'}v=${CACHE_NAME}`,
          { cache: 'reload' });
        if (!fresh.ok) throw new Error(`HTTP ${fresh.status}`);
        await cache.put(new Request(path), fresh);
      } catch (err) {
        console.error('Pre-cache failed for', path, err);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => (n === CACHE_NAME ? null : caches.delete(n))));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // nothing else is ever fetched

  const isData = url.pathname.includes('/data/') && url.pathname.endsWith('.json');

  if (isData) {
    // Fresh guidance when online, the stored copy otherwise.
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, res.clone());
        }
        return res;
      } catch (_) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
      }
      return res;
    } catch (_) {
      // A navigation with no cache entry still gets the app shell.
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html', { ignoreSearch: true });
        if (shell) return shell;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
