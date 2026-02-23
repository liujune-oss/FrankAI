const withSerwist = require("@serwist/next").default({
    swSrc: "src/app/sw.ts",
    swDest: "public/sw.js",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    turbopack: {},
};

module.exports = withSerwist(nextConfig);
