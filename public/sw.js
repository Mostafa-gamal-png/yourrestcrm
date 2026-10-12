'use strict';

// Only a generated public shell and its exact, integrity-checked assets enter
// Cache Storage. Private HTML, API responses, attachments and map tiles never do.
const CACHE_PREFIX = 'yourrest-crm-offline-';
const BUILD_REVISION = '39ae55fbcc3c722d84636aadd0c3d31f06a17cd03c27ad894351b83c2ae18f77';
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_REVISION}`;
const MANIFEST_URL = '/offline-shell-manifest.json';
const SHELL_URL = '/offline-app.html';
const OFFLINE_URL = '/offline.html';
const fixedAssets = new Set([SHELL_URL, OFFLINE_URL, '/theme-bootstrap.js', '/install-bootstrap.js', '/yourrest-logo.png', '/yourrest-company-icon.svg', '/manifest.webmanifest']);
let allowedAssets;

function permittedAsset(path) {
  return fixedAssets.has(path)
    || /^\/offline-app\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|png|svg|webp|woff2?)$/.test(path)
    || /^\/icons\/yourrest-company-(?:192|512|apple|maskable-192|maskable-512)\.png$/.test(path);
}
function checkedResponse(response, pathname) {
  const finalUrl = new URL(response.url || pathname, self.location.origin);
  if (!response.ok || response.redirected || response.type === 'opaque'
    || finalUrl.origin !== self.location.origin || finalUrl.pathname !== pathname || finalUrl.search) {
    throw new Error('Offline shell resource could not be installed');
  }
  return response;
}
function validateManifest(manifest) {
  if (!manifest || manifest.format !== 'yourrest-offline-shell-v1' || manifest.revision !== BUILD_REVISION
    || !Array.isArray(manifest.assets) || manifest.assets.length < 3 || manifest.assets.length > 400) throw new Error('Invalid offline shell manifest');
  const urls = new Set();
  for (const asset of manifest.assets) {
    if (!asset || typeof asset.url !== 'string' || !permittedAsset(asset.url) || urls.has(asset.url)
      || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid offline shell asset');
    urls.add(asset.url);
  }
  if (!urls.has(SHELL_URL) || !urls.has(OFFLINE_URL) || ![...urls].some(url => /\/offline-app\/assets\/.*\.js$/.test(url))) throw new Error('Incomplete offline shell');
  return urls;
}
async function allowed() {
  if (allowedAssets) return allowedAssets;
  const cache = await caches.open(CACHE_NAME);
  const manifest = await cache.match(MANIFEST_URL);
  if (!manifest) return new Set();
  try { allowedAssets = validateManifest(await manifest.json()); } catch { return new Set(); }
  return allowedAssets;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = checkedResponse(await fetch(MANIFEST_URL, { cache: 'reload', credentials: 'omit' }), MANIFEST_URL);
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Invalid offline shell content type');
    const manifest = await response.json();
    const urls = validateManifest(manifest);
    const cache = await caches.open(CACHE_NAME);
    try {
      for (const asset of manifest.assets) {
        const fetched = checkedResponse(await fetch(asset.url, { cache: 'reload', credentials: 'omit' }), asset.url);
        const bytes = await fetched.clone().arrayBuffer();
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (digest !== asset.sha256) throw new Error('Offline shell integrity mismatch');
        await cache.put(asset.url, fetched);
      }
      await cache.put(MANIFEST_URL, new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }));
      allowedAssets = urls;
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/files' || url.pathname.startsWith('/files/')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Server denial and redirects stay authoritative; only transport failure
        // opens the data-free client shell. It separately checks local unlock.
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const fallback = url.pathname === '/' || url.pathname === SHELL_URL ? SHELL_URL : OFFLINE_URL;
        return await cache.match(fallback) || await cache.match(OFFLINE_URL) || new Response('Yourrest CRM: Internet connection required.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
    })());
  } else if (!url.search && permittedAsset(url.pathname)) {
    event.respondWith((async () => {
      if ((await allowed()).has(url.pathname)) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
      }
      return fetch(request);
    })());
  }
});
