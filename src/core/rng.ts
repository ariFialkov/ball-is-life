// Deterministic PRNG utilities. Pure, dependency-free, erasable-TS only
// (so the same file can be executed by Node with --experimental-strip-types).

/** cyrb53: fast 53-bit string hash. Returns a pair of 32-bit words. */
export function hash32x2(str: string, seed = 0): [number, number] {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0];
}

export function hashHex(str: string): string {
  const [a, b] = hash32x2(str);
  const [c, d] = hash32x2(str, 0x9e3779b9);
  return [a, b, c, d].map((n) => n.toString(16).padStart(8, '0')).join('');
}

function splitmix32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/** xoshiro128** seeded from a string or number. */
export class Rng {
  private s: Uint32Array;

  constructor(seed: string | number) {
    const str = typeof seed === 'number' ? `n:${seed}` : seed;
    const [a, b] = hash32x2(str);
    const sm = splitmix32(a ^ b);
    this.s = new Uint32Array(4);
    for (let i = 0; i < 4; i++) this.s[i] = Math.floor(sm() * 4294967296) >>> 0;
    if (this.s.every((v) => v === 0)) this.s[0] = 1;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    const s = this.s;
    const result = (Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0);
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Standard normal via Box-Muller. */
  gauss(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Weighted index pick; weights need not sum to 1. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
