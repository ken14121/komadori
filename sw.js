/* コマドリ sw.js — Service Worker
 * 方針: オンラインなら常に最新を配る(network-first)。キャッシュは圏外用の保険。
 * 更新のたびに VERSION を上げると、古いキャッシュが activate で破棄される。
 */
const VERSION = "komadori-v2";
const FONT_CACHE = VERSION + "-fonts";

const PRECACHE = [
  "./",
  "./index.html",
  "./css/base.css",
  "./css/components.css",
  "./css/modules.css",
  "./js/util.js",
  "./js/store.js",
  "./js/lms.js",
  "./js/grid.js",
  "./js/sheet.js",
  "./js/assignments.js",
  "./js/importer.js",
  "./js/settings.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== VERSION && k !== FONT_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Anthropic API へのリクエストは絶対に扱わない
  if (url.hostname === "api.anthropic.com") return;

  // LMS中継関数(サーバーレス)はキャッシュしない
  if (url.pathname.startsWith("/api/")) return;

  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  const isSameOrigin = url.origin === self.location.origin;

  // ナビゲーション: ネットワーク優先、失敗時は index.html にフォールバック
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // 同一オリジン: network-first。
  // cache-first だと更新のたびに必ず1回古い版が表示される(次回訪問でようやく新しくなる)ため、
  // オンラインなら常に最新を配り、キャッシュはオフライン時のフォールバックに徹させる。
  // ファイルは全部で数十KBなので、毎回取りに行っても体感差はない。
  if (isSameOrigin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req)) // 圏外: キャッシュから返す(時間割はオフラインで開ける)
    );
    return;
  }

  // Google Fonts: cache-first(ランタイムキャッシュ)
  if (isFont) {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          });
        })
      )
    );
  }
});
