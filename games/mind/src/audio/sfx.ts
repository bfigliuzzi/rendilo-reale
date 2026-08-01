/**
 * Sons 100 % synthétisés en WebAudio — zéro asset, donc zéro octet à précacher et
 * un jeu qui sonne dès la première ouverture hors ligne (pattern de Horde et
 * d'Essaim). Le contexte est créé PARESSEUSEMENT au premier geste : les
 * navigateurs refusent l'audio avant interaction.
 *
 * Le mute est testé tout en BAS de la pile (`tone` / `noise`), pour qu'aucune voix
 * n'ait à s'en soucier.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly lastPlay = new Map<string, number>();

  constructor(public muted: boolean) {
    const unlock = (): void => {
      this.ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    // clavier aussi : un joueur qui ne joue qu'au clavier a droit au son
    window.addEventListener('keydown', unlock);
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);

      // 0,5 s de bruit blanc, réutilisé par toutes les voix percussives
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      this.ctx = ctx;
      this.master = master;
      this.noiseBuffer = buffer;
      return ctx;
    } catch {
      return null; // pas d'audio disponible : le jeu reste parfaitement jouable
    }
  }

  /** `true` si la voix a déjà sonné il y a moins de `ms`. */
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
    opts: { type?: OscillatorType; vol?: number; endFreq?: number; delay?: number } = {},
  ): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), t0 + dur);
    gain.gain.setValueAtTime(opts.vol ?? 0.2, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  private noise(dur: number, vol: number, filterFreq: number, delay = 0): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuffer) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
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

  /** Sélection d'une couleur dans la palette. */
  select(): void {
    if (this.throttled('select', 50)) return;
    this.tone(660, 0.06, { type: 'triangle', vol: 0.14 });
  }

  /** Pose d'un pion : un « tac » de bois, court et sec. */
  place(): void {
    if (this.throttled('place', 40)) return;
    this.noise(0.06, 0.2, 1800);
    this.tone(320, 0.09, { type: 'triangle', vol: 0.16, endFreq: 180 });
  }

  /** Retrait d'un pion. */
  remove(): void {
    if (this.throttled('place', 40)) return;
    this.tone(240, 0.08, { type: 'sine', vol: 0.13, endFreq: 130 });
  }

  /** Validation de la ligne : un coup de tampon. */
  submit(): void {
    this.noise(0.14, 0.3, 900);
    this.tone(150, 0.16, { type: 'square', vol: 0.2, endFreq: 90 });
  }

  /**
   * Un marqueur qui se révèle. `index` monte l'arpège : la cascade se LIT à
   * l'oreille autant qu'à l'œil.
   */
  mark(exact: boolean, index: number): void {
    const delay = index * 0.09;
    if (exact) this.tone(520 * 1.19 ** index, 0.13, { type: 'square', vol: 0.17, delay });
    else this.tone(300 * 1.12 ** index, 0.1, { type: 'sine', vol: 0.12, delay });
  }

  /** Presque : (pegs − 1) bien placés. Un frisson montant. */
  nearMiss(): void {
    this.tone(700, 0.3, { type: 'triangle', vol: 0.14, endFreq: 1300 });
  }

  /** Battement de cœur des derniers essais. */
  heartbeat(): void {
    if (this.throttled('heartbeat', 700)) return;
    this.tone(58, 0.13, { type: 'sine', vol: 0.3, endFreq: 40 });
    this.tone(52, 0.11, { type: 'sine', vol: 0.22, endFreq: 36, delay: 0.17 });
  }

  victory(): void {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => this.tone(f, 0.32, { type: 'square', vol: 0.2, delay: i * 0.1 }));
    this.tone(1568, 0.7, { type: 'triangle', vol: 0.16, delay: 0.55 });
    this.noise(0.5, 0.16, 5200, 0.5);
  }

  defeat(): void {
    const notes = [392, 349, 294, 220];
    notes.forEach((f, i) => this.tone(f, 0.34, { type: 'sawtooth', vol: 0.17, delay: i * 0.14 }));
    this.noise(0.4, 0.14, 500, 0.4);
  }

  /** Miaulement : deux formants glissants, ça suffit à faire « chat ». */
  meow(): void {
    if (this.throttled('meow', 900)) return;
    this.tone(620, 0.18, { type: 'sawtooth', vol: 0.1, endFreq: 880 });
    this.tone(880, 0.22, { type: 'triangle', vol: 0.08, endFreq: 560, delay: 0.14 });
  }

  /** Coup de patte : un froissement + le tintement de la clochette. */
  paw(): void {
    this.noise(0.11, 0.24, 3200);
    this.tone(1760, 0.22, { type: 'triangle', vol: 0.12, endFreq: 2300 });
  }

  /** Annulation d'un méfait : un « rembobinage » descendant. */
  undo(): void {
    this.tone(880, 0.16, { type: 'triangle', vol: 0.15, endFreq: 440 });
  }
}
