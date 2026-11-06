/* آینه — service worker: network-first with an offline fallback. */
const CACHE = "ayeneh-v4";
const SHELL = [
  "./",
  "./index.html",
  "./assets/style.css",
  "./assets/app.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const OFFLINE = () =>
  new Response("آفلاین", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fonts, translation, nothing to do

  // immutable assets (hash-named images, article bodies): cache first, instant
  if (url.pathname.includes("/data/img/") || url.pathname.includes("/data/articles/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(OFFLINE))
    );
    return;
  }

  // the list itself: serve the cached copy instantly, refresh in the background
  if (url.pathname.endsWith("/data/news.json")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => null);
        return hit || (await network) || OFFLINE();
      })
    );
    return;
  }

  // everything else: network first, cache as a fallback
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        return OFFLINE();
      })
  );
});
