/**
 * Effets sonores 100 % synthétisés en WebAudio — aucun asset.
 * L'AudioContext est créé/réveillé au premier geste utilisateur (politique autoplay).
 * Les sons fréquents (tir, morts) sont throttlés en interne.
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

  shoot(): void {
    if (this.throttled('shoot', 95)) return;
    this.tone(1100, 0.045, { type: 'square', vol: 0.015, endFreq: 500 });
  }

  enemyDie(): void {
    if (this.throttled('die', 50)) return;
    this.noise(0.08, 0.05, 1400);
    this.tone(240, 0.07, { type: 'triangle', vol: 0.04, endFreq: 90 });
  }

  soldierLost(): void {
    if (this.throttled('lost', 90)) return;
    this.tone(190, 0.12, { type: 'triangle', vol: 0.06, endFreq: 120 });
  }

  gateGood(): void {
    this.tone(523, 0.09, { type: 'triangle', vol: 0.09 });
    this.tone(659, 0.09, { type: 'triangle', vol: 0.09, delay: 0.07 });
    this.tone(784, 0.14, { type: 'triangle', vol: 0.09, delay: 0.14 });
  }

  gateBad(): void {
    this.tone(330, 0.22, { type: 'sawtooth', vol: 0.07, endFreq: 150 });
  }

  crateHit(): void {
    if (this.throttled('crate', 110)) return;
    this.noise(0.05, 0.03, 700);
  }

  crateBreak(): void {
    this.noise(0.28, 0.12, 900);
    this.tone(160, 0.2, { type: 'triangle', vol: 0.07, endFreq: 60 });
  }

  bossHit(): void {
    if (this.throttled('bossHit', 130)) return;
    this.noise(0.06, 0.04, 500);
  }

  bossDie(): void {
    this.noise(0.5, 0.16, 800);
    this.tone(220, 0.5, { type: 'sawtooth', vol: 0.1, endFreq: 50 });
  }

  bossContact(): void {
    this.noise(0.3, 0.14, 400);
    this.tone(140, 0.3, { type: 'square', vol: 0.08, endFreq: 60 });
  }

  lanceFire(): void {
    if (this.throttled('lance', 150)) return;
    this.noise(0.12, 0.06, 2400);
    this.tone(700, 0.18, { type: 'sawtooth', vol: 0.05, endFreq: 220 });
  }

  lanceHit(): void {
    this.noise(0.15, 0.1, 900);
    this.tone(160, 0.18, { type: 'square', vol: 0.07, endFreq: 70 });
  }

  missileWarn(): void {
    if (this.throttled('warn', 200)) return;
    this.tone(1400, 1.0, { type: 'sine', vol: 0.05, endFreq: 250 }); // sifflement qui tombe
  }

  explosion(): void {
    if (this.throttled('boom', 90)) return;
    this.noise(0.4, 0.18, 600);
    this.tone(110, 0.4, { type: 'sawtooth', vol: 0.1, endFreq: 40 });
  }

  powerup(): void {
    const notes = [440, 660, 880];
    notes.forEach((f, i) => this.tone(f, 0.1, { type: 'square', vol: 0.06, delay: i * 0.05 }));
  }

  firework(): void {
    if (this.throttled('fw', 120)) return;
    this.noise(0.25, 0.09, 1600);
    this.tone(900 + Math.random() * 600, 0.2, { type: 'triangle', vol: 0.05, endFreq: 200 });
  }

  victory(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.1, delay: i * 0.13 }));
  }

  defeat(): void {
    this.tone(330, 0.3, { type: 'triangle', vol: 0.1 });
    this.tone(247, 0.5, { type: 'triangle', vol: 0.1, delay: 0.25 });
  }

  buy(): void {
    this.tone(880, 0.07, { type: 'triangle', vol: 0.08 });
    this.tone(1319, 0.1, { type: 'triangle', vol: 0.08, delay: 0.06 });
  }
}
