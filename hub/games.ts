// Registre des jeux du hub. Ajouter un jeu = un dossier games/<id>/ avec son
// index.html, une entrée ici ET une entrée dans build.rollupOptions.input
// (vite.config.ts) — les deux listes doivent rester synchrones.
export interface GameEntry {
  id: string;
  title: string;
  tagline: string;
  path: string;
  emoji: string;
}

export const GAMES: GameEntry[] = [
  {
    id: 'horde',
    title: 'Horde',
    tagline: 'Fais grossir ton escouade, survis à l’apocalypse.',
    path: '/games/horde/',
    emoji: '🪖',
  },
  {
    id: 'hive',
    title: 'Essaim',
    tagline: 'Abeilles contre cafards : submerge la ruche adverse.',
    path: '/games/hive/',
    emoji: '🐝',
  },
  {
    id: 'mind',
    title: 'Cerveau',
    tagline: 'Casse le code secret… si le chat te laisse faire.',
    path: '/games/mind/',
    emoji: '🧠',
  },
  {
    id: 'crib',
    title: 'Berceau',
    tagline: 'Un bébé, ses cubes, et des mamies qui veulent un bisou.',
    path: '/games/crib/',
    emoji: '🍼',
  },
];
