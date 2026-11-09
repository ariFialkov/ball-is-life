/** Tiny procedural sound engine (no audio assets required). */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  private ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);
      } catch {
        this.enabled = false;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** Must be called from a user gesture at least once. */
  unlock() {
    this.ensure();
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    if (this.master) this.master.gain.value = v ? 0.6 : 0;
  }

  /** The crowd has no constant background bed (it read as cabin hum); it only reacts to plays. */
  crowd(_level: number) {}

  /**
   * A crowd reaction: a short swell of voices (several detuned band-passed
   * noise layers with a fast rise and a natural decay), only when something happens.
   */
  cheer(intensity = 1) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime;
    const dur = 1.1 + intensity * 0.9;
    const len = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.09 + 0.16 * intensity, now + 0.12);
    out.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    out.connect(this.master!);
    // Voices: a few formant-like bands, slightly detuned, so it reads as people rather than wind.
    for (const [f, q, g] of [
      [520, 3.5, 0.7],
      [1150, 4, 0.55],
      [2300, 5, 0.3],
    ]) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = 0.94 + Math.random() * 0.12;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * (0.95 + Math.random() * 0.1);
      bp.Q.value = q;
      const gn = ctx.createGain();
      gn.gain.value = g;
      src.connect(bp).connect(gn).connect(out);
      src.start(now);
      src.stop(now + dur);
    }
  }

  private noiseBurst(duration: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const len = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master!);
    src.start();
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', decay = true) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (decay) g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    o.connect(g).connect(this.master!);
    o.start();
    o.stop(ctx.currentTime + duration);
  }

  bounce(strength = 1) {
    this.tone(90, 0.12, 0.35 * strength);
    this.noiseBurst(0.06, 1200, 1, 0.08 * strength, 'lowpass');
  }

  swish() {
    this.noiseBurst(0.25, 2500, 0.8, 0.22, 'highpass');
  }

  rim() {
    this.tone(880, 0.35, 0.12, 'triangle');
    this.tone(1320, 0.25, 0.06, 'sine');
    this.noiseBurst(0.08, 3000, 2, 0.1);
  }

  backboard() {
    this.tone(220, 0.2, 0.15, 'square');
    this.noiseBurst(0.1, 500, 1, 0.1, 'lowpass');
  }

  buzzer() {
    this.tone(180, 0.9, 0.3, 'sawtooth', false);
    this.tone(183, 0.9, 0.3, 'square', false);
  }

  whistle() {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2800, ctx.currentTime);
    o.frequency.linearRampToValueAtTime(3100, ctx.currentTime + 0.1);
    o.frequency.linearRampToValueAtTime(2700, ctx.currentTime + 0.4);
    const g = ctx.createGain();
    g.gain.value = 0.12;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    o.connect(g).connect(this.master!);
    o.start();
    o.stop(ctx.currentTime + 0.45);
  }

  click() {
    this.tone(1400, 0.05, 0.08, 'square');
  }

  cash() {
    this.tone(880, 0.15, 0.15);
    setTimeout(() => this.tone(1174, 0.2, 0.15), 90);
    setTimeout(() => this.tone(1568, 0.35, 0.15), 180);
  }

  sneaker() {
    this.noiseBurst(0.07, 4000, 3, 0.05, 'highpass');
  }
}

export const audio = new AudioEngine();
