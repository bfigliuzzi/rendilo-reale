/**
 * Sons 100 % synthétisés en WebAudio — zéro asset, donc zéro octet à précacher
 * et un jeu qui sonne dès la première ouverture hors ligne (pattern des quatre
 * autres jeux du hub). Le contexte est créé PARESSEUSEMENT au premier geste :
 * les navigateurs refusent l'audio avant interaction.
 *
 * Le mute est testé tout en BAS de la pile (`tone` / `noise`), pour qu'aucune
 * voix n'ait à s'en soucier. La charte sonore est chaude comme la charte
 * visuelle : bois, cordes pincées, cloches — rien de métallique ni d'agressif.
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
    window.addEventListener('keydown', unlock); // un joueur au clavier a droit au son
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
      master.gain.value = 0.4;
      master.connect(ctx.destination);
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.noiseBuffer = buffer;
      return ctx;
    } catch {
      return null; // pas d'audio : le jeu reste parfaitement jouable
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

  /** Curseur : une pichenette de bois. */
  tap(): void {
    if (this.throttled('tap', 45)) return;
    this.tone(700, 0.05, { vol: 0.1 });
  }

  /** Coup porté. `heavy` pour une frappe large ou un boss. */
  hit(heavy = false): void {
    this.noise(heavy ? 0.15 : 0.08, heavy ? 0.3 : 0.2, heavy ? 900 : 1500);
    this.tone(heavy ? 150 : 260, heavy ? 0.16 : 0.1, { vol: 0.2, endFreq: heavy ? 70 : 130 });
  }

  /** Soin : une tierce montante, le seul son « frais » du jeu. */
  heal(): void {
    this.tone(520, 0.12, { type: 'sine', vol: 0.16 });
    this.tone(660, 0.16, { type: 'sine', vol: 0.14, delay: 0.07 });
  }

  /** Salve runique : un souffle grave qui monte. */
  volley(): void {
    this.tone(180, 0.28, { type: 'sawtooth', vol: 0.13, endFreq: 520 });
    this.noise(0.22, 0.14, 2600, 0.04);
  }

  death(): void {
    this.tone(300, 0.26, { vol: 0.18, endFreq: 90 });
    this.noise(0.18, 0.14, 700, 0.02);
  }

  /** Permutation : deux notes qui se croisent — on entend l'échange. */
  swap(): void {
    this.tone(420, 0.1, { type: 'sine', vol: 0.14, endFreq: 620 });
    this.tone(620, 0.1, { type: 'sine', vol: 0.12, endFreq: 420, delay: 0.03 });
  }

  defend(): void {
    this.tone(220, 0.14, { type: 'square', vol: 0.12, endFreq: 300 });
  }

  /** Porte franchie : un gond, puis un claquement sourd. */
  door(): void {
    this.noise(0.22, 0.16, 700);
    this.tone(120, 0.2, { vol: 0.18, endFreq: 60, delay: 0.1 });
  }

  gold(): void {
    for (let i = 0; i < 3; i++) this.tone(900 + i * 190, 0.07, { type: 'sine', vol: 0.11, delay: i * 0.045 });
  }

  /** Phase 2 du boss : une cloche grave, l'événement du combat. */
  phase(): void {
    this.tone(110, 0.6, { type: 'sine', vol: 0.24, endFreq: 82 });
    this.tone(165, 0.5, { type: 'triangle', vol: 0.14, delay: 0.05 });
  }

  victory(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.17, delay: i * 0.09 }));
  }

  defeat(): void {
    const notes = [392, 349, 294, 220];
    notes.forEach((f, i) => this.tone(f, 0.34, { type: 'sine', vol: 0.16, delay: i * 0.13 }));
  }
}
