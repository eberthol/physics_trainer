const CACHE_NAME = "nuclide-cache";
const VERSION_URL = "./version.json";
const VERSION_KEY = "__nuclide_version__";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./version.json",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js",
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
];

async function fetchLatestVersion() {
  const response = await fetch(VERSION_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`version.json fetch failed: ${response.status}`);
  }
  const data = await response.json();
  return String(data.version || "").trim();
}

async function getCachedVersion(cache) {
  const response = await cache.match(VERSION_KEY);
  return response ? (await response.text()).trim() : null;
}

async function storeVersion(cache, version) {
  await cache.put(
    VERSION_KEY,
    new Response(version, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  );
}

async function cacheAppShell(cache) {
  await cache.addAll(APP_SHELL);
}

async function syncIfNeeded() {
  const cache = await caches.open(CACHE_NAME);
  const latest = await fetchLatestVersion();
  const current = await getCachedVersion(cache);

  if (current === latest) {
    return { updated: false, version: latest };
  }

  await cacheAppShell(cache);
  await storeVersion(cache, latest);
  return { updated: true, version: latest, previous: current };
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const result = await syncIfNeeded();
      console.log(
        result.updated
          ? `NUCLIDE installed/updated to v${result.version}`
          : `NUCLIDE already at v${result.version}`
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const result = await syncIfNeeded();
      console.log(
        result.updated
          ? `NUCLIDE activated at v${result.version}`
          : `NUCLIDE activated (v${result.version})`
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const request = event.request;

      try {
        const cached = await caches.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw new Error("Offline and not cached");
      }
    })()
  );
});