import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Tiny plugin: mirror node_modules/ionicons/dist/svg into public/svg/ before
// dev or build so ion-icon can resolve every glyph offline. We sync into
// public/ rather than directly into dist/ so the dev server picks it up too,
// and so vite-plugin-pwa's globPatterns precache the SVGs without extra
// configuration.
function ioniconsLocalAssets() {
  const src = resolve(__dirname, 'node_modules/ionicons/dist/svg');
  const dest = resolve(__dirname, 'public/svg');
  return {
    name: 'jamie-ionicons-local-assets',
    enforce: 'pre',
    buildStart() {
      if (!existsSync(src)) {
        this.warn(`[ionicons] source not found at ${src} — did you run npm install?`);
        return;
      }
      mkdirSync(dest, { recursive: true });
      try {
        const srcCount = readdirSync(src).length;
        const destCount = existsSync(dest) ? readdirSync(dest).length : 0;
        if (srcCount === destCount) return;
      } catch {
        // fall through and copy
      }
      cpSync(src, dest, { recursive: true });
    },
  };
}

// Jamie PWA — Vite config
// - base '' keeps asset URLs relative so the build works when served from a
//   GitHub Pages subpath or from file://-style local previews.
// - vite-plugin-pwa generates the manifest and a Workbox service worker.
// - No CDN runtime loads. Everything is bundled and precached.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
  plugins: [
    ioniconsLocalAssets(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null, // we register manually in src/main.js so we can show the update toast
      includeAssets: ['icons/icon.svg', 'icons/icon-maskable.svg'],
      manifest: {
        name: 'Jamie',
        short_name: 'Jamie',
        description: 'Offline-first training, nutrition, and daily log.',
        lang: 'en-GB',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        icons: [
          // SVG icons carry any size; Chrome accepts them as both 192 and 512.
          // TODO (Session 2): run pwa-asset-generator to produce real PNGs for
          // older Android launchers that don't rasterise SVG cleanly.
          { src: 'icons/icon.svg', sizes: '192x192 512x512', type: 'image/svg+xml' },
          {
            src: 'icons/icon-maskable.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // content.json: stale-while-revalidate so new content lands next launch
            urlPattern: ({ url }) => url.pathname.endsWith('/content.json'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'jamie-content-v1',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
});
