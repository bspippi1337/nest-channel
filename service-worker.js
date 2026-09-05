const CACHE = "nest-channel-v8";
const ASSETS = ["./", "./index.html", "./storage-sandbox.js", "./nest-core.js", "./app.js", "./styles.css", "./github-sync.js", "./github-sync.css", "./about.js", "./about.css", "./ux-v06.js", "./ux-v06.css", "./security-v07.js", "./security-v07.css", "./manifest.webmanifest", "./icon.svg", "./nest-channel-comic.webp"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
