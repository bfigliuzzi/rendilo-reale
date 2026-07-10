/**
 * Effets sonores 100 % synthétisés en WebAudio — aucun asset (pattern horde).
 * L'AudioContext est créé/réveillé au premier geste utilisateur (politique autoplay).
 * Les sons fréquents (annihilations, envois) sont throttlés en interne.
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
    };
    window.addEventListener('pointerdown', wake);
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
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(opts.endFreq, t0 + dur);
    gain.gain.setValueAtTime(opts.vol ?? 0.08, t0);
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
    src.stop(t0 + dur + 0.02);
  }

  /** Tap de sélection d'une ruche : clic doux montant. */
  select(): void {
    if (this.throttled('select', 60)) return;
    this.tone(660, 0.05, { type: 'triangle', vol: 0.05, endFreq: 880 });
  }

  /** Désélection : même clic, descendant. */
  deselect(): void {
    if (this.throttled('select', 60)) return;
    this.tone(880, 0.05, { type: 'triangle', vol: 0.04, endFreq: 620 });
  }

  /** Départ d'un essaim : bourdonnement bref qui s'éloigne. */
  send(): void {
    if (this.throttled('send', 120)) return;
    this.noise(0.1, 0.03, 2600);
    this.tone(220, 0.22, { type: 'sawtooth', vol: 0.045, endFreq: 140 });
  }

  /** Annihilation 1:1 en vol : tic discret (TRÈS fréquent → throttle serré). */
  annihilate(): void {
    if (this.throttled('annihilate', 70)) return;
    this.noise(0.04, 0.035, 1800);
  }

  /** Capture d'un nid : fanfare courte si c'est nous, chute grave si perdu. */
  capture(mine: boolean): void {
    if (mine) {
      this.tone(523, 0.09, { type: 'triangle', vol: 0.09 });
      this.tone(784, 0.14, { type: 'triangle', vol: 0.09, delay: 0.08 });
    } else {
      this.tone(300, 0.24, { type: 'sawtooth', vol: 0.07, endFreq: 130 });
    }
  }

  /** Montée de niveau d'un nid : arpège de récompense. */
  upgrade(): void {
    const notes = [440, 660, 880];
    notes.forEach((f, i) => this.tone(f, 0.1, { type: 'square', vol: 0.06, delay: i * 0.05 }));
  }

  victory(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.1, delay: i * 0.13 }));
  }

  defeat(): void {
    this.tone(330, 0.3, { type: 'triangle', vol: 0.1 });
    this.tone(247, 0.5, { type: 'triangle', vol: 0.1, delay: 0.25 });
  }
}
