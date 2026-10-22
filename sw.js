/*
 * オフライン用の Service Worker。
 * - HTML・JS・CSS・データはネットを優先し、つながらないときだけキャッシュを使う
 * - アイコンはキャッシュを優先する
 * - 同じ配信元への GET だけを扱う
 * CACHE のバージョンは、この sw.js か PRECACHE の一覧を変えたときだけ上げる（data.js の更新では不要）。
 */
const CACHE = "lenormand-v1";
const PRECACHE = [
  "./",
  "index.html",
  "style.css",
  "data.js",
  "logic.js",
  "app.js",
  "manifest.json",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
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

function cacheable(res) {
  return res && res.ok && res.type === "basic";
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") {
      const page = await cache.match("index.html");
      if (page) return page;
    }
    return Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/\.(png|svg)$/.test(url.pathname)) event.respondWith(cacheFirst(req));
  else event.respondWith(networkFirst(req));
});
