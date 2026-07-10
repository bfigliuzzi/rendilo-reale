export const SIM_DT = 1 / 60;
const MAX_STEPS = 5;

/**
 * Boucle à pas fixe : `update` tourne à 60 Hz exactement, `render` à la fréquence
 * de l'écran avec un alpha d'interpolation (position rendue = lerp(prev, curr, alpha)).
 */
export function startLoop(
  update: (dt: number) => void,
  render: (alpha: number, frameMs: number) => void,
): void {
  let last = performance.now();
  let acc = 0;

  function frame(now: number): void {
    const frameMs = now - last;
    last = now;
    // clamp : évite la spirale de rattrapage après un retour d'onglet
    acc = Math.min(acc + frameMs / 1000, MAX_STEPS * SIM_DT);
    while (acc >= SIM_DT) {
      update(SIM_DT);
      acc -= SIM_DT;
    }
    render(acc / SIM_DT, frameMs);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
