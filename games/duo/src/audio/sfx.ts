/**
 * Sons 100 % synthétisés en WebAudio — aucun asset, pattern des cinq autres
 * jeux du hub.
 *
 * DEUX ÉCARTS ASSUMÉS, tous deux dictés par le §1.2 « mode restaurant » :
 *   ① MUET PAR DÉFAUT (`save.muted` vaut `true` à la première ouverture). Les
 *      autres jeux du hub démarrent avec le son ; ici le cas nominal est une
 *      salle d'attente, et un jeu qui se met à sonner tout seul se fait couper,
 *      pas monter.
 *   ② Aucun son STRIDENT, aucun son de défaite PUNITIF. Les timbres sont des
 *      sinus et des triangles doux, jamais des dents de scie ; la « défaite »
 *      descend gentiment au lieu de gronder. Il y a un enfant de 5 ans en face.
 *
 * `muted` et le throttling sont vérifiés tout EN BAS de la pile, dans `tone` et
 * `noise` : aucune méthode de son n'a à s'en soucier.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private readonly lastPlay = new Map<string, number>();

  constructor(public muted: boolean) {
    // Les navigateurs bloquent l'audio avant interaction : on crée le contexte
    // paresseusement, au premier geste — pointeur OU clavier (jouer au clavier
    // donne droit au son comme les autres).
    const unlock = (): void => {
      this.ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.34; // volume doux : on joue à côté d'une table
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      return ctx;
    } catch {
      return null; // pas d'audio : la collection reste entièrement jouable
    }
  }

  private throttled(key: string, ms: number): boolean {
    const now = performance.now();
    const last = this.lastPlay.get(key) ?? -Infinity;
    if (now - last < ms) return true;
    this.lastPlay.set(key, now);
    return false;
  }

  private tone(
    freq: number,
    dur: number,
    opts: {
      type?: OscillatorType;
      vol?: number;
      delay?: number;
      endFreq?: number;
    } = {},
  ): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), t0 + dur);
    }
    gain.gain.setValueAtTime(opts.vol ?? 0.18, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur); // decay exp : jamais de clic
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  private noise(dur: number, vol: number, filterFreq: number, delay = 0): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (!this.noiseBuf) {
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const data = buf.getChannelData(0);
      // Bruit blanc généré UNE fois et réutilisé en boucle : pas d'allocation
      // par son. `Math.random` est ici du BRUIT AUDIO, pas du contenu de jeu.
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  // ───────── Vocabulaire sonore de la collection ─────────

  /** Curseur, tap d'une case : une pichenette de bois. */
  tap(): void {
    if (this.throttled('tap', 45)) return;
    this.tone(680, 0.05, { vol: 0.09 });
  }

  /** Pose d'une tuile, d'un bloc : le « thunk » du §3.4. */
  thunk(): void {
    if (this.throttled('thunk', 60)) return;
    this.tone(180, 0.09, { type: 'sine', vol: 0.16, endFreq: 120 });
    this.noise(0.06, 0.08, 900);
  }

  /** Coupe (gâteau, branche) : un frottement court, jamais un tranchant. */
  cut(): void {
    this.noise(0.13, 0.1, 2400);
    this.tone(520, 0.09, { type: 'sine', vol: 0.1, endFreq: 380 });
  }

  /** Récolte : une pomme qui tombe dans le panier. */
  pick(): void {
    if (this.throttled('pick', 40)) return;
    this.tone(620, 0.08, { type: 'sine', vol: 0.13, endFreq: 880 });
  }

  /** Rebond, replacement au point de contrôle : doux, jamais punitif. */
  bump(): void {
    if (this.throttled('bump', 70)) return;
    this.tone(240, 0.07, { type: 'sine', vol: 0.1, endFreq: 190 });
  }

  /** Passage du téléphone : deux notes, on ENTEND que ça change de main. */
  pass(): void {
    this.tone(440, 0.12, { type: 'sine', vol: 0.14 });
    this.tone(660, 0.16, { type: 'sine', vol: 0.12, delay: 0.09 });
  }

  /** But atteint (trou de sortie, porte, traversée). */
  goal(): void {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, { type: 'sine', vol: 0.14, delay: i * 0.07 }));
  }

  /** Fin de manche gagnée : une petite fanfare de cloches. */
  win(): void {
    [523, 659, 784, 1046].forEach((f, i) =>
      this.tone(f, 0.22, { type: 'sine', vol: 0.15, delay: i * 0.1 }),
    );
  }

  /**
   * Fin de manche perdue. DESCENDANTE ET DOUCE : pas de buzz, pas de grondement.
   * Perdre doit sonner comme « à toi de choisir le prochain », pas comme une
   * punition — c'est littéralement ce qui arrive ensuite (§1.3).
   */
  lose(): void {
    [660, 560, 470].forEach((f, i) =>
      this.tone(f, 0.2, { type: 'sine', vol: 0.12, delay: i * 0.11 }),
    );
  }
}

/**
 * Instance partagée par le shell et les huit micro-jeux. Muette tant que la
 * session n'a pas dit le contraire — `Session` pousse `save.muted` dedans au
 * boot et à chaque bascule du bouton 🔊.
 */
export const sfx = new Sfx(true);
