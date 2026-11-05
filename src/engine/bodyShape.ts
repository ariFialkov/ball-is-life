/**
 * Shared body proportions. Everything is expressed in units of the player's
 * height (h = 1) in the model's rest pose: standing, arms hanging, facing +Z.
 * The geometry builder and the jersey painter both read from here so the
 * jersey artwork lines up with the mesh it is wrapped around.
 */

export const J = {
  hips: 0.535,
  spine: 0.555,
  chest: 0.695,
  neck: 0.84,
  head: 0.885,
  shoulderX: 0.122,
  shoulderY: 0.825,
  elbowY: 0.655,
  wristY: 0.495,
  hipX: 0.074,
  hipY: 0.495,
  kneeY: 0.27,
  ankleY: 0.055,
} as const;

/** Vertical span of the jersey shell (canvas top = JERSEY_TOP). */
export const JERSEY_TOP = 0.85;
export const JERSEY_BOT = 0.47;
/** Shorts layout: waist tube + two leg tubes, and where each sits in the texture. */
export const SHORTS = {
  waistTop: 0.58,
  waistBot: 0.43,
  legTop: 0.54,
  legBot: 0.31,
  /** v at which the waist region starts (waist occupies the top of the canvas). */
  vSplit: 0.74,
  /** legs occupy v in [0, legV]. */
  legV: 0.72,
} as const;
/** Superellipse exponent for the torso cross-section (2 = ellipse, higher = boxier). */
export const TORSO_N = 2.5;

export interface Ring {
  rx: number;
  rz: number;
  cz: number;
}

// y, rx, rz, cz
const TORSO_KEYS: [number, number, number, number][] = [
  [0.42, 0.082, 0.062, 0],
  [0.5, 0.078, 0.059, 0],
  [0.55, 0.075, 0.057, 0],
  [0.6, 0.079, 0.06, 0.002],
  [0.66, 0.086, 0.064, 0.004],
  [0.72, 0.093, 0.068, 0.006],
  [0.77, 0.097, 0.066, 0.004],
  [0.8, 0.097, 0.06, 0],
  [0.822, 0.082, 0.05, -0.004],
  [0.836, 0.053, 0.043, -0.004],
  [0.85, 0.036, 0.035, -0.002],
  [0.86, 0.03, 0.03, -0.002],
];

/** Smooth (Catmull-Rom / Hermite) interpolation through keyed samples. */
export function spline(keys: number[][], x: number, col: number): number {
  const n = keys.length;
  if (x <= keys[0][0]) return keys[0][col];
  if (x >= keys[n - 1][0]) return keys[n - 1][col];
  let k = 0;
  while (k < n - 2 && x > keys[k + 1][0]) k++;
  const x0 = keys[k][0];
  const x1 = keys[k + 1][0];
  const p0 = keys[k][col];
  const p1 = keys[k + 1][col];
  const tan = (i: number) => {
    const a = keys[Math.max(0, i - 1)];
    const b = keys[Math.min(n - 1, i + 1)];
    return (b[col] - a[col]) / (b[0] - a[0]);
  };
  const hh = x1 - x0;
  const t = (x - x0) / hh;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * hh * tan(k) + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * hh * tan(k + 1);
}

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Bulk multiplier by position: centres are thicker than guards. */
export function bulkFor(pos: string): number {
  return ({ PG: 0.94, SG: 0.97, SF: 1.0, PF: 1.04, C: 1.08 } as Record<string, number>)[pos] ?? 1;
}

export function torsoProfile(y: number, bulk: number): Ring {
  return {
    rx: spline(TORSO_KEYS, y, 1) * bulk,
    rz: spline(TORSO_KEYS, y, 2) * (1 + (bulk - 1) * 0.6),
    cz: spline(TORSO_KEYS, y, 3),
  };
}

/** The jersey hangs a little off the body, looser around the belly. */
export function jerseyProfile(y: number, bulk: number): Ring {
  const r = torsoProfile(y, bulk);
  const off = 0.004 + 0.008 * (1 - smoothstep(0.56, 0.7, y)) - 0.0015 * smoothstep(0.82, 0.85, y);
  return { rx: r.rx + off, rz: r.rz + off * 0.9, cz: r.cz };
}

/**
 * A point on a superellipse ring. theta = 0 is the -X side, PI/2 the front
 * (+Z), PI the +X side and 3PI/2 the back, so texture u runs left-to-right
 * when the front is seen from the front and the back from behind.
 */
export function ringXZ(theta: number, r: Ring, n: number): [number, number] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const e = 2 / n;
  return [-r.rx * Math.sign(c) * Math.pow(Math.abs(c), e), r.cz + r.rz * Math.sign(s) * Math.pow(Math.abs(s), e)];
}

export interface ArcTable {
  L: Float64Array;
  P: number;
  K: number;
}

/** Cumulative arc length around a ring so texture u can be spaced evenly. */
export function arcTable(r: Ring, n: number, K = 160): ArcTable {
  const L = new Float64Array(K + 1);
  let [px, pz] = ringXZ(0, r, n);
  for (let k = 1; k <= K; k++) {
    const [x, z] = ringXZ((k / K) * Math.PI * 2, r, n);
    L[k] = L[k - 1] + Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return { L, P: L[K], K };
}

export function thetaForU(u: number, tab: ArcTable): number {
  const target = (((u % 1) + 1) % 1) * tab.P;
  let lo = 0;
  let hi = tab.K;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tab.L[mid] < target) lo = mid;
    else hi = mid;
  }
  const seg = tab.L[hi] - tab.L[lo] || 1;
  const t = (target - tab.L[lo]) / seg;
  return ((lo + t) / tab.K) * Math.PI * 2;
}

/**
 * Signed distance (in h units, approximate) from a point on the jersey to its
 * nearest cut-out edge: negative inside the neckline / armholes.
 */
export function jerseyEdgeDistance(x: number, y: number, z: number, rz: number, bulk: number): number {
  const ax = Math.abs(x);
  // Armholes: an ellipse around the shoulder joint, opening straight up above it.
  const ex = (ax - J.shoulderX * bulk) / 0.052;
  const ey = (y - 0.805) / 0.06;
  let arm = (Math.sqrt(ex * ex + ey * ey) - 1) * 0.052;
  if (y > 0.805) arm = Math.min(arm, 0.064 * bulk - ax);
  // Neckline: a V at the front, a shallow scoop at the back.
  const nf = 0.04 * Math.pow(Math.min(1, Math.max(0, (y - 0.765) / 0.085)), 0.75);
  const nb = 0.044 * Math.pow(Math.min(1, Math.max(0, (y - 0.808) / 0.042)), 0.55);
  const front = smoothstep(-rz * 0.35, rz * 0.35, z);
  const nw = nb + (nf - nb) * front;
  const neck = nw > 0 ? ax - nw : 1;
  return Math.min(arm, neck);
}
