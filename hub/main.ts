import { registerSW } from 'virtual:pwa-register';
import { GAMES } from './games';

registerSW({ immediate: true }); // PWA : SW unique à la racine, partagé hub + jeux

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
