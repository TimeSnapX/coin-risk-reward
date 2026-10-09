/*
 * Coin Risk vs Reward service worker: makes the app installable and lets saved results open offline.
 * - Handles ONLY same-origin GET requests inside /coin-risk-reward/. Every cross-origin request
 *   (RugCheck, DexScreener, GeckoTerminal, Solana RPC, Jupiter, CoinGecko) is never intercepted and never cached.
 * - Network first: online behaviour is unchanged; the cache is only an offline fallback for the app's own files.
 * Bump VERSION to drop old caches.
 */
const VERSION = "v4";
const CACHE = `coin-risk-reward-${VERSION}`;
const SCOPE = new URL(self.registration.scope);
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "favicon.svg",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
  "css/app.css?v=2", "src/app.js?v=2", "src/config.js", "src/chain.js", "src/store.js", "src/ui/chart.js",
  "src/data/fetchers.js", "src/data/collect.js", "src/data/solana.js", "src/scoring/rules.js", "src/scoring/engine.js",
];
function handled(request) {
  if (request.method !== "GET") return false;
  if (request.headers.has("range")) return false;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return false;            // never touch API / cross-origin calls
  if (!url.pathname.startsWith(SCOPE.pathname)) return false;
  if (url.pathname === `${SCOPE.pathname}sw.js`) return false;
  return true;
}
const isPage = (r) => r.mode === "navigate" || (r.headers.get("accept") || "").includes("text/html");
function cacheKey(request) { const u = new URL(request.url); u.hash = ""; if (isPage(request)) u.search = ""; return u.href; }

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(SHELL.map((p) => {
    const u = new URL(p, SCOPE).href;
    return fetch(new Request(u, { cache: "reload" })).then((res) => (res.ok ? cache.put(u, res) : null)).catch(() => null);
  }))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("coin-risk-reward-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!handled(request)) return;
  const key = cacheKey(request);
  event.respondWith(fetch(request).then((res) => {
    if (res.ok && res.type === "basic") { const copy = res.clone(); event.waitUntil(caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {})); }
    return res;
  }).catch(async () => {
    const cache = await caches.open(CACHE);
    const hit = (await cache.match(key)) || (await cache.match(request.url, { ignoreSearch: isPage(request) }));
    if (hit) return hit;
    if (isPage(request)) { const shell = (await cache.match(SCOPE.href)) || (await cache.match(new URL("index.html", SCOPE).href)); if (shell) return shell; }
    return Response.error();
  }));
});
