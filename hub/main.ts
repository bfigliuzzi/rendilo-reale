import { registerSW } from 'virtual:pwa-register';
import { GAMES } from './games';

// PWA : SW unique à la racine, partagé hub + jeux
const updateSW = registerSW({ immediate: true });

// Version du build affiché (date/heure du commit, injectée au build). La PWA
// peut servir un précache en retard : on compare à /version.json (jamais
// précaché) et on propose la mise à jour si le serveur a plus récent.
document.getElementById('version')!.textContent = `Version du ${__APP_VERSION__}`;

async function checkLatestVersion(): Promise<void> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = (await res.json()) as { version?: string };
    if (version && version !== __APP_VERSION__) {
      const btn = document.getElementById('version-update') as HTMLButtonElement;
      btn.hidden = false;
      // updateSW force le SW à récupérer le nouveau build puis recharge la page.
      btn.onclick = () => void updateSW(true);
    }
  } catch {
    // hors ligne (ou dev sans build) : la version locale suffit
  }
}
if (import.meta.env.PROD) {
  void checkLatestVersion();
  // PWA relancée depuis l'écran d'accueil : re-vérifier au retour au premier plan
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkLatestVersion();
  });
}

const list = document.getElementById('games')!;
list.innerHTML = GAMES.map(
  (g) => `
  <a class="game-card" href="${g.path}">
    <span class="game-emoji" aria-hidden="true">${g.emoji}</span>
    <span class="game-text">
      <span class="game-title">${g.title}</span>
      <span class="game-tagline">${g.tagline}</span>
    </span>
    <span class="game-go" aria-hidden="true">▶</span>
  </a>`,
).join('');
