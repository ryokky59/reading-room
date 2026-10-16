// Reading Room service worker.
// - Pages: network first; the last good copy is kept so opened articles read offline.
// - Build assets (/_next/static): cache first, they are content-hashed.
// - API calls, server actions and anything non-GET: always network.

const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const MAX_PAGES = 60;
const SHELL_FILES = ["/offline.html", "/icon-192.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const keep = [SHELL, PAGES, ASSETS];
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

async function pageFirst(request) {
  try {
    const res = await fetch(request);
    // Login redirects and errors are not worth keeping.
    if (res.ok && !res.redirected && res.type === "basic") {
      const cache = await caches.open(PAGES);
      await cache.put(request, res.clone());
      trim(PAGES, MAX_PAGES);
    }
    return res;
  } catch {
    return (
      (await caches.match(request, { ignoreSearch: false })) ??
      (await caches.match("/offline.html")) ??
      Response.error()
    );
  }
}

async function assetFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) (await caches.open(ASSETS)).put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(pageFirst(request));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(assetFirst(request));
  }
});
