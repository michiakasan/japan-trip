import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// base "./" = every URL in the built app is relative, so the same build works at
// https://squash-results.com/akari/japan-place/ and on GitHub Pages (or any other folder).
// The app uses #/ addresses for its screens, so the server needs no special rules.
export default defineConfig({
  base: "./",
  server: {
    host: true,
    // During `npm run dev`, requests to /api/ go to our server running locally (`npm run server`).
    proxy: { "/api": "http://127.0.0.1:5020" },
  },
  plugins: [
    // Makes the app installable ("Add to Home Screen") and work offline.
    // It writes manifest.webmanifest and a service worker (sw.js) into the build.
    VitePWA({
      registerType: "autoUpdate", // a new deploy replaces the old version automatically
      injectRegister: "auto",
      includeAssets: ["icons/apple-touch-icon.png", "icons/favicon-64.png"],
      manifest: {
        name: "Japanchansky",
        short_name: "Japanchansky",
        description: "Our Japan islands, cities and trips",
        lang: "en",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#f7f3ea",
        theme_color: "#f7f3ea",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Saved on the phone at install: the app itself and places.json
        globPatterns: ["**/*.{js,css,html,json,png,webp,svg}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/\/api\//], // the API is never answered from the cache
        // Saved as you use the app (so what you've seen also works offline):
        runtimeCaching: [
          {
            // Wikimedia Commons photos
            urlPattern: ({ url }) => url.hostname === "upload.wikimedia.org",
            handler: "CacheFirst",
            options: {
              cacheName: "commons-photos",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Map tiles. OpenStreetMap asks apps to cache tiles rather than re-download them.
            urlPattern: ({ url }) => url.hostname === "tile.openstreetmap.org",
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Our own photos from our server (…/api/photos/<id>/thumb or /full).
            // A photo never changes once uploaded, so the saved copy is always right.
            urlPattern: ({ url }) => /\/api\/photos\/[0-9a-f-]+\/(full|thumb)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "our-photos",
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Google Fonts (the font list, then the font files)
            urlPattern: ({ url }) => url.hostname === "fonts.googleapis.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "font-css" },
          },
          {
            urlPattern: ({ url }) => url.hostname === "fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "font-files",
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
});
