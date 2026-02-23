const { generateSW } = require('workbox-build');

generateSW({
    globDirectory: '.next/static/',
    globPatterns: ['**/*.{js,css,json,png,svg}'],
    swDest: 'public/sw.js',
    clientsClaim: true,
    skipWaiting: true,
    runtimeCaching: [
        {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
                cacheName: 'google-fonts',
                expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
        },
        {
            urlPattern: /.*_next\/image\?.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
                cacheName: 'next-image',
                expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
        },
        {
            urlPattern: /\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
                cacheName: 'static-font-assets',
                expiration: { maxEntries: 4, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
        },
        {
            urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
                cacheName: 'static-image-assets',
                expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
        },
        {
            urlPattern: /\/api\/.*$/i,
            handler: 'NetworkOnly',
        },
        {
            urlPattern: /.*/i,
            handler: 'NetworkFirst',
            options: {
                cacheName: 'others',
                expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
                networkTimeoutSeconds: 10,
            },
        },
    ],
}).then(({ count, size }) => {
    console.log(`Generated sw.js, which will precache ${count} files, totaling ${size} bytes.`);
}).catch((err) => {
    console.error('Workbox generation failed:', err);
});
