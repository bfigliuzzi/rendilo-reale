import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { host: true },
  build: { target: 'es2022' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate', // le SW se met à jour seul à chaque déploiement
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Rendilo Reale — Horde Shooter',
        short_name: 'Rendilo',
        description:
          'Horde-shooter vertical : fais grossir ton escouade, survis à l’apocalypse.',
        lang: 'fr',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0b1016',
        background_color: '#0b1016',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // tout le jeu est statique et généré en code : précache intégral = offline complet
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
});
