// Offline support for a single-page site (index.html + a few static files). No third-party requests are made or handled.
// The page opens from the cache straight away and is refreshed in the background, so a new build shows on the next open.
// Bump VERSION only when this file's caching logic changes, not for content updates.
const VERSION = 'v1';
// Cache names start with bv- because hope0369.github.io is shared with other projects.
const PAGE = 'bv-page-' + VERSION;
const PRECACHE = ['./', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'cover.jpg', 'version.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(PAGE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => /^bv-page-v\d+$/.test(k) && k !== PAGE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Only complete, same-origin, successful responses are cached. Opaque, partial and error responses never are.
function cacheable(res){ return res && res.ok && res.status === 200 && res.type === 'basic'; }

// Store a copy; a failure (e.g. quota) is swallowed so it can never affect the response served to the page.
function store(cache, key, res){
  try { return cache.put(key, res.clone()).catch(() => {}); } catch (_) { return Promise.resolve(); }
}

// Serve from the cache, then update the cache from the network inside waitUntil.
function staleWhileRevalidate(e, request, cacheKey){
  return caches.open(PAGE).then(cache => cache.match(cacheKey).then(cached => {
    const fresh = fetch(request).then(res => {
      if (!cacheable(res)) return res;
      const saving = store(cache, cacheKey, res);
      e.waitUntil(saving);
      return res;
    });
    if (cached){ e.waitUntil(fresh.catch(() => {})); return cached; }
    return fresh;
  }));
}

// Network first, falling back to the cached copy; a fresh response replaces the cached one.
function networkFirst(e, request, cacheKey){
  return fetch(request).then(res => {
    if (cacheable(res)){ const copy = res.clone();   // cloned now, before the page reads the body
      e.waitUntil(caches.open(PAGE).then(c => c.put(cacheKey, copy)).catch(() => {})); }
    return res;
  }).catch(() => caches.open(PAGE).then(c => c.match(cacheKey)).then(hit => hit || Response.error()));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never touch third-party requests

  const home = new URL('./', location).pathname;
  const key = url.pathname === home ? './' : req;

  // A request that asks for a fresh copy (the update check, or the reload after one), and version.json itself,
  // go to the network first; a fresh page replaces the offline copy so the next open is the new build.
  if (req.cache === 'no-store' || req.cache === 'reload' || url.pathname.endsWith('/version.json')){
    e.respondWith(networkFirst(e, req, key));
    return;
  }
  // The site is one page; every navigation gets index.html.
  if (req.mode === 'navigate'){
    e.respondWith(staleWhileRevalidate(e, req, './'));
    return;
  }
  e.respondWith(staleWhileRevalidate(e, req, req));
});
