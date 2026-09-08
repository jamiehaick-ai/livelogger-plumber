// Bumping CACHE_NAME forces old cached files to be replaced on next load.
const CACHE_NAME = "livelogger-plumber-v4";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./bryan-template.pdf",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

// App shell: cache-first (works with zero signal).
// Everything else (e.g. the /api/parse call): network-first, no caching.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isShellFile = SHELL_FILES.some((f) => {
    if (f.startsWith("http")) return event.request.url === f;
    return url.pathname.endsWith(f.replace("./", "/"));
  });

  if (isShellFile) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
  // else: let it hit the network normally (API calls, CDN scripts)
});
