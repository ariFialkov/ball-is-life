import * as THREE from 'three';
import { teamById, type Kit, type PlayerDef } from '../data/teams.ts';
import { buildBody, type BuiltBody, type SkeletonBone } from './body.ts';
import { J } from './bodyShape.ts';
import { kitFontPromise } from './jersey.ts';

export type AnimState =
  | 'idle'
  | 'idleBall'
  | 'run'
  | 'dribble'
  | 'defense'
  | 'shoot'
  | 'layup'
  | 'dunk'
  | 'pass'
  | 'block'
  | 'steal'
  | 'celebrate'
  | 'dejected'
  | 'catch';

/**
 * Pose channels. `spine` and `head` are the authored bends; at apply time they
 * are distributed over the two-piece spine (spine + chest) and the neck so the
 * body curves instead of hinging. `chest`, `neck`, wrists and ankles add on top.
 */
type BoneName =
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'lShoulder'
  | 'lElbow'
  | 'lWrist'
  | 'rShoulder'
  | 'rElbow'
  | 'rWrist'
  | 'lHip'
  | 'lKnee'
  | 'lAnkle'
  | 'rHip'
  | 'rKnee'
  | 'rAnkle';
const BONES: BoneName[] = ['spine', 'chest', 'neck', 'head', 'lShoulder', 'lElbow', 'lWrist', 'rShoulder', 'rElbow', 'rWrist', 'lHip', 'lKnee', 'lAnkle', 'rHip', 'rKnee', 'rAnkle'];

interface Pose {
  bones: Record<BoneName, [number, number, number]>;
  /** vertical offset of the hips relative to standing height (negative = crouch) */
  hipsY: number;
  /** jump height added to the whole body */
  jump: number;
}

const emptyPose = (): Pose => ({
  bones: Object.fromEntries(BONES.map((b) => [b, [0, 0, 0]])) as unknown as Record<BoneName, [number, number, number]>,
  hipsY: 0,
  jump: 0,
});

// Rotation conventions (model faces +Z): a limb hanging down (-Y) swings
// forward with a NEGATIVE rotation.x; the spine leans forward with a
// POSITIVE rotation.x; rotation.z spreads the arms/legs outward (sign per side).
// Ankles/wrists: POSITIVE rotation.x points the toes down / flexes the hand
// towards the front of the limb.

/**
 * A procedurally modelled, skinned basketball player. The body, jersey and
 * shorts are smooth skinned meshes driven by a 17-bone skeleton (hips, spine,
 * chest, neck, head, shoulders, elbows, wrists, hips, knees, ankles). All
 * animation is generated analytically and blended, so no asset files are
 * needed and every player on the floor can run a different cycle.
 */
export class Character {
  readonly root = new THREE.Group();
  readonly hips: THREE.Bone;
  readonly bones: Record<SkeletonBone, THREE.Bone>;
  readonly rHand = new THREE.Object3D();
  readonly lHand = new THREE.Object3D();
  readonly def: PlayerDef;
  readonly h: number;
  private standHipY: number;
  state: AnimState = 'idle';
  stateTime = 0;
  /** 0..1 locomotion intensity used while running/dribbling */
  moveBlend = 0;
  phase = 0;
  dribblePhase = 0;
  private current: Pose = emptyPose();
  private built: BuiltBody;
  private disposed = false;
  readonly meshes: THREE.Mesh[] = [];
  highlight: THREE.Mesh;
  shadowBlob: THREE.Mesh;
  handedness: 1 | -1 = 1;
  /**
   * Dribble hand switch: while non-null the dribble arms blend from the pose
   * for hand `switchFrom` to the mirrored pose for the other hand by `switchMix` (0..1).
   */
  switchFrom: 1 | -1 | null = null;
  switchMix = 0;
  /** Additive body shaping for dribble moves. `lean` > 0 tilts the torso toward the +1 (r-bone) side. */
  lean = 0;
  /** Chest twist (radians about the vertical axis). */
  twist = 0;
  /** Extra hip drop in metres (negative = lower). */
  crouch = 0;
  /** -1 runs the stride cycle backwards, for backpedalling. */
  strideDir: 1 | -1 = 1;

  constructor(def: PlayerDef, kit: Kit, opts: { lowDetail?: boolean } = {}) {
    this.def = def;
    const h = def.height;
    this.h = h;
    this.standHipY = J.hips * h;
    this.built = buildBody(def, kit, teamById(kit.teamId), !!opts.lowDetail);
    this.bones = this.built.bones;
    this.hips = this.bones.hips;
    this.root.add(this.hips);
    for (const m of this.built.meshes) {
      this.root.add(m);
      this.meshes.push(m);
    }
    // Ball anchors sit in the palms and follow the wrists.
    this.rHand.position.set(0, -0.05 * h, 0.04 * h);
    this.lHand.position.set(0, -0.05 * h, 0.04 * h);
    this.bones.rWrist.add(this.rHand);
    this.bones.lWrist.add(this.lHand);
    // Kit lettering uses the web font; repaint once it has loaded.
    kitFontPromise()?.then(() => {
      if (!this.disposed) this.built.repaint();
    });
    // Selection ring under the controlled player.
    this.highlight = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.position.y = 0.012;
    this.root.add(this.highlight);
    this.shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    this.shadowBlob.rotation.x = -Math.PI / 2;
    this.shadowBlob.position.y = 0.008;
    this.root.add(this.shadowBlob);
    this.applyPose(this.current);
  }

  setState(s: AnimState) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
  }

  setHighlight(on: boolean, color = 0xffffff) {
    const m = this.highlight.material as THREE.MeshBasicMaterial;
    m.opacity = on ? 0.85 : 0;
    m.color.set(color);
  }

  /** Advance animation. moveSpeed01 is 0..1 (0 = stationary, 1 = full sprint). */
  update(dt: number, moveSpeed01: number) {
    this.stateTime += dt;
    this.moveBlend += (moveSpeed01 - this.moveBlend) * Math.min(1, dt * 10);
    const stride = 0.5 + this.moveBlend * 1.0;
    this.phase += dt * (6.5 + this.moveBlend * 6) * (this.moveBlend > 0.03 ? 1 : 0) * this.strideDir;
    this.dribblePhase += dt * 10.5;
    let target: Pose;
    if (this.switchFrom !== null && this.state === 'dribble') {
      // Hand switch: blend the dribble pose for the old hand into the mirrored one.
      const saved = this.handedness;
      this.handedness = this.switchFrom;
      const from = this.generatePose();
      this.handedness = (this.switchFrom === 1 ? -1 : 1) as 1 | -1;
      const to = this.generatePose();
      this.handedness = saved;
      target = blendPose(from, to, smooth(clamp01(this.switchMix)));
    } else target = this.generatePose();
    // Positive spine z tips the torso toward local -X, the -1 hand side.
    target.bones.spine[2] -= this.lean;
    target.bones.chest[1] += this.twist;
    target.hipsY += this.crouch;
    // Quick blend for transitions, snappier when entering explosive actions.
    const rate = this.state === 'shoot' || this.state === 'dunk' || this.state === 'layup' || this.state === 'pass' || this.state === 'block' ? 20 : 12;
    const k = Math.min(1, dt * rate);
    for (const b of BONES) {
      const c = this.current.bones[b];
      const t = target.bones[b];
      c[0] += (t[0] - c[0]) * k;
      c[1] += (t[1] - c[1]) * k;
      c[2] += (t[2] - c[2]) * k;
    }
    this.current.hipsY += (target.hipsY - this.current.hipsY) * k;
    this.current.jump = target.jump;
    this.applyPose(this.current);
    void stride;
  }

  private applyPose(p: Pose) {
    const b = p.bones;
    const B = this.bones;
    const set = (bone: THREE.Bone, a: number[], ka: number, c?: number[], kc = 1) => {
      bone.rotation.set(a[0] * ka + (c ? c[0] * kc : 0), a[1] * ka + (c ? c[1] * kc : 0), a[2] * ka + (c ? c[2] * kc : 0));
    };
    // Spread the authored torso bend over spine + chest, and the head turn over neck + head.
    set(B.spine, b.spine, 0.55);
    set(B.chest, b.spine, 0.45, b.chest);
    set(B.neck, b.head, 0.4, b.neck);
    set(B.head, b.head, 0.6);
    for (const k of ['lShoulder', 'lElbow', 'lWrist', 'rShoulder', 'rElbow', 'rWrist', 'lHip', 'lKnee', 'rHip', 'rKnee'] as const) set(B[k], b[k], 1);
    // Ankles keep the sole flat while grounded and point the toes in the air.
    const air = Math.min(1, Math.max(0, (p.jump - 0.03) / 0.15));
    for (const side of ['l', 'r'] as const) {
      const hip = b[`${side}Hip`];
      const knee = b[`${side}Knee`];
      const extra = b[`${side}Ankle`];
      const flat = -(hip[0] + knee[0]);
      const pitch = flat * (1 - air) + 0.55 * air + extra[0];
      B[`${side}Ankle`].rotation.set(Math.min(0.95, Math.max(-0.75, pitch)), extra[1], -hip[2] * (1 - air) + extra[2]);
    }
    this.hips.position.y = this.standHipY + p.hipsY + p.jump;
    this.shadowBlob.scale.setScalar(1 - Math.min(0.6, p.jump * 0.6));
    (this.shadowBlob.material as THREE.MeshBasicMaterial).opacity = 0.25 - Math.min(0.15, p.jump * 0.2);
  }

  /** Height of the body above the floor (jump). */
  get airHeight() {
    return this.current.jump;
  }

  private generatePose(): Pose {
    const p = emptyPose();
    const b = p.bones;
    const t = this.stateTime;
    const m = this.moveBlend;
    const ph = this.phase;
    const hand = this.handedness;
    const R = hand > 0 ? 'rShoulder' : 'lShoulder';
    const RE = hand > 0 ? 'rElbow' : 'lElbow';
    const L = hand > 0 ? 'lShoulder' : 'rShoulder';
    const LE = hand > 0 ? 'lElbow' : 'rElbow';
    const RW = hand > 0 ? 'rWrist' : 'lWrist';
    const LW = hand > 0 ? 'lWrist' : 'rWrist';
    const breathe = Math.sin(t * 2.2) * 0.02;

    const locomotion = (amp: number) => {
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      b.lHip = [-s * 0.75 * amp, 0, -0.03];
      b.rHip = [s * 0.75 * amp, 0, 0.03];
      b.lKnee = [(0.25 + 0.9 * Math.max(0, -c)) * amp + 0.08, 0, 0];
      b.rKnee = [(0.25 + 0.9 * Math.max(0, c)) * amp + 0.08, 0, 0];
      b.spine = [0.08 + 0.22 * amp, Math.sin(ph) * 0.06 * amp, 0];
      // Shoulders counter-rotate against the hips; the head stays steady.
      b.chest = [0, -s * 0.14 * amp, 0];
      b.neck = [0, s * 0.08 * amp, 0];
      // Push off through the toes at the back of each stride.
      b.lAnkle = [0.35 * Math.max(0, s) * amp, 0, 0];
      b.rAnkle = [0.35 * Math.max(0, -s) * amp, 0, 0];
      p.hipsY = -0.02 - Math.abs(Math.sin(ph)) * 0.035 * amp - 0.05 * amp;
    };
    const idleArms = () => {
      b.lShoulder = [0.05, 0, 0.14];
      b.rShoulder = [0.05, 0, -0.14];
      b.lElbow = [-0.25, 0, 0];
      b.rElbow = [-0.25, 0, 0];
      b.lWrist = [0.12, 0, 0];
      b.rWrist = [0.12, 0, 0];
    };
    const runArms = (amp: number) => {
      const s = Math.sin(ph);
      b.lShoulder = [0.55 * s * amp - 0.3 * amp, 0, 0.18];
      b.rShoulder = [-0.55 * s * amp - 0.3 * amp, 0, -0.18];
      b.lElbow = [-1.0 - 0.3 * amp, 0, 0];
      b.rElbow = [-1.0 - 0.3 * amp, 0, 0];
      b.lWrist = [0.2 + 0.15 * s * amp, 0, 0];
      b.rWrist = [0.2 - 0.15 * s * amp, 0, 0];
    };

    switch (this.state) {
      case 'idle': {
        idleArms();
        b.spine = [0.03 + breathe, 0, 0];
        b.head = [0.05 - breathe, Math.sin(t * 0.7) * 0.15, 0];
        b.lKnee = [0.06, 0, 0];
        b.rKnee = [0.06, 0, 0];
        b.lHip = [-0.03, 0, -0.06];
        b.rHip = [-0.03, 0, 0.06];
        p.hipsY = -0.01 + breathe * 0.3;
        if (m > 0.03) {
          locomotion(m);
          runArms(m);
        }
        break;
      }
      case 'idleBall': {
        // Triple threat stance holding the ball at the hip.
        b.spine = [0.18 + breathe, 0, 0];
        b.head = [-0.05, 0, 0];
        b[R] = [-0.45, 0, -hand * 0.25];
        b[RE] = [-1.35, 0, 0];
        b[L] = [-0.4, 0, hand * 0.5];
        b[LE] = [-1.5, 0, 0];
        b[RW] = [-0.35, 0, 0];
        b[LW] = [-0.25, 0, 0];
        b.lHip = [-0.3, 0, -0.18];
        b.rHip = [-0.3, 0, 0.18];
        b.lKnee = [0.55, 0, 0];
        b.rKnee = [0.55, 0, 0];
        p.hipsY = -0.1;
        if (m > 0.03) locomotion(m);
        break;
      }
      case 'run': {
        locomotion(Math.max(0.35, m));
        runArms(Math.max(0.35, m));
        b.head = [-0.1, 0, 0];
        break;
      }
      case 'dribble': {
        const amp = Math.max(0.25, m);
        locomotion(amp);
        b.spine = [0.2 + 0.15 * amp, 0, 0];
        // Dribbling hand pumps with the ball; off hand guards.
        const pump = Math.sin(this.dribblePhase) * 0.5 + 0.5;
        b[R] = [-0.35 - pump * 0.25, 0, -hand * 0.3];
        b[RE] = [-0.55 - pump * 0.55, 0, 0];
        b[RW] = [-0.45 + pump * 0.75, 0, 0];
        b[L] = [-0.6 - 0.15 * amp, 0, hand * 0.55];
        b[LE] = [-1.35, 0, 0];
        b[LW] = [-0.2, 0, 0];
        b.chest = [0.05, -hand * 0.12, 0];
        p.hipsY -= 0.04;
        break;
      }
      case 'defense': {
        const sway = Math.sin(t * 2.5) * 0.06;
        b.lHip = [-0.5, 0, -0.42];
        b.rHip = [-0.5, 0, 0.42];
        b.lKnee = [0.85, 0, 0];
        b.rKnee = [0.85, 0, 0];
        b.spine = [0.32, sway, 0];
        b.head = [-0.15, -sway, 0];
        b.lShoulder = [-0.35, 0, 1.25 + sway];
        b.rShoulder = [-0.35, 0, -1.25 + sway];
        b.lElbow = [-0.65, 0, 0];
        b.rElbow = [-0.65, 0, 0];
        b.lWrist = [-0.35, 0, 0];
        b.rWrist = [-0.35, 0, 0];
        p.hipsY = -0.2;
        if (m > 0.1) {
          // shuffle: smaller leg swing while staying low
          const s = Math.sin(ph * 1.4);
          b.lHip = [-0.45 - s * 0.2 * m, 0, -0.42];
          b.rHip = [-0.45 + s * 0.2 * m, 0, 0.42];
          p.hipsY = -0.17;
        }
        break;
      }
      case 'shoot': {
        // 0.95s jump shot: load, rise, release at ~0.42, follow through.
        const dur = 0.95;
        const u = Math.min(1, t / dur);
        const load = smooth(clamp01(u / 0.22));
        const rise = smooth(clamp01((u - 0.18) / 0.3));
        const follow = smooth(clamp01((u - 0.42) / 0.25));
        const jumpT = clamp01((u - 0.2) / 0.7);
        p.jump = Math.sin(jumpT * Math.PI) * 0.4;
        p.hipsY = -0.16 * load * (1 - rise) - 0.02;
        const kneeBend = 0.9 * load * (1 - rise);
        b.lKnee = [kneeBend + 0.1, 0, 0];
        b.rKnee = [kneeBend + 0.1, 0, 0];
        b.lHip = [-kneeBend * 0.5 - 0.02, 0, -0.1];
        b.rHip = [-kneeBend * 0.5 - 0.02 - 0.3 * rise, 0, 0.1];
        b.spine = [0.25 * load * (1 - rise) - 0.08 * rise, 0, 0];
        b.head = [-0.3 * rise, 0, 0];
        // Shooting arm: from set point (chest) to full extension overhead.
        const shoulderX = -0.9 - 2.1 * rise;
        b[R] = [shoulderX, 0, -hand * (0.15 - 0.1 * rise)];
        b[RE] = [-1.75 * (1 - rise) - 0.1 - 0.25 * follow, 0, 0];
        // Wrist cocks back under the ball, then snaps through on release.
        b[RW] = [-0.55 * load - 0.6 * rise * (1 - follow) + 1.25 * follow, 0, 0];
        b[LW] = [-0.3 * (1 - follow), 0, 0];
        // Guide hand.
        b[L] = [-1.0 - 1.5 * rise + 0.9 * follow, 0, hand * (0.5 - 0.25 * rise)];
        b[LE] = [-1.6 * (1 - rise) - 0.2, 0, 0];
        break;
      }
      case 'layup': {
        const dur = 1.0;
        const u = Math.min(1, t / dur);
        const jumpT = clamp01((u - 0.05) / 0.85);
        p.jump = Math.sin(jumpT * Math.PI) * 0.62;
        const reach = smooth(clamp01((u - 0.1) / 0.3));
        b[R] = [-0.6 - 2.5 * reach, 0, -hand * 0.1];
        b[RE] = [-1.4 * (1 - reach) - 0.05, 0, 0];
        b[RW] = [-0.5 * reach + 0.6 * smooth(clamp01((u - 0.45) / 0.2)), 0, 0];
        b[L] = [-0.6 - 0.9 * reach, 0, hand * 0.4];
        b[LE] = [-1.4, 0, 0];
        b.rHip = [-1.2 * reach - 0.1, 0, 0.1];
        b.rKnee = [1.4 * reach + 0.2, 0, 0];
        b.lHip = [0.35 * reach - 0.1, 0, -0.1];
        b.lKnee = [0.35, 0, 0];
        b.spine = [0.15, 0, -hand * 0.1 * reach];
        b.head = [-0.35 * reach, 0, 0];
        break;
      }
      case 'dunk': {
        const dur = 1.1;
        const u = Math.min(1, t / dur);
        const jumpT = clamp01((u - 0.05) / 0.85);
        p.jump = Math.sin(jumpT * Math.PI) * 0.85;
        const reach = smooth(clamp01((u - 0.08) / 0.3));
        const slam = smooth(clamp01((u - 0.42) / 0.14));
        const armX = -0.7 - 2.5 * reach + 1.1 * slam;
        b[R] = [armX, 0, -hand * 0.15];
        b[RE] = [-1.2 * (1 - reach) - 0.1 - 0.5 * slam, 0, 0];
        b[L] = [armX + 0.3, 0, hand * 0.3];
        b[LE] = [-1.2 * (1 - reach) - 0.1 - 0.5 * slam, 0, 0];
        b[RW] = [-0.4 * reach + 1.0 * slam, 0, 0];
        b[LW] = [-0.3 * reach + 0.8 * slam, 0, 0];
        b.rHip = [-1.1 * reach, 0, 0.12];
        b.rKnee = [1.5 * reach + 0.2, 0, 0];
        b.lHip = [-0.6 * reach, 0, -0.12];
        b.lKnee = [1.1 * reach + 0.2, 0, 0];
        b.spine = [0.3 - 0.25 * slam, 0, 0];
        b.head = [-0.4 * reach + 0.3 * slam, 0, 0];
        break;
      }
      case 'pass': {
        const dur = 0.42;
        const u = Math.min(1, t / dur);
        const push = smooth(clamp01(u / 0.45)) * (1 - smooth(clamp01((u - 0.7) / 0.3)) * 0.5);
        b.lShoulder = [-0.5 - 1.1 * push, 0, 0.35 - 0.25 * push];
        b.rShoulder = [-0.5 - 1.1 * push, 0, -0.35 + 0.25 * push];
        b.lElbow = [-1.5 * (1 - push) - 0.05, 0, 0];
        b.rElbow = [-1.5 * (1 - push) - 0.05, 0, 0];
        b.lWrist = [-0.4 + 0.9 * push, 0, 0];
        b.rWrist = [-0.4 + 0.9 * push, 0, 0];
        b.spine = [0.2 + 0.15 * push, 0, 0];
        b.lHip = [-0.25, 0, -0.14];
        b.rHip = [-0.25, 0, 0.14];
        b.lKnee = [0.45, 0, 0];
        b.rKnee = [0.45, 0, 0];
        p.hipsY = -0.08;
        if (m > 0.05) locomotion(m * 0.6);
        break;
      }
      case 'block': {
        const dur = 0.9;
        const u = Math.min(1, t / dur);
        const jumpT = clamp01((u - 0.08) / 0.8);
        p.jump = Math.sin(jumpT * Math.PI) * 0.6;
        const reach = smooth(clamp01(u / 0.25));
        b[R] = [-3.0 * reach, 0, -hand * 0.1];
        b[RE] = [-0.1, 0, 0];
        b[L] = [-1.4 * reach, 0, hand * 0.9];
        b[LE] = [-0.4, 0, 0];
        b.lKnee = [0.4 * (1 - reach) + 0.2, 0, 0];
        b.rKnee = [0.4 * (1 - reach) + 0.2, 0, 0];
        b.spine = [-0.1, 0, 0];
        b.head = [-0.4, 0, 0];
        break;
      }
      case 'steal': {
        const dur = 0.5;
        const u = Math.min(1, t / dur);
        const reach = Math.sin(u * Math.PI);
        b[R] = [-1.6 * reach - 0.2, 0, -hand * 0.3];
        b[RE] = [-0.2, 0, 0];
        b[RW] = [0.5 * reach, 0, 0];
        b.chest = [0, hand * 0.2 * reach, 0];
        b[L] = [-0.3, 0, hand * 0.9];
        b[LE] = [-0.6, 0, 0];
        b.spine = [0.4 + 0.3 * reach, 0, hand * 0.15 * reach];
        b.lHip = [-0.6, 0, -0.4];
        b.rHip = [-0.6, 0, 0.4];
        b.lKnee = [0.9, 0, 0];
        b.rKnee = [0.9, 0, 0];
        p.hipsY = -0.22;
        break;
      }
      case 'celebrate': {
        const bounce = Math.abs(Math.sin(t * 6));
        p.jump = bounce * 0.12;
        b.lShoulder = [-2.8 + Math.sin(t * 8) * 0.2, 0, 0.5];
        b.rShoulder = [-2.8 - Math.sin(t * 8) * 0.2, 0, -0.5];
        b.lElbow = [-0.4, 0, 0];
        b.rElbow = [-0.4, 0, 0];
        b.spine = [-0.15, 0, 0];
        b.head = [-0.3, 0, 0];
        b.lKnee = [0.2, 0, 0];
        b.rKnee = [0.2, 0, 0];
        break;
      }
      case 'dejected': {
        b.spine = [0.45, 0, 0];
        b.head = [0.5, 0, 0];
        b.lWrist = [0.3, 0, 0];
        b.rWrist = [0.3, 0, 0];
        b.lShoulder = [0.2, 0, 0.1];
        b.rShoulder = [0.2, 0, -0.1];
        b.lElbow = [-0.2, 0, 0];
        b.rElbow = [-0.2, 0, 0];
        b.lHip = [-0.5, 0, -0.1];
        b.rHip = [-0.5, 0, 0.1];
        b.lKnee = [0.9, 0, 0];
        b.rKnee = [0.9, 0, 0];
        p.hipsY = -0.18;
        break;
      }
      case 'catch': {
        const u = Math.min(1, t / 0.3);
        const reach = 1 - u;
        b.lShoulder = [-1.4 * reach - 0.4, 0, 0.3];
        b.rShoulder = [-1.4 * reach - 0.4, 0, -0.3];
        b.lElbow = [-0.6 - 0.8 * u, 0, 0];
        b.rElbow = [-0.6 - 0.8 * u, 0, 0];
        b.lWrist = [-0.5 * reach, 0, 0];
        b.rWrist = [-0.5 * reach, 0, 0];
        b.spine = [0.15, 0, 0];
        if (m > 0.05) locomotion(m);
        break;
      }
    }
    return p;
  }

  /** World position of the ball-hand anchor. */
  handWorld(target: THREE.Vector3, hand: 'r' | 'l' = this.handedness > 0 ? 'r' : 'l'): THREE.Vector3 {
    return (hand === 'r' ? this.rHand : this.lHand).getWorldPosition(target);
  }

  dispose() {
    this.disposed = true;
    for (const m of this.built.meshes) m.geometry.dispose();
    for (const m of this.built.materials) m.dispose();
    for (const t of this.built.textures) t.dispose();
    this.built.skeleton.dispose();
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.shadowBlob.geometry.dispose();
    (this.shadowBlob.material as THREE.Material).dispose();
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out = emptyPose();
  for (const k of BONES) {
    const x = a.bones[k];
    const y = b.bones[k];
    out.bones[k] = [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  }
  out.hipsY = a.hipsY + (b.hipsY - a.hipsY) * t;
  out.jump = a.jump + (b.jump - a.jump) * t;
  return out;
}
const smooth = (v: number) => v * v * (3 - 2 * v);
