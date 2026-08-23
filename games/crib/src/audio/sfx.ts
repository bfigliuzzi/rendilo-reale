/**
 * Effets sonores 100 % synthétisés en WebAudio — aucun asset, comme dans les trois
 * autres jeux. L'AudioContext est créé/réveillé au premier geste utilisateur
 * (politique autoplay des navigateurs) et les sons fréquents sont throttlés EN
 * INTERNE : jamais au point d'appel, sinon chaque nouveau appelant doit y repenser.
 *
 * Registre volontairement aigu et court (boîte à musique, jouets) : le jeu peut
 * avoir cinquante ennemis à l'écran, un son grave saturerait immédiatement.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private readonly lastPlay = new Map<string, number>();
  muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
    const wake = (): void => {
      this.ensure();
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
    // clavier autant que pointeur : ce jeu est entièrement jouable au clavier, le
    // son ne doit pas rester muet chez qui ne touche jamais l'écran
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
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
    opts: { type?: OscillatorType; vol?: number; endFreq?: number; delay?: number } = {},
  ): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'triangle';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, t0 + dur);
    gain.gain.setValueAtTime(opts.vol ?? 0.06, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, filterFreq: number, delay = 0): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuf) return;
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

  // ------------------------------------------------------------- vocabulaire

  /** Lancer de cube : très court et très discret, il part 3 à 6 fois par seconde. */
  throwToy(): void {
    if (this.throttled('toy', 70)) return;
    this.tone(760, 0.05, { vol: 0.03, endFreq: 520, type: 'square' });
  }

  enemyDie(): void {
    if (this.throttled('die', 45)) return;
    this.noise(0.1, 0.05, 1500);
    this.tone(300, 0.1, { endFreq: 130, vol: 0.045 });
  }

  /** Le berceau est mordu — le son le plus important du jeu quand il est hors champ. */
  cribHit(): void {
    if (this.throttled('crib', 220)) return;
    this.noise(0.14, 0.07, 700);
    this.tone(180, 0.16, { endFreq: 95, vol: 0.06, type: 'sawtooth' });
  }

  /** Immobilisation : deux notes qui s'enfoncent, une seule fois par clouage. */
  pinned(): void {
    if (this.throttled('pin', 400)) return;
    this.tone(420, 0.2, { endFreq: 150, vol: 0.08, type: 'sawtooth' });
    this.tone(300, 0.3, { endFreq: 100, vol: 0.06, delay: 0.08 });
  }

  peaFire(): void {
    if (this.throttled('peaf', 90)) return;
    this.tone(520, 0.06, { vol: 0.03, endFreq: 700, type: 'sine' });
  }

  peaHit(): void {
    if (this.throttled('peah', 120)) return;
    this.noise(0.07, 0.05, 2200);
  }

  pickup(): void {
    // arpège montant : la seule récompense purement positive du jeu
    [660, 880, 1180].forEach((f, i) => this.tone(f, 0.11, { vol: 0.06, delay: i * 0.05, type: 'triangle' }));
  }

  /** Arrivée d'une vague : un souffle sourd, pas une fanfare (il y en a vingt). */
  wave(): void {
    if (this.throttled('wave', 500)) return;
    this.noise(0.22, 0.035, 420);
  }

  bossHit(): void {
    if (this.throttled('bhit', 80)) return;
    this.tone(140, 0.07, { vol: 0.04, type: 'square' });
  }

  bossArrive(): void {
    this.tone(90, 1.1, { endFreq: 220, vol: 0.11, type: 'sawtooth' });
    this.noise(1.2, 0.07, 900);
  }

  bossRage(): void {
    this.tone(200, 0.7, { endFreq: 620, vol: 0.1, type: 'sawtooth' });
    this.noise(0.7, 0.06, 1600);
  }

  bossDie(): void {
    this.noise(0.9, 0.13, 800);
    this.tone(260, 0.9, { endFreq: 60, vol: 0.11, type: 'sawtooth' });
  }

  victory(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.32, { vol: 0.09, delay: i * 0.11 }));
  }

  defeat(): void {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.36, { vol: 0.08, delay: i * 0.14, type: 'sawtooth' }));
  }

  ui(): void {
    this.tone(620, 0.06, { vol: 0.05, type: 'square' });
  }
}
