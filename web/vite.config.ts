import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    // emptyOutDir wipes server/dist; keep the placeholder so go:embed always has a file in a fresh checkout.
    {
      name: 'keep-dist-placeholder',
      apply: 'build',
      closeBundle() {
        writeFileSync(fileURLToPath(new URL('../server/dist/.gitkeep', import.meta.url)), '')
      },
    },
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeManifestIcons: false,
      manifest: {
        name: 'Pieceful',
        short_name: 'Pieceful',
        description: 'Jigsaw puzzles of famous masterpieces, 100 to 5000 pieces. Works offline.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#FBF7F2',
        theme_color: '#FBF7F2',
        lang: 'en',
        categories: ['games', 'entertainment'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}', 'art/*/thumb.webp'],
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,vietnamese,latin-ext}-*.woff2'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        runtimeCaching: [
          {
            // Full-size artwork is cached the first time a puzzle is played → offline afterwards.
            urlPattern: ({ url }) => url.pathname.startsWith('/art/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'art',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 80, maxAgeSeconds: 365 * 24 * 3600, purgeOnQuotaError: true },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: 'es' },
  build: {
    outDir: '../server/dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: { host: true },
  test: { environment: 'node' },
} as any)
