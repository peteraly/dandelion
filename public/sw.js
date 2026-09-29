/* Dandelion service worker: offline shell for notes only (§3.10).
 * Caches the app shell assets and the /notes page so a field user can open
 * it without network and write non-financial notes. Every other route is
 * network-only: nothing financial is ever served from a cache. */
const VERSION = "v1";
const SHELL = `dandelion-shell-${VERSION}`;
const OFFLINE_PAGES = ["/notes", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(OFFLINE_PAGES).catch(() => undefined)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Static assets: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.open(SHELL).then(async (c) => (await c.match(req)) ?? fetch(req).then((r) => (c.put(req, r.clone()), r))));
    return;
  }
  // The notes page: network first, fall back to the cached copy when offline.
  if (url.pathname === "/notes") {
    event.respondWith(
      fetch(req)
        .then((r) => {
          caches.open(SHELL).then((c) => c.put(req, r.clone()));
          return r;
        })
        .catch(() => caches.match(req).then((r) => r ?? caches.match("/offline"))),
    );
    return;
  }
  // Everything else: network only; show the offline page if the network is down.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline")));
  }
});
