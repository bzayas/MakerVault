/* MakerVault service worker — offline support for the installed PWA.
 *
 * Strategy:
 *   - App shell (HTML/CSS/JS/vendor/icons): precached, cache-first.
 *     The cache name carries the release version; deploys bump MV_SW_VERSION
 *     (kept in lockstep with the ?v= busters in index.html), the new worker
 *     precaches fresh files and deletes every old cache on activate.
 *   - API GETs: network-first with the response copied into a data cache —
 *     offline, every view renders the last data it saw.
 *   - Photos: cache-first (their URLs are versioned by item updated_at).
 *   - Mutations (POST/PUT/DELETE): never intercepted — the app's outbox in
 *     api.js queues them when offline and replays on reconnect.
 */

const MV_SW_VERSION = 'v23';
const SHELL_CACHE = `mv-shell-${MV_SW_VERSION}`;
const DATA_CACHE = `mv-data-${MV_SW_VERSION}`;

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.json',
  `css/app.css?v=${MV_SW_VERSION.slice(1)}`,
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'assets/cyberbrick_kits.json',
  ...[
    'vendor/qrcode.js', 'api.js', 'ui.js', 'labelgen.js', 'parsers.js',
    'dashboard.js', 'reports.js', 'inventory.js', 'locations.js',
    'labexport.js', 'labels.js', 'scanner.js', 'printers.js', 'imports.js',
    'bom.js', 'duplicates.js', 'activity.js', 'categories.js', 'settings.js',
    'app.js',
  ].map((f) => `js/${f}?v=${MV_SW_VERSION.slice(1)}`),
];

// Heavy vendor files load lazily — runtime-cached on first use instead of
// precached, so installs stay fast on the phone.
const RUNTIME_SHELL = /\/js\/vendor\/(pdf|pdf\.worker|zxing|xlsx)\.min\.js/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // mutations go straight to the network

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Photos: cache-first (URLs are versioned, so hits are always fresh)
  if (url.pathname.endsWith('/api/photo.php')) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // API GETs: network-first, cached copy as the offline fallback
  if (url.pathname.includes('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req);
          if (hit) return hit;
          return new Response(
            JSON.stringify({ detail: 'Offline and no cached copy of this data yet' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // Shell: cache-first; lazily cache the heavy vendor bundles on first use
  event.respondWith(
    caches.match(req, { ignoreSearch: url.pathname.endsWith('.html') || url.pathname.endsWith('/') })
      .then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res.ok && RUNTIME_SHELL.test(url.pathname)) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
  );
});
