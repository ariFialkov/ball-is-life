import * as THREE from 'three';
import type { Kit, PlayerDef, TeamDef } from '../data/teams.ts';
import { isLight } from '../data/teams.ts';
import { SkinBuilder, capsuleRings, keyed, type Influence, type TubeRing } from './skinBuilder.ts';
import { J, JERSEY_BOT, JERSEY_TOP, SHORTS, TORSO_N, arcTable, bulkFor, jerseyProfile, ringXZ, smoothstep, thetaForU, torsoProfile, type Ring } from './bodyShape.ts';
import { paintJersey, paintShorts } from './jersey.ts';

export const SKELETON_BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'lShoulder',
  'lElbow',
  'lWrist',
  'rShoulder',
  'rElbow',
  'rWrist',
  'lHip',
  'lKnee',
  'lAnkle',
  'rHip',
  'rKnee',
  'rAnkle',
] as const;
export type SkeletonBone = (typeof SKELETON_BONES)[number];

const BI = Object.fromEntries(SKELETON_BONES.map((b, i) => [b, i])) as Record<SkeletonBone, number>;

const PARENT: Record<SkeletonBone, SkeletonBone | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  lShoulder: 'chest',
  lElbow: 'lShoulder',
  lWrist: 'lElbow',
  rShoulder: 'chest',
  rElbow: 'rShoulder',
  rWrist: 'rElbow',
  lHip: 'hips',
  lKnee: 'lHip',
  lAnkle: 'lKnee',
  rHip: 'hips',
  rKnee: 'rHip',
  rAnkle: 'rKnee',
};

const SKIN_TONES = ['#f1c9a5', '#d9a071', '#b67a4f', '#8a5a3a', '#5b3a26'];
const HAIR = ['#111111', '#2a1a0a', '#4a2f1a', '#151515'];

export interface BuiltBody {
  bones: Record<SkeletonBone, THREE.Bone>;
  skeleton: THREE.Skeleton;
  meshes: THREE.SkinnedMesh[];
  textures: THREE.Texture[];
  materials: THREE.Material[];
  /** Repaint kit textures (e.g. once the web font has loaded). */
  repaint: () => void;
}

function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

const col = (hex: string) => new THREE.Color(hex);

/** 0 = moves with the pelvis, 1 = moves with the thigh (shared by thighs and shorts legs). */
const shortsLegBlend = (y: number) => smoothstep(0.47, 0.36, y);

/**
 * Build a fully skinned player: a 17-bone skeleton (hips, two-piece spine,
 * neck, head, shoulders, elbows, wrists, hips, knees, ankles) driving three
 * skinned meshes: the body (vertex coloured: skin, hair, face, socks, shoes),
 * the jersey (painted canvas with cut-out neckline/armholes) and the shorts.
 * All geometry is generated in height-normalised units and scaled by `h`.
 */
export function buildBody(def: PlayerDef, kit: Kit, team: TeamDef, lowDetail: boolean): BuiltBody {
  const h = def.height;
  const bulk = bulkFor(def.pos);
  const limbBulk = 1 + (bulk - 1) * 1.2;
  const hipBulk = 1 + (bulk - 1) * 0.5;
  const traits = hash(def.id);
  const D = lowDetail
    ? { torsoRows: 16, torsoCols: 20, jerseyRows: 18, jerseyCols: 24, limbRows: 6, limbCols: 9, capRows: 2, headRows: 10, headCols: 14, small: 5 }
    : { torsoRows: 26, torsoCols: 32, jerseyRows: 32, jerseyCols: 44, limbRows: 10, limbCols: 14, capRows: 3, headRows: 18, headCols: 24, small: 7 };

  // ---------------------------------------------------------------- skeleton
  const sx = J.shoulderX * bulk;
  const hx = J.hipX * hipBulk;
  const rest: Record<SkeletonBone, [number, number, number]> = {
    hips: [0, J.hips, 0],
    spine: [0, J.spine, 0],
    chest: [0, J.chest, 0],
    neck: [0, J.neck, -0.004],
    head: [0, J.head, -0.002],
    lShoulder: [-sx, J.shoulderY, 0],
    lElbow: [-sx, J.elbowY, 0],
    lWrist: [-sx, J.wristY, 0],
    rShoulder: [sx, J.shoulderY, 0],
    rElbow: [sx, J.elbowY, 0],
    rWrist: [sx, J.wristY, 0],
    lHip: [-hx, J.hipY, 0],
    lKnee: [-hx, J.kneeY, 0],
    lAnkle: [-hx, J.ankleY, 0],
    rHip: [hx, J.hipY, 0],
    rKnee: [hx, J.kneeY, 0],
    rAnkle: [hx, J.ankleY, 0],
  };
  const bones = {} as Record<SkeletonBone, THREE.Bone>;
  for (const name of SKELETON_BONES) {
    const b = new THREE.Bone();
    b.name = name;
    const p = PARENT[name];
    const r = rest[name];
    const pr = p ? rest[p] : [0, 0, 0];
    b.position.set((r[0] - pr[0]) * h, (r[1] - pr[1]) * h, (r[2] - pr[2]) * h);
    if (p) bones[p].add(b);
    bones[name] = b;
  }

  // ---------------------------------------------------------------- colours
  const skin = col(SKIN_TONES[def.skin % SKIN_TONES.length]);
  const skinShade = skin.clone().multiplyScalar(0.78);
  const hairC = col(HAIR[def.hair % HAIR.length]);
  const lip = skin.clone().lerp(col('#5a2a24'), 0.35);
  const eyeWhite = col('#ece6dc');
  const iris = col('#20140e');
  const sockC = col('#f3f3f3');
  const trim = col(kit.trim);
  const sole = col(isLight(kit.trim) ? '#1b1b1d' : '#f1f1f1');
  const shoeAccent = col(kit.jersey === kit.trim ? team.colors.accent : kit.jersey);
  const collar = trim.clone().multiplyScalar(0.55);
  const gearC = col((traits >> 4) % 2 ? '#141416' : kit.trim);
  const sleeveSide = (traits >> 7) % 5 === 0 ? 1 : 0; // shooting sleeve on the right arm
  const wristbands = (traits >> 9) % 3 === 0;
  const kneeSleeve = (traits >> 11) % 6 === 0 ? ((traits >> 13) % 2 ? 1 : -1) : 0;
  const beard = (traits >> 15) % 3 === 0;

  // ---------------------------------------------------------------- helpers
  const W = (...pairs: [SkeletonBone, number][]): Influence => pairs.map(([b, w]) => [BI[b], w]);
  const ellipsoid = (
    b: SkinBuilder,
    c: [number, number, number],
    r: [number, number, number],
    weights: (p: THREE.Vector3) => Influence,
    color: THREE.Color | ((p: THREE.Vector3) => THREE.Color),
    opts: { rows?: number; cols?: number; deform?: (l: THREE.Vector3, phi: number, theta: number) => void } = {},
  ) => {
    const rows = opts.rows ?? D.small;
    const cols = opts.cols ?? D.small + 3;
    b.grid({
      rows,
      cols,
      point: (i, j, out) => {
        const phi = (i / rows) * Math.PI;
        const th = (j / cols) * Math.PI * 2;
        out.set(r[0] * Math.sin(phi) * Math.cos(th), r[1] * Math.cos(phi), r[2] * Math.sin(phi) * Math.sin(th));
        opts.deform?.(out, phi, th);
        out.x += c[0];
        out.y += c[1];
        out.z += c[2];
      },
      weights,
      color: typeof color === 'function' ? color : () => color,
    });
  };
  const tube = (b: SkinBuilder, rings: TubeRing[], cols: number, weights: (p: THREE.Vector3) => Influence, color: (p: THREE.Vector3) => THREE.Color, n = 2) => {
    const ring: Ring = { rx: 0, rz: 0, cz: 0 };
    b.grid({
      rows: rings.length - 1,
      cols,
      point: (i, j, out) => {
        const R = rings[i];
        ring.rx = R.rx;
        ring.rz = R.rz;
        ring.cz = R.cz;
        const [x, z] = ringXZ((j / cols) * Math.PI * 2, ring, n);
        out.set(R.cx + x, R.y, z);
      },
      weights,
      color,
    });
  };

  // Spine-chain weights shared by the torso skin and the jersey.
  const torsoWeights = (p: THREE.Vector3): Influence => {
    const y = p.y;
    const t1 = smoothstep(0.53, 0.6, y);
    const t2 = smoothstep(0.64, 0.75, y);
    const t3 = smoothstep(0.835, 0.852, y);
    const sh = smoothstep(0.06 * bulk, 0.1 * bulk, Math.abs(p.x)) * smoothstep(0.73, 0.8, y) * 0.45;
    const k = 1 - sh;
    return [
      [BI.hips, (1 - t1) * k],
      [BI.spine, t1 * (1 - t2) * k],
      [BI.chest, t2 * (1 - t3) * k],
      [BI.neck, t3 * k],
      [p.x > 0 ? BI.rShoulder : BI.lShoulder, sh],
    ];
  };

  // ================================================================= BODY
  const body = new SkinBuilder();

  // Torso (skin under the jersey; shows at the neckline and armholes).
  {
    const ys: { y: number; scale: number }[] = [];
    // Ends inside the shorts' waist so it never shows between the legs.
    for (let i = 0; i <= D.torsoRows; i++) ys.push({ y: 0.86 - (i / D.torsoRows) * (0.86 - 0.49), scale: 1 });
    ys.unshift({ y: 0.865, scale: 0.55 }, { y: 0.866, scale: 0.0 });
    ys.sort((a, b) => b.y - a.y);
    const thetas = ys.map(({ y }) => {
      const tab = arcTable(torsoProfile(y, bulk), TORSO_N, 96);
      return Array.from({ length: D.torsoCols }, (_, j) => thetaForU(j / D.torsoCols, tab));
    });
    body.grid({
      rows: ys.length - 1,
      cols: D.torsoCols,
      point: (i, j, out) => {
        const r = torsoProfile(ys[i].y, bulk);
        r.rx *= ys[i].scale;
        r.rz *= ys[i].scale;
        const [x, z] = ringXZ(thetas[i][j], r, TORSO_N);
        out.set(x, ys[i].y, z);
      },
      weights: torsoWeights,
      color: () => skin,
    });
  }

  // Neck.
  tube(
    body,
    [0.83, 0.85, 0.875, 0.905].map((y, k) => {
      const r = [0.04, 0.035, 0.033, 0.031][k];
      return { y, rx: r, rz: r * 0.98, cx: 0, cz: -0.006 };
    }),
    D.limbCols,
    (p) => {
      const a = smoothstep(0.835, 0.858, p.y);
      const b = smoothstep(0.882, 0.905, p.y);
      return W(['chest', 1 - a], ['neck', a * (1 - b)], ['head', b]);
    },
    () => skin,
  );

  // Head with jaw, cheeks and a rounder skull.
  const HC: [number, number, number] = [0, 0.94, 0.004];
  const HR: [number, number, number] = [0.054, 0.066, 0.06];
  const xf = (yr: number) => (yr < 0 ? 1 - 0.28 * Math.pow(-yr, 1.4) : 1);
  const zf = (yr: number, front: boolean) => (yr < 0 ? (front ? 1 - 0.06 * -yr : 1 - 0.32 * -yr) : front ? 1 : 1.04);
  const headDeform = (l: THREE.Vector3) => {
    const yr = l.y / HR[1];
    l.x *= xf(yr);
    l.z *= zf(yr, l.z > 0);
  };
  /** Front surface z (relative to head centre) at a given x, y. */
  const faceZ = (x: number, y: number) => {
    const yr = y / HR[1];
    const x0 = x / xf(yr);
    const q = 1 - (x0 / HR[0]) ** 2 - yr * yr;
    return HR[2] * Math.sqrt(Math.max(0, q)) * zf(yr, true);
  };
  const headW = (p: THREE.Vector3) => {
    const t = smoothstep(0.905, 0.88, p.y) * 0.4;
    return W(['head', 1 - t], ['neck', t]);
  };
  ellipsoid(body, HC, HR, headW, skin, { rows: D.headRows, cols: D.headCols, deform: headDeform });
  // Ears.
  for (const s of [-1, 1]) ellipsoid(body, [s * HR[0] * 0.98, HC[1] - 0.002, HC[2] - 0.006], [0.008, 0.016, 0.011], headW, skinShade);
  // Nose, lips, eyes, brows.
  const fz = (x: number, yRel: number) => HC[2] + faceZ(x, yRel);
  ellipsoid(body, [0, HC[1] - 0.01, fz(0, -0.01) + 0.004], [0.009, 0.015, 0.011], headW, skin);
  ellipsoid(body, [0, HC[1] - 0.036, fz(0, -0.036) - 0.002], [0.015, 0.0045, 0.006], headW, lip);
  for (const s of [-1, 1]) {
    const ex = s * 0.02;
    ellipsoid(body, [ex, HC[1] + 0.01, fz(ex, 0.01) - 0.004], [0.011, 0.0065, 0.006], headW, eyeWhite);
    ellipsoid(body, [ex, HC[1] + 0.01, fz(ex, 0.01) - 0.002], [0.0055, 0.0055, 0.005], headW, iris);
    ellipsoid(body, [s * 0.021, HC[1] + 0.024, fz(s * 0.021, 0.024) - 0.001], [0.015, 0.0035, 0.006], headW, hairC, {
      // Outer ends of the brows sit slightly lower: a focused look.
      deform: (l) => {
        l.y -= l.x * s * 0.12;
      },
    });
  }
  // Hair.
  const style = def.hair % 4;
  if (style !== 3) {
    const tall = style === 1;
    const sc = tall ? 1.05 : 1.035;
    const phiMax = (th: number) => {
      const s = Math.sin(th);
      return s > 0 ? Math.PI * (0.5 - 0.15 * s) : Math.PI * (0.5 + 0.14 * -s);
    };
    const rows = Math.max(6, D.headRows - 4);
    body.grid({
      rows,
      cols: D.headCols,
      point: (i, j, out) => {
        const th = (j / D.headCols) * Math.PI * 2;
        const phi = (phiMax(th) * i) / rows;
        out.set(HR[0] * Math.sin(phi) * Math.cos(th), HR[1] * Math.cos(phi), HR[2] * Math.sin(phi) * Math.sin(th));
        headDeform(out);
        out.multiplyScalar(sc);
        // High-top: lift the crown almost uniformly for a flat, boxy top.
        if (tall) out.y += Math.pow(Math.max(0, Math.cos(phi)), 0.5) * 0.026;
        out.x += HC[0];
        out.y += HC[1];
        out.z += HC[2];
      },
      weights: () => W(['head', 1]),
      color: () => hairC,
    });
  }
  if (style === 2) {
    // Headband in team trim.
    const rings: TubeRing[] = [0.034, 0.026, 0.017].map((yr) => {
      const k = Math.sqrt(1 - (yr / HR[1]) ** 2) * 1.07;
      return { y: HC[1] + yr, rx: HR[0] * k, rz: HR[2] * k, cx: 0, cz: HC[2] };
    });
    tube(body, rings, D.headCols, () => W(['head', 1]), () => trim);
  }
  if (beard) {
    const rows = 5;
    const cols = Math.max(8, D.headCols >> 1);
    body.grid({
      rows,
      cols,
      closed: false,
      point: (i, j, out) => {
        const th = Math.PI * (0.06 + (0.88 * j) / cols);
        const phi = Math.PI * (0.6 + (0.37 * i) / rows);
        out.set(HR[0] * Math.sin(phi) * Math.cos(th), HR[1] * Math.cos(phi), HR[2] * Math.sin(phi) * Math.sin(th));
        headDeform(out);
        out.multiplyScalar(1.025);
        out.x += HC[0];
        out.y += HC[1];
        out.z += HC[2];
      },
      weights: () => W(['head', 1]),
      color: () => hairC,
    });
  }

  // Arms.
  for (const s of [-1, 1] as const) {
    const side = s > 0 ? 'r' : 'l';
    const SH = `${side}Shoulder` as SkeletonBone;
    const EL = `${side}Elbow` as SkeletonBone;
    const WR = `${side}Wrist` as SkeletonBone;
    const jx = s * sx;
    const sleeve = sleeveSide === 1 && s > 0;
    const armColor = (p: THREE.Vector3) => {
      if (sleeve && p.y < J.shoulderY - 0.05 && p.y > J.wristY + 0.012) return gearC;
      if (wristbands && p.y < J.wristY + 0.03 && p.y > J.wristY + 0.006) return trim;
      return skin;
    };
    // Deltoid cap.
    ellipsoid(
      body,
      [jx - s * 0.002, J.shoulderY - 0.014, 0],
      [0.034 * limbBulk, 0.04, 0.037 * limbBulk],
      (p) => {
        const t = smoothstep(0.8, 0.845, p.y) * 0.3;
        return W([SH, 1 - t], ['chest', t]);
      },
      skin,
      { rows: D.small + 1, cols: D.limbCols },
    );
    // Upper arm.
    tube(
      body,
      capsuleRings(
        J.shoulderY - 0.005,
        J.elbowY,
        (u) => ({
          rx: keyed([[0, 0.036], [0.35, 0.035], [0.8, 0.029], [1, 0.027]], u) * limbBulk,
          rz: keyed([[0, 0.038], [0.35, 0.039], [0.8, 0.03], [1, 0.028]], u) * limbBulk,
          cx: jx,
          cz: keyed([[0, 0], [0.35, 0.004], [1, -0.002]], u),
        }),
        D.limbRows,
        { top: 0.02, bot: 0.016, rows: D.capRows },
      ),
      D.limbCols,
      (p) => {
        const e = smoothstep(J.elbowY + 0.03, J.elbowY - 0.015, p.y);
        return W([SH, 1 - e], [EL, e]);
      },
      armColor,
    );
    // Forearm.
    tube(
      body,
      capsuleRings(
        J.elbowY + 0.012,
        J.wristY + 0.004,
        (u) => ({
          rx: keyed([[0, 0.028], [0.25, 0.03], [1, 0.019]], u) * limbBulk,
          rz: keyed([[0, 0.029], [0.25, 0.032], [1, 0.022]], u) * limbBulk,
          cx: jx,
          cz: keyed([[0, -0.002], [0.25, 0.003], [1, 0]], u),
        }),
        D.limbRows + 2,
        { top: 0.014, bot: 0.01, rows: D.capRows },
      ),
      D.limbCols,
      (p) => {
        const sh = smoothstep(J.elbowY - 0.025, J.elbowY + 0.02, p.y) * 0.5;
        const w = smoothstep(J.wristY + 0.03, J.wristY, p.y);
        return W([SH, sh], [EL, (1 - sh) * (1 - w)], [WR, w * (1 - sh)]);
      },
      armColor,
    );
    // Hand: palm, fingers and thumb, palms facing the thighs.
    const hw = () => W([WR, 1]);
    ellipsoid(body, [jx + s * 0.002, J.wristY - 0.032, 0.002], [0.0125, 0.036, 0.026], hw, skin);
    ellipsoid(body, [jx + s * 0.001, J.wristY - 0.07, 0.005], [0.011, 0.03, 0.022], hw, skin);
    ellipsoid(body, [jx - s * 0.006, J.wristY - 0.03, 0.024], [0.009, 0.021, 0.009], hw, skin);
  }

  // Legs.
  const shinRing = (y: number, cx: number): TubeRing => {
    const top = J.kneeY + 0.02;
    const bot = J.ankleY + 0.002;
    const u = Math.min(1, Math.max(0, (top - y) / (top - bot)));
    return {
      y,
      rx: keyed([[0, 0.036], [0.25, 0.037], [0.55, 0.03], [0.85, 0.022], [1, 0.021]], u) * limbBulk,
      rz: keyed([[0, 0.037], [0.25, 0.043], [0.55, 0.034], [0.85, 0.024], [1, 0.023]], u) * limbBulk,
      cx,
      cz: keyed([[0, 0.002], [0.25, -0.008], [0.55, -0.006], [1, -0.003]], u),
    };
  };
  for (const s of [-1, 1] as const) {
    const side = s > 0 ? 'r' : 'l';
    const HP = `${side}Hip` as SkeletonBone;
    const KN = `${side}Knee` as SkeletonBone;
    const AN = `${side}Ankle` as SkeletonBone;
    const lx = s * hx;
    const legColor = (p: THREE.Vector3) => (kneeSleeve === s && p.y > J.kneeY - 0.06 && p.y < J.kneeY + 0.05 ? gearC : skin);
    // Thigh.
    tube(
      body,
      capsuleRings(
        J.hipY + 0.01,
        J.kneeY,
        (u) => ({
          rx: keyed([[0, 0.044], [0.35, 0.05], [1, 0.037]], u) * limbBulk,
          rz: keyed([[0, 0.05], [0.35, 0.054], [1, 0.039]], u) * limbBulk,
          cx: lx - s * keyed([[0, 0.008], [0.4, 0.002], [1, 0]], u),
          cz: keyed([[0, 0], [0.5, 0.005], [1, 0]], u),
        }),
        D.limbRows,
        { top: 0.02, bot: 0.02, rows: D.capRows },
      ),
      D.limbCols,
      (p) => {
        // Same pelvis-to-leg blend as the shorts' leg tubes, so the thigh
        // deforms with the cloth around it and never pokes through.
        const hp = 1 - shortsLegBlend(p.y);
        const kn = smoothstep(J.kneeY + 0.03, J.kneeY - 0.02, p.y);
        return W(['hips', hp], [HP, (1 - hp) * (1 - kn)], [KN, kn]);
      },
      legColor,
    );
    // Shin with calf.
    const shinW = (p: THREE.Vector3) => {
      const hp = smoothstep(J.kneeY - 0.025, J.kneeY + 0.02, p.y) * 0.5;
      const an = smoothstep(J.ankleY + 0.03, J.ankleY, p.y);
      return W([HP, hp], [KN, (1 - hp) * (1 - an)], [AN, an * (1 - hp)]);
    };
    {
      const rows: TubeRing[] = [];
      const top = J.kneeY + 0.02;
      const bot = J.ankleY + 0.002;
      const n = D.limbRows + 2;
      const r0 = shinRing(top, lx);
      for (let k = 0; k < D.capRows; k++) {
        const phi = (k / D.capRows) * (Math.PI / 2);
        rows.push({ ...r0, y: top + 0.02 * Math.cos(phi), rx: r0.rx * Math.sin(phi), rz: r0.rz * Math.sin(phi) });
      }
      for (let k = 0; k <= n; k++) rows.push(shinRing(top + (bot - top) * (k / n), lx));
      tube(body, rows, D.limbCols, shinW, legColor);
    }
    // Crew socks with two trim stripes.
    {
      const rows: TubeRing[] = [];
      const n = Math.max(6, D.limbRows);
      for (let k = 0; k <= n; k++) {
        const y = 0.15 - (k / n) * (0.15 - 0.05);
        const r = shinRing(y, lx);
        rows.push({ ...r, rx: r.rx + 0.004, rz: r.rz + 0.004 });
      }
      tube(body, rows, D.limbCols, shinW, (p) => ((p.y > 0.128 && p.y < 0.136) || (p.y > 0.14 && p.y < 0.146) ? trim : sockC));
    }
    // Shoe: high-top with collar, side stripe and contrasting sole.
    {
      const zs: number[] = [];
      const ZH = -0.045;
      const ZT = 0.11;
      const n = D.limbRows + 2;
      for (let k = 0; k <= n; k++) zs.push(ZH + ((ZT - ZH) * k) / n);
      const wAt = (z: number) => keyed([[-0.045, 0.027], [-0.02, 0.031], [0.03, 0.035], [0.07, 0.036], [0.11, 0.028]], z) * (1 + (bulk - 1) * 0.6);
      const hAt = (z: number) => keyed([[-0.045, 0.088], [-0.01, 0.096], [0.02, 0.074], [0.05, 0.052], [0.08, 0.042], [0.11, 0.034]], z);
      type SR = { z: number; w: number; hh: number; k: number };
      const rings: SR[] = [];
      const capN = D.capRows + 1;
      for (let k = 0; k < capN; k++) {
        const phi = (k / capN) * (Math.PI / 2);
        rings.push({ z: ZH - 0.012 * Math.cos(phi), w: wAt(ZH), hh: hAt(ZH), k: Math.sin(phi) });
      }
      for (const z of zs) rings.push({ z, w: wAt(z), hh: hAt(z), k: 1 });
      for (let k = 1; k <= capN; k++) {
        const phi = (k / capN) * (Math.PI / 2);
        rings.push({ z: ZT + 0.02 * Math.sin(phi), w: wAt(ZT), hh: hAt(ZT), k: Math.cos(phi) });
      }
      const cols = D.limbCols + 4;
      body.grid({
        rows: rings.length - 1,
        cols,
        point: (i, j, out) => {
          const R = rings[i];
          const th = (j / cols) * Math.PI * 2;
          const c = Math.cos(th);
          const sn = Math.sin(th);
          const e = 2 / 3.2;
          const cy = R.hh / 2;
          const x = R.w * R.k * Math.sign(c) * Math.pow(Math.abs(c), e);
          const y = cy + (R.hh / 2) * R.k * Math.sign(sn) * Math.pow(Math.abs(sn), e);
          const flare = y < 0.014 ? 1.06 : 1;
          out.set(lx + s * 0.004 * Math.max(0, R.z / ZT) + x * flare, Math.max(0, y), R.z);
        },
        weights: (p) => {
          const k = smoothstep(0.065, 0.095, p.y) * 0.35;
          return W([AN, 1 - k], [KN, k]);
        },
        color: (p) => {
          if (p.y < 0.014) return sole;
          if (p.y > 0.078 && p.z < 0.01) return collar;
          const lateral = Math.abs(p.x - lx) > wAt(p.z) * 0.62;
          if (lateral && p.y > 0.024 && p.y < 0.044 && p.z > -0.03 && p.z < 0.075) return shoeAccent;
          return trim;
        },
      });
    }
  }

  // ================================================================= JERSEY
  const jersey = new SkinBuilder();
  {
    const rows = D.jerseyRows;
    const cols = D.jerseyCols;
    const ys = Array.from({ length: rows + 1 }, (_, i) => JERSEY_TOP - (i / rows) * (JERSEY_TOP - JERSEY_BOT));
    const thetas = ys.map((y) => {
      const tab = arcTable(jerseyProfile(y, bulk), TORSO_N, 128);
      return Array.from({ length: cols }, (_, j) => thetaForU(j / cols, tab));
    });
    jersey.grid({
      rows,
      cols,
      point: (i, j, out) => {
        const [x, z] = ringXZ(thetas[i][j], jerseyProfile(ys[i], bulk), TORSO_N);
        out.set(x, ys[i], z);
      },
      weights: torsoWeights,
      uv: (i, j) => [j / cols, (ys[i] - JERSEY_BOT) / (JERSEY_TOP - JERSEY_BOT)],
    });
  }

  // ================================================================= SHORTS
  const shorts = new SkinBuilder();
  {
    // Waist: hugging the jersey at the band, then loose over the hips.
    const cols = D.jerseyCols;
    const keys: [number, number, number][] = [
      // y, extra radius, ring scale
      [0.583, 0.001, 1],
      [0.579, 0.006, 1],
      [0.56, 0.008, 1],
      [0.52, 0.011, 1],
      [0.49, 0.013, 1],
      [0.47, 0.013, 0.8],
      [0.46, 0.013, 0],
    ];
    const ringAt = (k: number): Ring => {
      const [y, off, sc] = keys[k];
      const r = jerseyProfile(y, bulk);
      return { rx: (r.rx + off) * sc, rz: (r.rz + off * 0.9) * sc, cz: r.cz };
    };
    const thetas = keys.map((_, k) => {
      const r = ringAt(k);
      if (r.rx < 1e-5) return Array.from({ length: cols }, (_, j) => (j / cols) * Math.PI * 2);
      const tab = arcTable(r, 2.3, 96);
      return Array.from({ length: cols }, (_, j) => thetaForU(j / cols, tab));
    });
    const waistV = (y: number) => SHORTS.vSplit + (1 - SHORTS.vSplit) * Math.min(1, Math.max(0, (y - SHORTS.waistBot) / (SHORTS.waistTop - SHORTS.waistBot)));
    shorts.grid({
      rows: keys.length - 1,
      cols,
      point: (i, j, out) => {
        const [x, z] = ringXZ(thetas[i][j], ringAt(i), 2.3);
        out.set(x, keys[i][0], z);
      },
      weights: (p) => {
        const t = smoothstep(0.55, 0.585, p.y) * 0.35;
        return W(['hips', 1 - t], ['spine', t]);
      },
      uv: (i, j) => [j / cols, waistV(keys[i][0])],
    });
    // Legs, with a folded hem.
    for (const s of [-1, 1] as const) {
      const HP = (s > 0 ? 'rHip' : 'lHip') as SkeletonBone;
      const n = D.limbRows;
      const lcols = D.limbCols + 6;
      const rings: (Ring & { y: number; cx: number; v: number })[] = [];
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        const y = SHORTS.legTop + (SHORTS.legBot - SHORTS.legTop) * u;
        // Legs start inside the waist and overlap at the crotch so wide
        // stances never open a gap.
        rings.push({
          y,
          cx: s * keyed([[0, 0.046], [0.25, 0.052], [1, 0.07]], u) * hipBulk,
          rx: keyed([[0, 0.048], [0.25, 0.062], [1, 0.066]], u) * limbBulk,
          rz: keyed([[0, 0.07], [0.25, 0.073], [1, 0.07]], u) * limbBulk,
          cz: 0.002,
          v: SHORTS.legV * (1 - u),
        });
      }
      const last = rings[rings.length - 1];
      rings.push({ ...last, y: last.y + 0.004, rx: last.rx * 0.9, rz: last.rz * 0.9, v: 0 });
      const thetas = rings.map((r) => {
        const tab = arcTable(r, 2.2, 96);
        return Array.from({ length: lcols }, (_, j) => thetaForU(j / lcols, tab));
      });
      const u0 = s < 0 ? 0 : 0.5;
      shorts.grid({
        rows: rings.length - 1,
        cols: lcols,
        point: (i, j, out) => {
          const r = rings[i];
          const [x, z] = ringXZ(thetas[i][j], r, 2.2);
          out.set(r.cx + x, r.y, z);
        },
        weights: (p) => {
          const t = shortsLegBlend(p.y);
          return W(['hips', 1 - t], [HP, t]);
        },
        uv: (i, j) => [u0 + 0.5 * (j / lcols) * 0.999, rings[i].v],
      });
    }
  }

  // ================================================================= ASSEMBLE
  const texSize = lowDetail ? { jw: 512, jh: 384, sw: 512, sh: 256 } : { jw: 1024, jh: 768, sw: 1024, sh: 512 };
  const jerseyCanvas = paintJersey(team, kit, def, bulk, texSize.jw, texSize.jh);
  const shortsCanvas = paintShorts(team, kit, bulk, texSize.sw, texSize.sh);
  const jerseyTex = new THREE.CanvasTexture(jerseyCanvas);
  const shortsTex = new THREE.CanvasTexture(shortsCanvas);
  for (const t of [jerseyTex, shortsTex]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = lowDetail ? 2 : 8;
    t.wrapS = THREE.RepeatWrapping;
  }
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  const jerseyMat = new THREE.MeshStandardMaterial({ map: jerseyTex, roughness: 0.78, alphaTest: 0.5 });
  const shortsMat = new THREE.MeshStandardMaterial({ map: shortsTex, roughness: 0.74 });

  // Bind in the rest pose with the root at the origin.
  const holder = new THREE.Group();
  holder.add(bones.hips);
  holder.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(SKELETON_BONES.map((b) => bones[b]));
  const meshes: THREE.SkinnedMesh[] = [];
  for (const [b, m] of [
    [body, bodyMat],
    [jersey, jerseyMat],
    [shorts, shortsMat],
  ] as const) {
    const g = b.build();
    g.scale(h, h, h);
    const mesh = new THREE.SkinnedMesh(g, m);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    holder.add(mesh);
    mesh.bind(skeleton);
    meshes.push(mesh);
  }
  holder.remove(bones.hips);
  for (const m of meshes) holder.remove(m);

  return {
    bones,
    skeleton,
    meshes,
    textures: [jerseyTex, shortsTex],
    materials: [bodyMat, jerseyMat, shortsMat],
    repaint: () => {
      paintJersey(team, kit, def, bulk, texSize.jw, texSize.jh, jerseyCanvas);
      paintShorts(team, kit, bulk, texSize.sw, texSize.sh, shortsCanvas);
      jerseyTex.needsUpdate = true;
      shortsTex.needsUpdate = true;
    },
  };
}
