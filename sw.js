const CACHE_VERSION = 'wonder-reading-shell-v8';
// 개발 중에는 고친 파일이 바로 보여야 합니다. 배포된 주소에서만 캐시를 먼저 씁니다.
const DEV_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const IS_DEV_HOST = DEV_HOSTS.includes(self.location.hostname);
const APP_SHELL = [
    './',
    './index.html',
    './styles.css',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './assets/wonder.webp',
    './js/app.js',
    './js/auth.js',
    './js/config.js',
    './js/firebase-content.js',
    './js/library-cache.js',
    './js/chapter-organization.js',
    './js/tts.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys
                .filter(key => key !== CACHE_VERSION)
                .map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const isAppAsset = url.origin === self.location.origin;

    // 새 버전을 알아채야 하는 파일이라 캐시에 넣지 않고 항상 네트워크로 보냅니다.
    if (isAppAsset && url.pathname.endsWith('/version.json')) return;

    const isRuntimeAsset = url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/');

    // 승인 확인과 Firebase 데이터는 항상 네트워크 또는 Firebase SDK에서 처리합니다.
    if (!isAppAsset && !isRuntimeAsset) return;

    event.respondWith(respondWithCacheFirst(event));
});

// 캐시에 있으면 네트워크를 기다리지 않고 바로 돌려줍니다. 갱신은 화면을 막지 않는
// 곳에서 따로 하므로, 두 번째 실행부터는 앱 껍데기가 즉시 뜹니다.
async function respondWithCacheFirst(event) {
    if (IS_DEV_HOST) return respondWithNetworkFirst(event.request);

    const cached = await matchCachedRequest(event.request);
    if (cached) {
        event.waitUntil(revalidate(event.request));
        return cached;
    }

    return fetchAndCache(event.request);
}

async function respondWithNetworkFirst(request) {
    try {
        return await fetchAndCache(request);
    } catch (error) {
        const cached = await matchCachedRequest(request);
        if (cached) return cached;
        throw error;
    }
}

async function matchCachedRequest(request) {
    const isNavigation = request.mode === 'navigate';
    const cached = await caches.match(request, { ignoreSearch: isNavigation });
    if (cached) return cached;
    if (isNavigation) return caches.match('./index.html');
    return undefined;
}

async function fetchAndCache(request) {
    const response = await fetch(request);
    if (!response.ok) return response;

    const copy = response.clone();
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(request, copy);
    return response;
}

async function revalidate(request) {
    try {
        await fetchAndCache(request);
    } catch (error) {
        // 네트워크가 없으면 이미 돌려준 캐시를 그대로 씁니다.
    }
}
