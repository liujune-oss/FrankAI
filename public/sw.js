// Minimal service worker for PWA install support
const CACHE_NAME = 'gemini-chat-v2';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Pass through all network requests but satisfy the PWA fetch handler requirement
    event.respondWith(
        fetch(event.request).catch(() => {
            // Fallback for offline (optional, but good for installability score)
            return new Response('Offline Mode', {
                status: 503,
                statusText: 'Service Unavailable'
            });
        })
    );
});
