/* Simple offline cache for this static SPA (GitHub Pages friendly). */
const CACHE_NAME = "jolodosshu-offline-v8";

// We intentionally keep this list small; the runtime cache below will pick up
// the rest of the assets as you play.
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./404.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./robots.txt",
  "./opengraph.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

function isNavigationRequest(request) {
  return request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // SPA navigation fallback (important for offline + deep links)
  if (isNavigationRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          const network = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", network.clone());
          return network;
        } catch {
          const cached = await caches.match("./index.html", { ignoreSearch: true });
          return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })()
    );
    return;
  }

  // For JS/CSS/images: cache-first, then network (and store for next time)
  event.respondWith(
    (async () => {
      // Do NOT ignore query params for static assets; our site uses ?v=... cache-busting.
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const network = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, network.clone());
        return network;
      } catch {
        return new Response("", { status: 504 });
      }
    })()
  );
});
