const CACHE_NAME = "nuclide-cache";
const VERSION_KEY = "__version__";

const FILES = [
    "./",
    "./index.html",
    "./manifest.json",
    "./icon-192.png",
    "./icon-512.png"
];

async function getLatestVersion() {

    const response = await fetch(
        "version.json",
        { cache: "no-store" }
    );

    return await response.json();
}

async function cacheVersion(cache, version){

    await cache.put(
        VERSION_KEY,
        new Response(version)
    );

}

async function currentVersion(cache){

    const response = await cache.match(VERSION_KEY);

    if(!response)
        return null;

    return await response.text();

}

async function updateCache(cache){

    await cache.addAll(FILES);

}

async function synchronize(){

    const latest = await getLatestVersion();

    const cache = await caches.open(CACHE_NAME);

    const current = await currentVersion(cache);

    if(current === latest.version){

        console.log(
            "NUCLIDE already up to date."
        );

        return;

    }

    console.log(
        `Updating ${current} → ${latest.version}`
    );

    await updateCache(cache);

    await cacheVersion(
        cache,
        latest.version
    );

}

self.addEventListener(
    "activate",
    event => {

        event.waitUntil(
            synchronize()
        );

    }
);

self.addEventListener(
    "fetch",
    event => {

        event.respondWith(

            caches.match(event.request)
                .then(r => r || fetch(event.request))

        );

    }
);