import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Version = date/heure du dernier commit, lisible par un humain et monotone.
// Chaque push déclenche un build Netlify → la version change toute seule.
// (Pas de compteur de commits : le clone Netlify est shallow, le compte mentirait.)
function computeVersion(): string {
  try {
    return execSync("git log -1 --format=%cd --date=format:'%d/%m/%Y %Hh%M'", {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
      .replace(/'/g, '');
  } catch {
    return 'dev';
  }
}
const APP_VERSION = computeVersion();

export default defineConfig({
  // Injectée dans le code (affichage hub) — voir hub/env.d.ts pour le type.
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
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
    {
      // /version.json publie la version du déploiement courant. Les .json sont
      // HORS des globPatterns du SW (précache) : le hub peut donc le fetch en
      // réseau pour savoir si la PWA installée est en retard d'un déploiement.
      name: 'emit-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: APP_VERSION }),
        });
      },
    },
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
