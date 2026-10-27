const CACHE = "duelzone-offline-v2-20261027";
const STATIC = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("duelzone-offline-") && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener("message", event => {
  if (event.data?.type === "APPLY_UPDATE") self.skipWaiting();
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return;
  if (event.request.mode === "navigate") event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
  else if (STATIC.includes(url.pathname)) event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
