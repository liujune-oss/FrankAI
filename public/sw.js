// Minimal service worker for PWA install support
const CACHE_NAME = 'gemini-chat-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Network-first strategy - just pass through
    // This is the minimum needed for PWA installability
});
