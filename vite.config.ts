import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { host: true },
  appType: 'mpa', // pas de fallback SPA : URL inconnue → 404 franc
  resolve: {
    // modules communs aux jeux (loop, rng, math, spatialGrid) — voir shared/
    alias: { '@shared': resolve(__dirname, 'shared') },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      // Une entrée par page. Tout nouveau jeu s'ajoute ici ET dans hub/games.ts.
      input: {
        hub: resolve(__dirname, 'index.html'),
        horde: resolve(__dirname, 'games/horde/index.html'),
        hive: resolve(__dirname, 'games/hive/index.html'),
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate', // le SW se met à jour seul à chaque déploiement
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Rendilo Reale',
        short_name: 'Rendilo',
        description: 'Une collection de jeux d’arcade jouables hors ligne.',
        lang: 'fr',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#0b1016',
        background_color: '#0b1016',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // tout est statique et généré en code : précache intégral = offline complet
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
});
