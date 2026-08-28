const cacheName = 'sideterm-mobile-v7';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(['./', './mobile.css', './terminal-frame.js', './terminal-reflow.js', './mobile.js', './xterm.css', './xterm.js', './fit-addon.js', './icon.png'])));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith('sideterm-mobile-') && key !== cacheName)
    .map((key) => caches.delete(key))))
])));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.url.includes('/socket')) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(cacheName).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
