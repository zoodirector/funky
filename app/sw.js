/**
 * Service worker: cache-first for the app shell so the app opens offline.
 *
 * The file list below is maintained by hand. That is the one real cost of
 * having no build step — adding a JS or CSS module means adding a line here,
 * and bumping CACHE_VERSION so existing installs pick the change up.
 */

const CACHE_VERSION = "v1";
const CACHE_NAME = `funky-${CACHE_VERSION}`;

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",

  "./css/tokens.css",
  "./css/base.css",
  "./css/components.css",
  "./css/layout.css",
  "./css/views.css",

  "./js/app.js",
  "./js/core/db.js",
  "./js/core/model.js",
  "./js/core/fsrs.js",
  "./js/core/scheduler.js",
  "./js/core/queue.js",
  "./js/core/codec.js",
  "./js/core/merge.js",
  "./js/core/share.js",
  "./js/core/store.js",
  "./js/ui/dom.js",
  "./js/ui/router.js",
  "./js/ui/shell.js",
  "./js/ui/theme.js",
  "./js/ui/components/dialog.js",
  "./js/ui/components/toast.js",
  "./js/ui/views/decks.js",
  "./js/ui/views/deck.js",
  "./js/ui/views/review.js",
  "./js/ui/views/note-editor.js",
  "./js/ui/views/import.js",
  "./js/ui/views/stats.js",
  "./js/ui/views/settings.js",

  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // addAll is all-or-nothing; caching individually means one missing asset
      // cannot leave the app with no offline shell at all.
      await Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => console.warn("[sw] skipped", url)))
      );
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const response = await fetch(request);
        // Cache same-origin successes so a file added after install (or a
        // navigation to a path not in SHELL) is available next time.
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        // Offline and uncached: a navigation still gets the app shell, which
        // can render every route from local data.
        if (request.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        throw error;
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") self.skipWaiting();
});
