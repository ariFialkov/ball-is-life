import * as THREE from 'three';
import { teamById, type Kit, type PlayerDef } from '../data/teams.ts';
import { buildBody, type BuiltBody, type SkeletonBone } from './body.ts';
import { J } from './bodyShape.ts';
import { BALL_R } from './constants.ts';
import { dribbleAt, dribbleTiming, type DribbleParams } from './dribble.ts';
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
  | 'catch'
  | 'screen';

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
  /** pelvis yaw (rotates with the stride, the chest counter-rotates) */
  hipsYaw: number;
}

const emptyPose = (): Pose => ({
  bones: Object.fromEntries(BONES.map((b) => [b, [0, 0, 0]])) as unknown as Record<BoneName, [number, number, number]>,
  hipsY: 0,
  jump: 0,
  hipsYaw: 0,
});

/** States in which the body is on its feet and moving, so it reacts to the forces on it. */
const GROUNDED_STATES = new Set<AnimState>(['idle', 'idleBall', 'run', 'dribble', 'defense', 'catch', 'screen']);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

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
  /** Arm path for the 'dunk' state (the 360 and reverse are body rotations driven by the caller). */
  dunkStyle: 'two' | 'tomahawk' | 'windmill' | 'legs' = 'two';
  /** Scales the dunk leap (dunk-contest athletes get up higher than an in-game dunk). */
  jumpBoost = 1;

  // --- Kinetics: the body reacts to the forces on it (sensed from how the root actually moves).
  private kPrev = new THREE.Vector3();
  private kInit = false;
  /** Smoothed ground velocity and acceleration (world, m/s and m/s²). */
  readonly vel = new THREE.Vector3();
  readonly acc = new THREE.Vector3();
  /** Whole-body lean about the feet: forward (+) when accelerating, back when braking. */
  private pitch = 0;
  private pitchV = 0;
  /**
   * Sideways shift of the hips (metres, + toward the r/+X side) under a turning force. The pelvis
   * moves over the loaded leg and the legs angle to keep the feet planted; the torso and head stay
   * upright (athletes don't roll their whole frame into a turn, that reads as a waddle).
   */
  private shift = 0;
  private shiftV = 0;
  /** Hard cut: 1 at the plant, decaying; side +1 = cutting toward the r (+X) side. */
  private plant = 0;
  private plantSide = 0;
  /** Hop-stop / spot-up settle after arriving from a run: 1 at the stop, decaying. */
  private settle = 0;
  private recentSpeed = 0;
  /** 0..1: how hard the player is driving forward (arm pump, forward lean). */
  private drive = 0;

  // --- Dribble: the hand pushes and receives the ball (see dribble.ts); the arm reaches it with IK.
  /** Set by the caller each frame: a live dribble with no hand switch in progress. */
  dribbling = false;
  /** 0..1 through the current dribble (0 = hand at rest on top of the ball). */
  dribbleU = 0;
  /** Ball centre (world) while dribbling. */
  readonly dribbleBall = new THREE.Vector3();
  /** True on the frame the dribble hits the floor. */
  dribbleBounce = false;
  /** 0..1 how fully the hand is driving the ball (ramps in when a dribble starts). */
  dribbleWeight = 0;
  private dribTop = 0;
  private dribRel = 0;
  private dribInit = false;
  private dribLag = new THREE.Vector3();
  private dribRelVel = new THREE.Vector3();
  private dribInFlight = false;

  constructor(def: PlayerDef, kit: Kit, opts: { lowDetail?: boolean } = {}) {
    this.def = def;
    const h = def.height;
    this.h = h;
    this.standHipY = J.hips * h;
    this.built = buildBody(def, kit, teamById(kit.teamId), !!opts.lowDetail);
    this.bones = this.built.bones;
    this.hips = this.bones.hips;
    // The spine undoes the pelvis's stride yaw about the vertical before it leans, so a forward-leaning
    // torso doesn't swing side to side with every step.
    this.bones.spine.rotation.order = 'YXZ';
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
    this.phase += dt * (6.5 + this.moveBlend * 6) * (this.moveBlend > 0.03 ? 1 : 0) * this.strideDir;
    this.dribblePhase += dt * 10.5;
    this.sense(dt);
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
    // Dribble-move lean: mostly carried by the hips and legs (see sense); only a touch of shoulder dip.
    target.bones.spine[2] -= this.lean * 0.3;
    target.bones.chest[1] += this.twist;
    target.hipsY += this.crouch;
    this.kineticPose(target);
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
    this.current.hipsYaw += (target.hipsYaw - this.current.hipsYaw) * k;
    this.current.jump = target.jump;
    this.applyPose(this.current);
    this.dribbleStep(dt);
  }

  /** Read the forces on the body from how the root moved, and drive the lean and hip-shift springs and cut/stop reactions. */
  private sense(dt: number) {
    const p = this.root.position;
    if (!this.kInit || dt <= 0) {
      this.kPrev.copy(p);
      this.kInit = true;
      return;
    }
    const dx = p.x - this.kPrev.x;
    const dz = p.z - this.kPrev.z;
    this.kPrev.copy(p);
    if (dx * dx + dz * dz > 0.6) {
      // Teleported (reset for a throw-in, substitution): no forces.
      this.vel.set(0, 0, 0);
      this.acc.set(0, 0, 0);
      return;
    }
    const kv = Math.min(1, dt * 25);
    const nvx = this.vel.x + (dx / dt - this.vel.x) * kv;
    const nvz = this.vel.z + (dz / dt - this.vel.z) * kv;
    const ka = Math.min(1, dt * 12);
    const lim = (v: number) => Math.max(-32, Math.min(32, v));
    this.acc.x += (lim((nvx - this.vel.x) / dt) - this.acc.x) * ka;
    this.acc.z += (lim((nvz - this.vel.z) / dt) - this.acc.z) * ka;
    this.vel.set(nvx, 0, nvz);
    const speed = Math.hypot(nvx, nvz);
    this.recentSpeed = Math.max(speed, this.recentSpeed - dt * 3);
    // Body frame: forward is local +Z, the r side is local +X.
    const yaw = this.root.rotation.y;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const af = this.acc.x * sy + this.acc.z * cy;
    // Turning force: the part of the acceleration across the direction of travel (what bends a curl or
    // a cut), expressed on the body's sideways axis. Standing still, plain sideways acceleration counts.
    let ax = this.acc.x;
    let az = this.acc.z;
    if (speed > 0.8) {
      const ux = nvx / speed;
      const uz = nvz / speed;
      const along = ax * ux + az * uz;
      ax -= along * ux;
      az -= along * uz;
    }
    const al = ax * cy - az * sy;
    const turn = Math.hypot(ax, az);
    const grounded = this.current.jump < 0.03;
    const kin = grounded && GROUNDED_STATES.has(this.state) ? 1 : 0;
    // Lean into the acceleration about the feet (forward to speed up, back to brake), and shift the
    // hips over the inside leg in a turn, through lightly underdamped springs so they settle cleanly.
    const pitchT = Math.max(-0.13, Math.min(0.17, af * 0.018)) * kin;
    const shiftT = Math.max(-0.1, Math.min(0.1, al * 0.0055 + this.lean * 0.28)) * kin;
    const K = 150;
    const C = 2 * Math.sqrt(K) * 0.65;
    this.pitchV += ((pitchT - this.pitch) * K - this.pitchV * C) * dt;
    this.pitch += this.pitchV * dt;
    this.shiftV += ((shiftT - this.shift) * K - this.shiftV * C) * dt;
    this.shift += this.shiftV * dt;
    // A hard change of direction at speed: plant the outside foot and push off it.
    if (kin > 0.5 && speed > 2.2 && turn > 10 && Math.abs(al) > 3 && this.plant < 0.25) {
      this.plant = 1;
      this.plantSide = Math.sign(al);
      this.shiftV += this.plantSide * 0.45;
    }
    // Arriving from a run and stopping (spotting up, squaring to the ball): hop-stop and sink.
    if (kin > 0.5 && this.recentSpeed > 2.8 && speed < 0.8 && this.settle < 0.15) {
      this.settle = 1;
      this.recentSpeed = 0;
      this.pitchV -= 0.8;
    }
    this.plant = Math.max(0, this.plant - dt * 4.2);
    this.settle = Math.max(0, this.settle - dt * 3);
    this.drive += (Math.max(0, Math.min(1, af / 12)) * kin - this.drive) * Math.min(1, dt * 8);
  }

  /** Additive reactions on top of the authored pose: pumping arms, the plant on a cut, the hop-stop. */
  private kineticPose(p: Pose) {
    if (!GROUNDED_STATES.has(this.state)) return;
    const b = p.bones;
    // Braking: the legs brace out in front while the hips flex and keep the chest tall (the frame
    // doesn't tip back as a block). Then keep the eyes level against whatever lean the torso has.
    const brace = this.pitch < 0 ? -this.pitch * 0.65 : 0;
    b.spine[0] += brace;
    b.head[0] -= (this.pitch + brace) * 0.8;
    // A turning load goes into the legs: the inside knee sinks and takes it, the hips drop a little.
    const load = Math.max(-1, Math.min(1, this.shift / 0.08));
    if (Math.abs(load) > 0.01) {
      const inKnee = load > 0 ? 'rKnee' : 'lKnee';
      const outKnee = load > 0 ? 'lKnee' : 'rKnee';
      b[inKnee][0] += 0.32 * Math.abs(load);
      b[outKnee][0] += 0.12 * Math.abs(load);
      p.hipsY -= 0.04 * Math.abs(load);
    }
    // Driving forward: lower, longer, arms pumping harder.
    if (this.drive > 0.01) {
      const d = this.drive;
      b.spine[0] += 0.1 * d;
      const s = Math.sin(this.phase);
      if (this.state === 'run') {
        b.lShoulder[0] += 0.3 * s * d;
        b.rShoulder[0] -= 0.3 * s * d;
      }
      p.hipsY -= 0.03 * d;
    }
    if (this.plant > 0.01) {
      const k = Math.sin(Math.PI * this.plant) * 0.6 + this.plant * 0.4;
      const side = this.plantSide;
      // The outside leg (away from the new direction) reaches wide and takes the load; the inside knee sinks.
      const outHip = side > 0 ? 'lHip' : 'rHip';
      const outKnee = side > 0 ? 'lKnee' : 'rKnee';
      const inKnee = side > 0 ? 'rKnee' : 'lKnee';
      b[outHip][2] += (side > 0 ? -1 : 1) * 0.32 * k;
      b[outKnee][0] += 0.3 * k;
      b[inKnee][0] += 0.45 * k;
      // Shoulders and eyes turn into the cut ahead of the hips.
      b.chest[1] += side * 0.3 * k;
      b.head[1] += side * 0.3 * k;
      p.hipsYaw -= side * 0.12 * k;
      p.hipsY -= 0.08 * k;
    }
    if (this.settle > 0.01) {
      const u = 1 - this.settle;
      // A small hop into the stop, then the knees absorb it and the feet are set wide.
      const hop = u < 0.3 ? Math.sin((Math.PI * u) / 0.3) * 0.035 : 0;
      const sink = Math.sin(Math.PI * u);
      p.jump += hop;
      p.hipsY -= 0.09 * sink;
      b.lKnee[0] += 0.45 * sink;
      b.rKnee[0] += 0.45 * sink;
      b.lHip[0] -= 0.25 * sink;
      b.rHip[0] -= 0.25 * sink;
      b.lHip[2] -= 0.08 * this.settle;
      b.rHip[2] += 0.08 * this.settle;
      b.spine[0] += 0.12 * sink;
    }
  }

  /** Advance the dribble and put the dribbling hand on the ball. */
  private dribbleStep(dt: number) {
    this.dribbleBounce = false;
    const on = this.dribbling && this.state === 'dribble' && this.switchFrom === null && this.current.jump < 0.05;
    if (!on) {
      this.dribbleWeight = 0;
      this.dribInit = false;
      this.dribInFlight = false;
      this.dribLag.set(0, 0, 0);
      return;
    }
    this.dribbleWeight = Math.min(1, this.dribbleWeight + dt * 6);
    const h = this.h;
    const hand = this.handedness;
    const side = hand > 0 ? 'r' : 'l';
    const m = this.moveBlend;
    this.root.updateMatrixWorld(true);
    // Where the ball goes, in the body frame: outside the hip on the ball side, further out front when running.
    const lat = hand * 0.165 * h;
    const fwd = (0.1 + 0.09 * m) * h;
    const sh = this.root.worldToLocal(this.bones[`${side}Shoulder`].getWorldPosition(_v));
    const elbow = this.bones[`${side}Elbow`].position.length();
    const anchor = this.rHand.position;
    const reach = elbow + Math.hypot(this.bones[`${side}Wrist`].position.length() - anchor.y, anchor.z);
    const hd = Math.hypot(lat - sh.x, fwd - sh.z);
    const drop = Math.sqrt(Math.max(0.01, (0.95 * reach) ** 2 - hd * hd));
    // Heights follow the shoulders: a low, crouched dribble is a lower, quicker dribble.
    const topT = sh.y - 0.5 * drop;
    const relT = sh.y - 0.93 * drop;
    if (!this.dribInit) {
      // A dribble always starts with the hand on top of the ball.
      this.dribbleU = 0;
      this.dribTop = topT;
      this.dribRel = relT;
      this.dribInit = true;
    }
    const ks = Math.min(1, dt * 7);
    this.dribTop += (topT - this.dribTop) * ks;
    this.dribRel += (relT - this.dribRel) * ks;
    const params: DribbleParams = {
      palmTop: this.dribTop,
      palmRelease: Math.min(this.dribRel, this.dribTop - 0.12),
      palmCatch: this.dribTop - 0.45 * (this.dribTop - this.dribRel),
      push: 0.1 - 0.022 * m,
      cushion: 0.095 - 0.015 * m,
    };
    const tm = dribbleTiming(params);
    const u0 = this.dribbleU;
    let u1 = u0 + dt / tm.period;
    if (u0 < tm.bounceAt && u1 >= tm.bounceAt) this.dribbleBounce = true;
    if (u1 >= 1) u1 -= 1;
    this.dribbleU = u1;
    const smp = dribbleAt(params, tm, u1);
    // Inertia: once it leaves the hand the ball keeps the velocity it was pushed with, so on a hard
    // cut it carries on the old way and the hand goes and gets it (the offset fades out by the catch).
    if (!smp.contact) {
      if (!this.dribInFlight) this.dribRelVel.copy(this.vel);
      this.dribInFlight = true;
      this.dribLag.x += (this.dribRelVel.x - this.vel.x) * dt;
      this.dribLag.z += (this.dribRelVel.z - this.vel.z) * dt;
      this.dribLag.clampLength(0, 0.38);
    } else {
      this.dribInFlight = false;
      this.dribLag.set(0, 0, 0);
    }
    const fade = smp.contact ? 0 : 1 - smp.flight * smp.flight * (3 - 2 * smp.flight);
    this.root.localToWorld(this.dribbleBall.set(lat, smp.ball, fwd));
    this.dribbleBall.addScaledVector(this.dribLag, fade);
    // The palm sits on top of the ball while in contact; in flight it follows its own path above it.
    this.root.localToWorld(_w.set(lat, smp.palm, fwd));
    if (smp.contact) _w.addScaledVector(this.dribLag, fade);
    this.reachArm(side, _w, smp.wrist, this.dribbleWeight);
  }

  /**
   * Two-bone IK: set the shoulder (pitch + spread), elbow and wrist of one arm so its palm anchor
   * reaches `target` (world), blended over the current pose by `w`.
   */
  private reachArm(side: 'l' | 'r', target: THREE.Vector3, wrist: number, w: number) {
    const B = this.bones;
    const sh = B[`${side}Shoulder`];
    const el = B[`${side}Elbow`];
    const wr = B[`${side}Wrist`];
    const chest = sh.parent!;
    const d = chest.worldToLocal(_v.copy(target)).sub(sh.position);
    const anchor = side === 'r' ? this.rHand.position : this.lHand.position;
    const cw = Math.cos(wrist);
    const sw = Math.sin(wrist);
    const ex = wr.position.x + anchor.x;
    const ey = wr.position.y + anchor.y * cw - anchor.z * sw;
    const ez = wr.position.z + anchor.y * sw + anchor.z * cw;
    const ax = el.position.x;
    const ay = el.position.y;
    const az = el.position.z;
    const dist = d.length();
    // Elbow: the distance shoulder→palm grows monotonically as the elbow straightens.
    let lo = -2.5;
    let hi = 0;
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let i = 0; i < 18; i++) {
      const th = (lo + hi) / 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      px = ax + ex;
      py = ay + ey * c - ez * s;
      pz = az + ey * s + ez * c;
      if (Math.hypot(px, py, pz) < dist) lo = th;
      else hi = th;
    }
    const elbowX = (lo + hi) / 2;
    // Shoulder: spread (z) to match the sideways reach, then pitch (x) to swing onto the target.
    const R = Math.hypot(px, py);
    const phi = Math.atan2(py, px);
    const ac = Math.acos(Math.max(-1, Math.min(1, d.x / R)));
    const z1 = wrapPi(ac - phi);
    const z2 = wrapPi(-ac - phi);
    const z = Math.abs(z1) < Math.abs(z2) ? z1 : z2;
    const py2 = px * Math.sin(z) + py * Math.cos(z);
    const x = wrapPi(Math.atan2(d.z, d.y) - Math.atan2(pz, py2));
    const cur = this.current.bones;
    const blend = (k: 'lShoulder' | 'rShoulder' | 'lElbow' | 'rElbow' | 'lWrist' | 'rWrist', v: [number, number, number]) => {
      const c = cur[k];
      c[0] += (v[0] - c[0]) * w;
      c[1] += (v[1] - c[1]) * w;
      c[2] += (v[2] - c[2]) * w;
      B[k].rotation.set(c[0], c[1], c[2]);
    };
    blend(`${side}Shoulder`, [x, 0, z]);
    blend(`${side}Elbow`, [elbowX, 0, 0]);
    blend(`${side}Wrist`, [wrist, 0, 0]);
  }

  private applyPose(p: Pose) {
    const b = p.bones;
    const B = this.bones;
    const set = (bone: THREE.Bone, a: number[], ka: number, c?: number[], kc = 1) => {
      bone.rotation.set(a[0] * ka + (c ? c[0] * kc : 0), a[1] * ka + (c ? c[1] * kc : 0), a[2] * ka + (c ? c[2] * kc : 0));
    };
    // Spread the authored torso bend over spine + chest, and the head turn over neck + head.
    set(B.spine, b.spine, 0.55);
    B.spine.rotation.y -= p.hipsYaw;
    set(B.chest, b.spine, 0.45, b.chest);
    set(B.neck, b.head, 0.4, b.neck);
    set(B.head, b.head, 0.6);
    for (const k of ['lShoulder', 'lElbow', 'lWrist', 'rShoulder', 'rElbow', 'rWrist', 'lHip', 'lKnee', 'rHip', 'rKnee'] as const) set(B[k], b[k], 1);
    // The hips shift sideways over the loaded leg; both legs angle back so the feet stay where they are.
    const hh = this.standHipY + p.hipsY;
    const legComp = -Math.atan2(this.shift, hh);
    B.lHip.rotation.z += legComp;
    B.rHip.rotation.z += legComp;
    // Ankles keep the sole flat while grounded and point the toes in the air.
    const air = Math.min(1, Math.max(0, (p.jump - 0.03) / 0.15));
    for (const side of ['l', 'r'] as const) {
      const hip = b[`${side}Hip`];
      const knee = b[`${side}Knee`];
      const extra = b[`${side}Ankle`];
      const flat = -(hip[0] + knee[0]);
      const pitch = flat * (1 - air) + 0.55 * air + extra[0] - this.pitch * (1 - air);
      B[`${side}Ankle`].rotation.set(Math.min(0.95, Math.max(-0.75, pitch)), extra[1], -(hip[2] + legComp) * (1 - air) + extra[2]);
    }
    // Forward/back lean is about the feet (tilt the hips forward and slide them so the feet stay put);
    // there is no sideways roll of the frame.
    this.hips.rotation.set(this.pitch, p.hipsYaw, 0);
    this.hips.position.set(this.shift, hh * Math.cos(this.pitch) + p.jump, hh * Math.sin(this.pitch));
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
      b.spine = [0.08 + 0.22 * amp, 0, 0];
      // The pelvis turns with the stride; the spine takes it out, the shoulders counter-rotate a
      // little against it (driven by the arm swing) and the neck keeps the head pointed straight on.
      p.hipsYaw = s * 0.1 * amp;
      b.chest = [0, -s * 0.07 * amp, 0];
      b.neck = [0, s * 0.07 * amp, 0];
      // Push off through the toes at the back of each stride.
      b.lAnkle = [0.35 * Math.max(0, s) * amp, 0, 0];
      b.rAnkle = [0.35 * Math.max(0, -s) * amp, 0, 0];
      p.hipsY = -0.02 - Math.abs(Math.sin(ph)) * 0.026 * amp - 0.05 * amp;
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
        p.jump = Math.sin(jumpT * Math.PI) * 0.85 * this.jumpBoost;
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
        if (this.dunkStyle === 'tomahawk') {
          // One hand cocked behind the head, whipped up to full extension over the rim, then hammered down.
          const cock = smooth(clamp01((u - 0.1) / 0.2)) * (1 - smooth(clamp01((u - 0.38) / 0.1)));
          b[R] = [armX - 0.5 * cock, 0, -hand * 0.1];
          b[RE] = [-1.9 * cock - 0.15 - 0.4 * slam, 0, 0];
          b[RW] = [-0.9 * cock + 1.1 * slam, 0, 0];
          b[L] = [-0.9, 0, hand * 0.7];
          b[LE] = [-0.5, 0, 0];
          b.spine = [0.1 - 0.35 * cock + 0.3 * slam, 0, 0];
        } else if (this.dunkStyle === 'windmill') {
          // The ball arm sweeps a full circle: forward, down, back, over the top and through.
          const w = smooth(clamp01((u - 0.06) / 0.38));
          b[R] = [-1.5 + 4.6 * w + 1.1 * slam, 0, -hand * 0.18];
          b[RE] = [-0.1, 0, 0];
          b[RW] = [0.2 + 0.8 * slam, 0, 0];
          b[L] = [-1.0, 0, hand * 0.8];
          b[LE] = [-0.6, 0, 0];
          b.chest = [0, -hand * 0.35 * Math.sin(w * Math.PI), 0];
        } else if (this.dunkStyle === 'legs') {
          // Knees tuck high while the ball passes under them, then both hands come up to finish.
          const under = Math.sin(Math.PI * clamp01((u - 0.1) / 0.32));
          const up = smooth(clamp01((u - 0.36) / 0.12));
          b.lHip = [-1.6 * under - 0.4 * up, 0, -0.35];
          b.rHip = [-1.6 * under - 0.4 * up, 0, 0.35];
          b.lKnee = [1.9 * under + 0.4, 0, 0];
          b.rKnee = [1.9 * under + 0.4, 0, 0];
          b.spine = [0.75 * under - 0.2 * up + 0.2 * slam, 0, 0];
          b[R] = [-0.35 * (1 - up) - 3.0 * up + 1.1 * slam, 0, -hand * 0.15];
          b[L] = [-0.35 * (1 - up) - 2.8 * up + 1.1 * slam, 0, hand * 0.15];
          b[RE] = [-0.25 * (1 - up) - 0.1, 0, 0];
          b[LE] = [-0.25 * (1 - up) - 0.1, 0, 0];
        }
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
      case 'screen': {
        // Setting a pick: wide, low base, arms crossed over the chest, braced for contact.
        b.lHip = [-0.28, 0, -0.32];
        b.rHip = [-0.28, 0, 0.32];
        b.lKnee = [0.5, 0, 0];
        b.rKnee = [0.5, 0, 0];
        b.spine = [0.12, 0, 0];
        b.head = [0.05, 0, 0];
        b.lShoulder = [-1.0, 0.5, -0.35];
        b.rShoulder = [-1.0, -0.5, 0.35];
        b.lElbow = [-1.75, 0, 0];
        b.rElbow = [-1.75, 0, 0];
        p.hipsY = -0.09;
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
  out.hipsYaw = a.hipsYaw + (b.hipsYaw - a.hipsYaw) * t;
  return out;
}
const smooth = (v: number) => v * v * (3 - 2 * v);
