const CACHE_VERSION = 'wonder-reading-shell-v4';
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './assets/wonder.webp',
    './js/app.js',
    './js/auth.js',
    './js/config.js',
    './js/firebase-content.js',
    './js/library-cache.js',
    './js/chapter-organization.js'
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
    const isRuntimeAsset =
        url.hostname === 'cdn.tailwindcss.com' ||
        (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/'));

    // 승인 확인과 Firebase 데이터는 항상 네트워크 또는 Firebase SDK에서 처리합니다.
    if (!isAppAsset && !isRuntimeAsset) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(async () => {
                const cached = await caches.match(event.request);
                if (cached) return cached;
                if (event.request.mode === 'navigate') return caches.match('./index.html');
                throw new Error('offline-resource-unavailable');
            })
    );
});
