// Minimal service worker for PWA install support
const CACHE_NAME = 'gemini-chat-v2';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Ignored requests for faster passthrough
    if (
        event.request.method !== 'GET' ||
        event.request.url.includes('/api/') ||
        event.request.url.includes('chrome-extension://') ||
        event.request.url.includes('_next/')
    ) {
        return;
    }

    // Network-first strategy for everything else
    event.respondWith(
        fetch(event.request).catch(() => {
            // Return a basic offline response instead of crashing
            return new Response('Offline Mode', {
                headers: { 'Content-Type': 'text/plain' },
                status: 503,
                statusText: 'Service Unavailable'
            });
        })
    );
});
