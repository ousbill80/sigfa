/*
 * NOTIF-005-B — SIGFA ticket PWA service worker.
 *
 * Scope: `/q/`. Progressive enhancement only — the page works without it.
 * Strategy:
 *   - App navigations (`/q/...`)          → network-first, fall back to cache.
 *   - Public tracking (`/public/tickets`) → network-first, cache the last good
 *     response so a flaky network still shows a recent ticket state (aligned on
 *     the contract `Cache-Control: max-age=30`). Never caches error responses.
 *   - Everything else                     → passthrough.
 * No credentials, no auth headers, no PII stored beyond the public tracking body
 * (which already excludes the internal ticket uuid).
 */
const CACHE = "sigfa-pwa-v1";
const APP_SHELL = ["/manifest.webmanifest", "/pwa-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Network-first with cache fallback; only successful GETs are cached. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (request.method === "GET" && response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isTracking = url.pathname.includes("/public/tickets/");
  const isAppNav = request.mode === "navigate" && url.pathname.startsWith("/q/");

  if (isTracking || isAppNav) {
    event.respondWith(networkFirst(request));
  }
});
