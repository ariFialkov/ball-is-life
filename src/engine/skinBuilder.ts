import * as THREE from 'three';

/** Up to four [boneIndex, weight] pairs; normalised on emit. */
export type Influence = [number, number][];

export interface GridOpts {
  rows: number;
  cols: number;
  /** Ring i (0..rows), column j (0..cols-1 when closed, 0..cols when open). */
  point: (i: number, j: number, out: THREE.Vector3) => void;
  weights: (p: THREE.Vector3, i: number, j: number) => Influence;
  color?: (p: THREE.Vector3, i: number, j: number) => THREE.Color;
  uv?: (i: number, j: number) => [number, number];
  /** Closed around j (a tube). Default true. */
  closed?: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);

/**
 * Accumulates parametric surfaces into one skinned BufferGeometry. Normals are
 * computed from the parametric grid (with wrap-around) so tubes have no
 * visible seam, and every vertex carries smooth bone weights so joints bend
 * like a skinned character instead of rigid primitives.
 */
export class SkinBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uvs: number[] = [];
  private col: number[] = [];
  private si: number[] = [];
  private sw: number[] = [];
  private idx: number[] = [];

  get vertexCount() {
    return this.pos.length / 3;
  }

  grid(o: GridOpts) {
    const closed = o.closed ?? true;
    const R = o.rows + 1;
    const C = closed ? o.cols : o.cols + 1;
    const P: THREE.Vector3[] = new Array(R * C);
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < C; j++) {
        const v = new THREE.Vector3();
        o.point(i, j, v);
        P[i * C + j] = v;
      }
    }
    const at = (i: number, j: number) => {
      const jj = closed ? ((j % C) + C) % C : Math.min(C - 1, Math.max(0, j));
      return P[Math.min(R - 1, Math.max(0, i)) * C + jj];
    };
    const cen: THREE.Vector3[] = [];
    for (let i = 0; i < R; i++) {
      const c = new THREE.Vector3();
      for (let j = 0; j < C; j++) c.add(P[i * C + j]);
      cen.push(c.multiplyScalar(1 / C));
    }
    const rawNormal = (i: number, j: number, out: THREE.Vector3) => {
      _a.subVectors(at(i, j + 1), at(i, j - 1));
      _b.subVectors(at(i + 1, j), at(i - 1, j));
      out.crossVectors(_a, _b);
      return out.lengthSq();
    };
    // Decide outward orientation once from a well-conditioned mid ring.
    const mid = R >> 1;
    rawNormal(mid, 0, _n);
    _c.subVectors(at(mid, 0), cen[mid]);
    const sign = _n.dot(_c) < 0 ? -1 : 1;
    const N: THREE.Vector3[] = new Array(R * C);
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < C; j++) {
        const n = new THREE.Vector3();
        if (rawNormal(i, j, n) < 1e-14) {
          // Degenerate (a pole): point along the shape's axis.
          const other = i === 0 ? cen[Math.min(R - 1, 1)] : cen[i - 1];
          n.subVectors(cen[i], other);
          if (n.lengthSq() < 1e-14) n.set(0, 1, 0);
          n.normalize();
        } else {
          n.normalize().multiplyScalar(sign);
        }
        N[i * C + j] = n;
      }
    }
    // Emit vertices (closed grids duplicate the seam column for UVs).
    const base = this.vertexCount;
    const E = closed ? C + 1 : C;
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < E; j++) {
        const jj = j % C;
        const p = P[i * C + jj];
        const n = N[i * C + jj];
        this.pos.push(p.x, p.y, p.z);
        this.nor.push(n.x, n.y, n.z);
        const uv = o.uv ? o.uv(i, j) : [j / (E - 1), 1 - i / o.rows];
        this.uvs.push(uv[0], uv[1]);
        const c = o.color ? o.color(p, i, jj) : WHITE;
        this.col.push(c.r, c.g, c.b);
        this.pushWeights(o.weights(p, i, jj));
      }
    }
    // Winding: make the first non-degenerate cell face outward.
    let flip = false;
    for (let i = 0; i < o.rows; i++) {
      const a = P[i * C];
      const b = P[(i + 1) * C];
      const c = at(i, 1);
      _a.subVectors(b, a);
      _b.subVectors(c, a);
      _n.crossVectors(_a, _b);
      if (_n.lengthSq() < 1e-16) continue;
      flip = _n.dot(N[i * C]) < 0;
      break;
    }
    for (let i = 0; i < o.rows; i++) {
      for (let j = 0; j < E - 1; j++) {
        const a = base + i * E + j;
        const b = a + E;
        const c = a + 1;
        const d = b + 1;
        if (flip) this.idx.push(a, c, b, c, d, b);
        else this.idx.push(a, b, c, c, b, d);
      }
    }
  }

  private pushWeights(inf: Influence) {
    const sorted = inf.filter((w) => w[1] > 1e-4).sort((x, y) => y[1] - x[1]).slice(0, 4);
    const total = sorted.reduce((s, w) => s + w[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      const w = sorted[k];
      this.si.push(w ? w[0] : 0);
      this.sw.push(w ? w[1] / total : 0);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** A ring in a vertical tube. */
export interface TubeRing {
  y: number;
  rx: number;
  rz: number;
  cx: number;
  cz: number;
}

/**
 * Rings for a vertical capsule-like limb: a hemispherical-ish cap on top, the
 * profiled body, and a cap on the bottom. `prof(s)` gives the shape for
 * s in 0..1 from top to bottom.
 */
export function capsuleRings(yTop: number, yBot: number, prof: (s: number) => Omit<TubeRing, 'y'>, rows: number, caps: { top: number; bot: number; rows: number }): TubeRing[] {
  const out: TubeRing[] = [];
  const top = prof(0);
  const bot = prof(1);
  if (caps.top > 0) {
    for (let k = 0; k < caps.rows; k++) {
      const phi = (k / caps.rows) * (Math.PI / 2);
      const sc = Math.sin(phi);
      out.push({ y: yTop + caps.top * Math.cos(phi), rx: top.rx * sc, rz: top.rz * sc, cx: top.cx, cz: top.cz });
    }
  }
  for (let k = 0; k <= rows; k++) {
    const s = k / rows;
    out.push({ y: yTop + (yBot - yTop) * s, ...prof(s) });
  }
  if (caps.bot > 0) {
    for (let k = 1; k <= caps.rows; k++) {
      const phi = (k / caps.rows) * (Math.PI / 2);
      const sc = Math.cos(phi);
      out.push({ y: yBot - caps.bot * Math.sin(phi), rx: bot.rx * sc, rz: bot.rz * sc, cx: bot.cx, cz: bot.cz });
    }
  }
  return out;
}

/** Piecewise-linear lookup over [s, value] pairs, smoothed with smoothstep. */
export function keyed(keys: [number, number][], s: number): number {
  if (s <= keys[0][0]) return keys[0][1];
  for (let k = 0; k < keys.length - 1; k++) {
    const [s0, v0] = keys[k];
    const [s1, v1] = keys[k + 1];
    if (s <= s1) {
      const t = (s - s0) / (s1 - s0);
      return v0 + (v1 - v0) * t * t * (3 - 2 * t);
    }
  }
  return keys[keys.length - 1][1];
}
