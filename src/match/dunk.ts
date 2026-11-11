/**
 * In-game dunks: a planned, fully kinematic finish.
 *
 * At the moment a dunk starts, `planDunk` reads the situation (which side and angle the dunker
 * comes from, how fast, which hand has the ball, whether a defender is in the way) and picks a
 * variation: the takeoff (one foot or two), the hand(s) on the ball, the style (a one-hand stuff,
 * a two-hand power slam, a cocked tomahawk, a two-hand hammer, a baseline reverse, or a posterizer
 * over a defender), and the finish (no hang, or hanging on the rim with one or both hands for a
 * varied time). `evalDunk` then gives, for any time into the dunk, where the body is, how it is
 * posed, where each hand goes (arm IK) and how the ball is held.
 *
 * The geometry is built backwards from the release: the ball is thrown down from just above the
 * rim centre with the palm on top of it, and the shoulder is placed so the arm comes over the
 * front of the rim (never through the ring). The ball rises in front of the rim and only moves
 * over it once it is above the iron. The ball is always attached to the palm(s) (see
 * Character.palmBall), so it never floats or warps.
 */
import * as THREE from 'three';
import { BALL_R, RIM_H, RIM_R } from '../engine/constants.ts';
import { J } from '../engine/bodyShape.ts';
import type { Character, DunkBody, HandGoal } from '../engine/character.ts';

/** A touch floatier than real gravity: dunks read better with a little hang time. */
const G = 9.81 * 0.88;
/** Seconds from the slam starting to the ball leaving the hand. */
const SLAM = 0.12;
/** Chest fold at the moment of release (the rest of the fold comes right after). */
const FOLD_AT_REL = 0.12;

export type DunkStyle = 'stuff' | 'power' | 'tomahawk' | 'hammer' | 'reverse' | 'poster';

export interface DunkPlan {
  style: DunkStyle;
  /** The hand that leads (and grabs the rim on a one-hand hang): +1 is the rig's r side. */
  hand: 1 | -1;
  /** Both hands on the ball at the slam. */
  two: boolean;
  oneFoot: boolean;
  approach: 'middle' | 'wing' | 'baseline';
  /** Hands on the rim afterwards (0 = straight down, no hang) and for how long. */
  hangHands: 0 | 1 | 2;
  hang: number;
  /** Posterizer: the defender in the way. */
  contact: boolean;
  h: number;
  rim: THREE.Vector3;
  /** Horizontal unit toward the rim, and the body's right when facing it. */
  dir: THREE.Vector3;
  lat: THREE.Vector3;
  /** The body's right at the slam (opposite to `lat` on a reverse, which faces away from the rim). */
  rightS: THREE.Vector3;
  start: THREE.Vector3;
  take: THREE.Vector3;
  slamRoot: THREE.Vector3;
  relRoot: THREE.Vector3;
  hangRoot: THREE.Vector3;
  land: THREE.Vector3;
  /** Root jump height at the slam, at the release, and while hanging. */
  apex: number;
  relY: number;
  hangY: number;
  yaw0: number;
  yawFace: number;
  /** Extra rotation through the rise (a reverse turns its back to the rim). */
  spin: number;
  /** Ball targets: in front of and above the rim, coming over it, and the release. */
  bPre: THREE.Vector3;
  bSlam: THREE.Vector3;
  bRel: THREE.Vector3;
  /** Rim grips for the hang (one or two). */
  grips: THREE.Vector3[];
  ballStart: THREE.Vector3;
  tTake: number;
  tUp: number;
  tSlam: number;
  tRel: number;
  tGrab: number;
  tLet: number;
  tLand: number;
  tEnd: number;
  v0: number;
}

export interface DunkContext {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  h: number;
  ballHand: 1 | -1;
  rating: number;
  /** Rim centre (y = RIM_H) and which way the team attacks (+1 / -1 along x). */
  rim: THREE.Vector3;
  attack: 1 | -1;
  /** The nearest defender, if any (the planner decides whether he is in the way). */
  defender: THREE.Vector3 | null;
  ball: THREE.Vector3;
  /** 0..1 variety seed (kept off the match RNG so dunks don't change the script's random stream). */
  seed: number;
  /** Test hook: pin parts of the variation. */
  force?: Partial<Pick<DunkPlan, 'style' | 'oneFoot' | 'two' | 'hangHands' | 'hand'>> | null;
}

/** What the body, the hands and the ball do at one instant. */
export interface DunkFrame {
  /** Ground position (x, z) and the jump height (y). */
  root: THREE.Vector3;
  yaw: number;
  body: DunkBody;
  hands: { l: HandGoal | null; r: HandGoal | null };
  /** How the ball sits until release: between both palms, in one, or easing in from the dribble. */
  ball: 'two' | 'one' | 'free';
  /** 0..1 how far the ball has come from its dribble spot into the hands (gather). */
  ballIn: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const smooth = (u: number) => {
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
};
const easeOut = (u: number) => 1 - (1 - clamp01(u)) ** 2;
const frac = (x: number) => x - Math.floor(x);
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const UP = new THREE.Vector3(0, 1, 0);

/** Forward and right for a body yaw (the model faces +Z; its r side is local +X). */
function frame(yaw: number, fwd: THREE.Vector3, right: THREE.Vector3) {
  fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

export function planDunk(c: DunkContext): DunkPlan {
  const h = c.h;
  const rnd = (i: number) => frac(Math.sin((c.seed + 1) * 12.9898 * (i + 1) + i * 78.233) * 43758.5453);
  const rim = c.rim.clone();
  const dir = new THREE.Vector3(rim.x - c.pos.x, 0, rim.z - c.pos.z);
  let d = dir.length();
  if (d < 0.25) {
    dir.set(c.attack, 0, 0);
    d = 0.25;
  } else dir.divideScalar(d);
  const lat = new THREE.Vector3(dir.z, 0, -dir.x);
  // Approach angle against the line straight down the lane.
  const angle = Math.acos(clamp(dir.x * c.attack, -1, 1));
  const approach: DunkPlan['approach'] = angle < 0.44 ? 'middle' : angle < 1.05 ? 'wing' : 'baseline';
  const speed = Math.max(0, c.vel.x * dir.x + c.vel.z * dir.z);
  // A defender between the dunker and the rim: the posterizer.
  let contact = false;
  if (c.defender) {
    const ox = c.defender.x - c.pos.x;
    const oz = c.defender.z - c.pos.z;
    const along = ox * dir.x + oz * dir.z;
    const across = Math.abs(ox * lat.x + oz * lat.z);
    contact = along > 0.25 && along < Math.min(1.9, d + 0.2) && across < 0.55;
  }
  const F = c.force ?? {};
  // A defender in the path is a posterizer most of the time (more for the best dunkers); otherwise
  // it's a regular finish through the traffic.
  if (contact && rnd(7) > 0.35 + 0.3 * clamp((c.rating - 70) / 25, 0, 1)) contact = false;
  if (F.style === 'poster') contact = true;
  const oneFoot = F.oneFoot ?? (contact ? speed > 4 && rnd(0) < 0.5 : speed > 3.3 ? rnd(0) < 0.85 : speed > 2.1 && rnd(0) < 0.3);
  let style: DunkStyle;
  if (contact) style = 'poster';
  else if (approach === 'baseline' && c.rating >= 78 && rnd(1) < 0.45) style = 'reverse';
  else if (oneFoot && c.rating >= 82 && speed > 3.8 && rnd(2) < 0.45) style = 'tomahawk';
  else if (!oneFoot && c.rating >= 80 && rnd(2) < 0.4) style = 'hammer';
  else style = oneFoot ? 'stuff' : 'power';
  if (F.style) style = F.style;
  const two = F.two ?? (style === 'power' || style === 'hammer' || (style === 'reverse' && rnd(3) < 0.6) || (style === 'poster' && !oneFoot));
  // From the side, finish with the outside hand (away from the help); down the middle, the ball hand.
  let hand = c.ballHand;
  if (approach !== 'middle' && rnd(4) < 0.75) {
    const out = Math.sign(c.pos.z * -dir.x) as 1 | -1 | 0;
    if (out) hand = out as 1 | -1;
  }
  if (F.hand) hand = F.hand;
  let hangHands: 0 | 1 | 2 = 0;
  if (style === 'power' || style === 'hammer') hangHands = rnd(5) < 0.8 ? 2 : 1;
  else if (style === 'poster') hangHands = rnd(5) < 0.65 ? 1 : 0;
  else if (style === 'stuff' || style === 'tomahawk') hangHands = rnd(5) < 0.5 ? 1 : 0;
  if (F.hangHands !== undefined) hangHands = style === 'reverse' ? 0 : !two && F.hangHands === 2 ? 1 : F.hangHands;
  const hang = hangHands === 2 ? 0.38 + 0.45 * rnd(6) + clamp(h - 2.0, 0, 0.15) : hangHands === 1 ? 0.22 + 0.3 * rnd(6) : 0;

  // --- Release geometry (built backwards from the throw-down) -------------------------------
  const arm = 0.38 * h;
  const shY = J.shoulderY * h;
  const shX = J.shoulderX * h;
  const reverse = style === 'reverse';
  const yawFace = Math.atan2(dir.x, dir.z) + (reverse ? Math.PI : 0);
  const fwdS = new THREE.Vector3();
  const rightS = new THREE.Vector3();
  frame(yawFace, fwdS, rightS);
  // Arm elevation (from the horizontal toward the rim) at the release: shallow enough that the
  // whole arm passes over the front of the rim.
  const elev = ({ stuff: 41, poster: 40, tomahawk: 42, power: 42, hammer: 43, reverse: 41 } as const)[style] * (Math.PI / 180);
  const bRel = rim.clone().addScaledVector(UP, 0.15).addScaledVector(dir, -0.01);
  const armVec = dir.clone().multiplyScalar(Math.cos(elev)).addScaledVector(UP, Math.sin(elev)).multiplyScalar(0.98 * arm);
  let shoulder: THREE.Vector3;
  const relRoot = new THREE.Vector3();
  if (two) {
    const mid = bRel.clone().addScaledVector(UP, 0.45 * BALL_R).addScaledVector(dir, -0.5 * BALL_R);
    shoulder = mid.sub(armVec);
    relRoot.copy(shoulder);
  } else {
    const palm = bRel.clone().addScaledVector(UP, 0.72 * BALL_R).addScaledVector(dir, -0.7 * BALL_R);
    shoulder = palm.sub(armVec);
    relRoot.copy(shoulder).addScaledVector(rightS, -hand * shX);
  }
  // At the release the chest has only started to fold (most of it comes just after), which carries
  // the shoulders a little toward the rim: start the body that much further back.
  // (A reverse is still arched back, reaching over its head, which leans the shoulders the other way.)
  const spineRel = 0.06 + 0.42 * FOLD_AT_REL - (reverse ? 0.38 * 0.5 : 0);
  const shift = (J.shoulderY - J.spine) * h * Math.sin(spineRel);
  relRoot.addScaledVector(fwdS, -shift);
  let relY = shoulder.y - shY + (J.shoulderY - J.spine) * h * (1 - Math.cos(spineRel));
  let apex = relY + 0.5 * G * SLAM * SLAM;
  const apexMax = 1.35;
  if (apex > apexMax) {
    // A shorter player gets up as high as he can; the ball comes in a little lower.
    const drop = apex - apexMax;
    apex = apexMax;
    relY -= drop;
    bRel.y -= drop * 0.6;
  }
  relRoot.y = 0;
  const slamRoot = relRoot.clone().addScaledVector(dir, -0.05);
  // Over the front of the rim and down: the ball rises in front of the iron first.
  const bSlam = bRel.clone().addScaledVector(UP, 0.12).addScaledVector(dir, -0.1);
  const bPre = rim.clone().addScaledVector(dir, -0.42).addScaledVector(UP, 0.3);

  // --- Takeoff ---------------------------------------------------------------------------------
  const start = new THREE.Vector3(c.pos.x, 0, c.pos.z);
  const tTake = oneFoot ? 0.17 : 0.27;
  const L = (slamRoot.x - start.x) * dir.x + (slamRoot.z - start.z) * dir.z;
  const gDist = oneFoot ? clamp(speed * tTake * 0.8, 0, Math.max(0, L - 0.3)) : clamp(L * 0.25, -0.3, 0.5);
  const take = start.clone().addScaledVector(dir, gDist);
  const v0 = Math.sqrt(2 * G * apex);
  const tUp = v0 / G;
  const tSlam = tTake + tUp;
  const tRel = tSlam + SLAM;
  const vRel = G * SLAM;

  // --- After the release: hang on the rim, or straight down ---------------------------------
  const grips: THREE.Vector3[] = [];
  const hangRoot = new THREE.Vector3();
  let hangY = 0;
  let tGrab = tRel;
  let tLet = tRel;
  let tLand: number;
  const land = new THREE.Vector3();
  if (hangHands > 0) {
    if (hangHands === 2) {
      const f = Math.sqrt((RIM_R + 0.03) ** 2 - 0.11 ** 2);
      grips.push(rim.clone().addScaledVector(dir, -f).addScaledVector(lat, -0.11).addScaledVector(UP, 0.03));
      grips.push(rim.clone().addScaledVector(dir, -f).addScaledVector(lat, 0.11).addScaledVector(UP, 0.03));
      hangRoot.copy(rim).addScaledVector(dir, -(f + 0.07));
    } else {
      const g = rim.clone().addScaledVector(dir, -(RIM_R + 0.025)).addScaledVector(lat, hand * 0.04).addScaledVector(UP, 0.03);
      grips.push(g);
      hangRoot.copy(g).addScaledVector(lat, -hand * shX).addScaledVector(dir, -0.06);
    }
    hangRoot.y = 0;
    hangY = grips[0].y - 0.88 * arm - shY;
    const drop = Math.max(0.05, relY - hangY);
    tGrab = tRel + Math.max(0.12, (-vRel + Math.sqrt(vRel * vRel + 2 * G * drop)) / G);
    tLet = tGrab + hang;
    tLand = tLet + Math.sqrt((2 * Math.max(0.05, hangY)) / G);
    land.copy(rim).addScaledVector(dir, -0.62);
  } else {
    tLand = tRel + (-vRel + Math.sqrt(vRel * vRel + 2 * G * Math.max(0.05, relY))) / G;
    land.copy(relRoot).addScaledVector(dir, reverse ? 0 : 0.18);
    // Never land under the backboard.
    const past = (land.x - rim.x) * dir.x + (land.z - rim.z) * dir.z;
    if (past > -0.2) land.addScaledVector(dir, -0.2 - past);
  }
  land.y = 0;
  return {
    style,
    hand,
    two,
    oneFoot,
    approach,
    hangHands,
    hang,
    contact,
    h,
    rim,
    dir,
    lat,
    rightS,
    start,
    take,
    slamRoot,
    relRoot,
    hangRoot,
    land,
    apex,
    relY,
    hangY,
    yaw0: c.yaw,
    yawFace,
    spin: reverse ? (hand > 0 ? -Math.PI : Math.PI) : 0,
    bPre,
    bSlam,
    bRel,
    grips,
    ballStart: c.ball.clone(),
    tTake,
    tUp,
    tSlam,
    tRel,
    tGrab,
    tLet,
    tLand,
    tEnd: tLand + 0.34,
    v0,
  };
}

export function newDunkFrame(): DunkFrame {
  return {
    root: new THREE.Vector3(),
    yaw: 0,
    body: { air: 0, gather: 0, oneFoot: true, lead: 1, knee: 0, tuck: 0, kick: 0, split: 0, arch: 0, fold: 0, hang: 0, swing: 0, land: 0, twist: 0, free: 0, freeUp: 0, look: 0, armsUp: 1 },
    hands: { l: null, r: null },
    ball: 'free',
    ballIn: 0,
  };
}

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

function goal(g: HandGoal | null): HandGoal {
  return g ?? { target: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1), flex: 0, w: 0 };
}

/** Evaluate the dunk at `t` seconds in. */
export function evalDunk(p: DunkPlan, t: number, out: DunkFrame): DunkFrame {
  const h = p.h;
  const R = BALL_R;
  const body = out.body;
  const lead = p.hand;
  body.oneFoot = p.oneFoot;
  body.lead = lead;
  body.gather = body.knee = body.tuck = body.kick = body.split = body.arch = body.fold = body.hang = body.swing = body.land = body.twist = body.freeUp = 0;
  body.free = 0;
  body.look = 0;
  // Arms up for the ball until the release, then relaxing to shoulder height on the way down.
  body.armsUp = t < p.tRel ? 1 : 1 - 0.55 * smooth((t - p.tRel - 0.12) / 0.35);
  body.air = 0;
  out.ball = 'free';
  out.ballIn = 1;
  const L = (out.hands.l = goal(out.hands.l));
  const Rh = (out.hands.r = goal(out.hands.r));
  L.w = 0;
  Rh.w = 0;
  const leadG = lead > 0 ? Rh : L;
  const offG = lead > 0 ? L : Rh;

  // --- Root path and yaw ----------------------------------------------------------------------
  const root = out.root;
  let yaw: number;
  const turn = wrapPi(p.yawFace - p.spin - p.yaw0);
  if (t < p.tTake) {
    const u = t / p.tTake;
    root.lerpVectors(p.start, p.take, easeOut(u));
    root.y = 0;
    yaw = p.yaw0 + turn * smooth(u * 1.6);
  } else if (t < p.tSlam) {
    const tau = t - p.tTake;
    const u = tau / p.tUp;
    root.lerpVectors(p.take, p.slamRoot, easeOut(u));
    root.y = p.v0 * tau - 0.5 * G * tau * tau;
    yaw = p.yawFace - p.spin * (1 - smooth((u - 0.1) / 0.6));
  } else if (t < p.tRel) {
    const tau = t - p.tSlam;
    root.lerpVectors(p.slamRoot, p.relRoot, tau / SLAM);
    root.y = p.apex - 0.5 * G * tau * tau;
    yaw = p.yawFace;
  } else {
    yaw = p.yawFace;
    const vRel = G * SLAM;
    if (p.hangHands > 0 && t < p.tLet) {
      if (t < p.tGrab) {
        const tau = t - p.tRel;
        root.lerpVectors(p.relRoot, p.hangRoot, smooth(tau / (p.tGrab - p.tRel)));
        root.y = Math.max(p.hangY, p.relY - vRel * tau - 0.5 * G * tau * tau);
      } else {
        // Hanging: the arms take the catch (a small dip), then a swing toward the rim and back.
        const tau = t - p.tGrab;
        const sw = 0.5 * (1 - Math.cos((2 * Math.PI * tau) / 1.05));
        root.copy(p.hangRoot).addScaledVector(p.dir, 0.12 * sw);
        root.y = p.hangY - 0.03 * Math.sin(Math.PI * clamp01(tau / 0.32));
        body.swing = Math.sin((2 * Math.PI * tau) / 1.05);
      }
    } else if (t < p.tLand) {
      const from = p.hangHands > 0 ? p.hangRoot : p.relRoot;
      const t0 = p.hangHands > 0 ? p.tLet : p.tRel;
      const y0 = p.hangHands > 0 ? p.hangY : p.relY;
      const v = p.hangHands > 0 ? 0 : vRel;
      const tau = t - t0;
      root.lerpVectors(from, p.land, smooth(tau / Math.max(0.05, p.tLand - t0)));
      root.y = Math.max(0, y0 - v * tau - 0.5 * G * tau * tau);
    } else {
      root.copy(p.land);
      root.y = 0;
    }
  }
  out.yaw = yaw;
  body.air = root.y;
  frame(yaw, _f, _r);

  // --- Body ---------------------------------------------------------------------------------------
  const rise = t < p.tTake ? 0 : clamp01((t - p.tTake) / p.tUp);
  if (t < p.tTake) {
    const u = t / p.tTake;
    body.gather = Math.sin(Math.PI * Math.min(1, u * 0.85 + 0.15)) * (p.oneFoot ? 0.75 : 1);
    if (p.oneFoot) body.knee = smooth((u - 0.55) / 0.45) * 0.6;
  } else {
    // Takeoff: the lead knee drives (one foot) or both knees tuck (two feet), easing out by the slam.
    const upK = smooth(rise / 0.35) * (1 - 0.55 * smooth((t - p.tSlam) / 0.25));
    if (p.oneFoot) body.knee = 0.6 + 0.4 * upK;
    else body.tuck = upK * 0.8;
    if (p.style === 'power' || p.style === 'hammer') body.kick = smooth((t - p.tSlam + 0.1) / 0.2) * 0.8;
    if (p.style === 'poster') body.split = smooth(rise / 0.5);
    if (p.style === 'tomahawk' || p.style === 'hammer') body.arch = Math.sin(Math.PI * clamp01((rise - 0.25) / 0.75)) * 0.9;
    else body.arch = smooth(rise / 0.8) * 0.3 * (1 - smooth((t - p.tSlam) / SLAM));
    if (p.style === 'reverse') body.arch = smooth(rise / 0.7) * 0.5;
    const foldMax = p.style === 'reverse' ? 0.2 : 0.65;
    body.fold = (FOLD_AT_REL * smooth((t - p.tSlam) / SLAM) + (foldMax - FOLD_AT_REL) * smooth((t - p.tRel) / 0.16)) * (1 - smooth((t - p.tRel - 0.18) / 0.3));
    body.look = -1 + smooth((t - p.tSlam) / SLAM) * 1.4;
  }
  if (p.hangHands > 0 && t >= p.tGrab && t < p.tLet) {
    body.hang = 1;
    body.kick = Math.max(body.kick, 0.5);
    body.knee = 0;
    body.tuck = 0;
    body.split = 0;
    if (p.hangHands === 1) body.twist = -lead * 0.35;
  } else if (p.hangHands > 0 && t >= p.tRel && t < p.tGrab) {
    body.hang = smooth((t - p.tRel) / (p.tGrab - p.tRel));
  } else if (p.hangHands > 0 && t >= p.tLet && t < p.tLand) {
    body.hang = 1 - smooth((t - p.tLet) / 0.2);
  }
  if (t >= p.tLand - 0.06) {
    const u = (t - (p.tLand - 0.06)) / (p.tEnd - p.tLand + 0.06);
    body.land = Math.sin(Math.PI * Math.min(1, u * 1.25)) * (1 - 0.6 * u);
    body.knee = body.tuck = body.split = body.kick = 0;
  }

  // --- Ball and hands ----------------------------------------------------------------------------
  // Pocket at the chest (both hands), where every dunk gathers.
  const pocket = (o: THREE.Vector3) => o.copy(root).addScaledVector(UP, (0.6 - 0.05 * body.gather) * h).addScaledVector(_f, 0.17 * h).addScaledVector(_r, p.two ? 0 : lead * 0.03 * h);
  const twoHands = (B: THREE.Vector3, down: number) => {
    // Palms on either side of the ball, facing in (and a little down onto it at the slam).
    L.target.copy(B).addScaledVector(_r, -0.92 * R);
    L.normal.copy(_r).multiplyScalar(1).addScaledVector(UP, -down).normalize();
    Rh.target.copy(B).addScaledVector(_r, 0.92 * R);
    Rh.normal.copy(_r).multiplyScalar(-1).addScaledVector(UP, -down).normalize();
    L.w = Rh.w = 1;
    L.flex = Rh.flex = -0.2;
  };
  const oneHand = (B: THREE.Vector3, n: THREE.Vector3, flex: number) => {
    leadG.normal.copy(n).normalize();
    leadG.target.copy(B).addScaledVector(leadG.normal, -0.97 * R);
    leadG.w = 1;
    leadG.flex = flex;
  };
  if (t < p.tRel) {
    out.ball = p.two ? 'two' : 'one';
    const B = _a;
    if (t < p.tTake) {
      // Gather: the ball comes off the dribble into both hands at the chest.
      out.ballIn = smooth(t / 0.12);
      pocket(B);
      twoHands(B, 0);
      out.ball = 'two';
    } else if (t < p.tSlam) {
      // Rise: up past the face (or cocked behind the head), then up in front of the rim and over it.
      const u = rise;
      const mid = _b;
      const s = p.style;
      const relMid =
        s === 'tomahawk' ? [lead * 0.1, 1.0, -0.14] : s === 'hammer' ? [0, 1.02, -0.12] : s === 'reverse' ? [0, 1.05, 0.04] : [p.two ? 0 : lead * 0.05, 0.96, 0.15];
      pocket(B);
      mid.copy(root).addScaledVector(_r, relMid[0] * h).addScaledVector(UP, relMid[1] * h).addScaledVector(_f, relMid[2] * h);
      B.lerp(mid, smooth(u / 0.55));
      const whip = s === 'tomahawk' || s === 'hammer' ? 0.62 : 0.5;
      B.lerp(p.bPre, smooth((u - whip) / (0.9 - whip)));
      B.lerp(p.bSlam, smooth((u - 0.88) / 0.12));
      if (p.two) twoHands(B, 0.15 * u);
      else {
        // One hand: both hands carry it up, then the off hand peels away and the ball rides the palm.
        const split = s === 'tomahawk' ? 0.3 : 0.42;
        if (u < split) {
          twoHands(B, 0);
          out.ball = 'two';
        } else {
          // Palm behind and under the ball (cocked behind the head on a tomahawk), turning over the top for the slam.
          const back = s === 'tomahawk' ? 1 - smooth((u - 0.62) / 0.3) : 0;
          _n.copy(_f).multiplyScalar(0.75 + 0.2 * back).addScaledVector(UP, 0.55 - 0.3 * back);
          _n.lerp(_b.copy(p.dir).multiplyScalar(0.7).addScaledVector(UP, -0.72), smooth((u - 0.82) / 0.18));
          oneHand(B, _n, -0.3 + 0.4 * smooth((u - 0.8) / 0.2));
          body.free = (-lead) as 1 | -1;
          body.freeUp = smooth((u - split) / 0.3);
        }
      }
    } else {
      // Slam: over the front of the rim and down, the wrist snapping through.
      const u = (t - p.tSlam) / SLAM;
      B.lerpVectors(p.bSlam, p.bRel, smooth(u));
      if (p.two) twoHands(B, 0.35 + 0.3 * u);
      else {
        _n.copy(p.dir).multiplyScalar(0.7).addScaledVector(UP, -0.72);
        oneHand(B, _n, 0.1 + 0.7 * smooth(u));
        body.free = (-lead) as 1 | -1;
        body.freeUp = 1;
      }
    }
  } else {
    // After the release: hands to the rim (out over the front edge first, never back through the
    // ring) for the hang, or a follow-through down in front of the rim.
    const relPalm = (side: 1 | -1, o: THREE.Vector3) => {
      if (p.two) return o.copy(p.bRel).addScaledVector(p.rightS, side * 0.92 * R).addScaledVector(UP, 0.45 * R);
      return o.copy(p.bRel).addScaledVector(UP, 0.72 * R).addScaledVector(p.dir, -0.7 * R);
    };
    const hands: [HandGoal, 1 | -1, number][] = p.two ? [[L, -1, 0], [Rh, 1, 1]] : [[leadG, lead, 0]];
    if (p.hangHands > 0) {
      for (const [g, side, i] of hands) {
        const grip = p.hangHands === 2 ? p.grips[side > 0 ? 1 : 0] : p.hangHands === 1 && (p.two ? side === lead : true) ? p.grips[0] : null;
        if (!grip) {
          // Two on the ball, one on the rim: the other hand comes off and down.
          g.w = 1 - smooth((t - p.tRel - 0.08) / 0.2);
          // Out over the front of the iron (lifting a touch), then down with the body.
          const tau = t - p.tRel;
          relPalm(side, g.target)
            .addScaledVector(p.dir, -0.36 * smooth(tau / 0.09))
            .addScaledVector(UP, 0.07 * Math.sin(Math.PI * clamp01(tau / 0.14)) + (root.y - p.relY) * smooth((tau - 0.06) / 0.12));
          g.normal.set(0, -1, 0);
          g.flex = 0.6;
          if (g.w < 0.05) body.free = side;
          continue;
        }
        void i;
        if (t < p.tGrab) {
          // Out over the front of the iron first (quickly, while the body is still up), then down onto it.
          const v = (t - p.tRel) / (p.tGrab - p.tRel);
          const hi = _b.copy(grip).addScaledVector(p.dir, -0.06).addScaledVector(UP, 0.1);
          relPalm(side, g.target);
          if (v < 0.35) g.target.lerp(hi, smooth(v / 0.35));
          else g.target.copy(hi).lerp(grip, smooth((v - 0.35) / 0.65));
        } else if (t < p.tLet) g.target.copy(grip);
        else {
          // Letting go: the hand pushes off out in front of the iron before the arm drops.
          const tau = t - p.tLet;
          g.target.copy(grip).addScaledVector(p.dir, -0.2 * smooth(tau / 0.1)).addScaledVector(UP, 0.03 * Math.sin(Math.PI * clamp01(tau / 0.1)) - 0.5 * smooth((tau - 0.08) / 0.25));
        }
        g.normal.set(0, -1, 0).addScaledVector(p.dir, 0.35).normalize();
        g.flex = 0.85;
        g.w = t < p.tLet ? 1 : 1 - smooth((t - p.tLet - 0.08) / 0.2);
      }
      if (p.hangHands === 1) {
        body.free = (-lead) as 1 | -1;
        body.freeUp = 0.2;
      }
    } else {
      const v = (t - p.tRel) / 0.24;
      for (const [g, side] of hands) {
        // Follow-through: out over the front of the rim and down, falling with the body (arm stays long).
        relPalm(side, g.target);
        g.target.addScaledVector(p.dir, -0.36 * smooth(v * 2.4)).addScaledVector(UP, root.y - p.relY - 0.3 * smooth((v - 0.3) / 0.7));
        g.normal.set(0, -1, 0).addScaledVector(p.dir, 0.5).normalize();
        g.flex = 0.8;
        g.w = 1 - smooth((t - p.tRel - 0.12) / 0.22);
      }
      if (!p.two) {
        body.free = (-lead) as 1 | -1;
        body.freeUp = 1 - smooth((t - p.tRel) / 0.3);
      }
    }
  }
  if (offG.w === 0 && leadG.w > 0 && !p.two && body.free === 0) body.free = (-lead) as 1 | -1;
  return out;
}

/** No hang after all (the dunk was blocked): come straight down from the release. */
export function cancelHang(p: DunkPlan) {
  if (!p.hangHands) return;
  p.hangHands = 0;
  const vRel = G * SLAM;
  p.tGrab = p.tLet = p.tRel;
  p.tLand = p.tRel + (-vRel + Math.sqrt(vRel * vRel + 2 * G * Math.max(0.05, p.relY))) / G;
  p.tEnd = p.tLand + 0.34;
  p.land.copy(p.relRoot).addScaledVector(p.dir, -0.25);
  p.land.y = 0;
}

const _h1 = new THREE.Vector3();
const _h2 = new THREE.Vector3();
const _h3 = new THREE.Vector3();

/** Where the ball is in a dunker's hands: between both palms, or in one, eased in off the dribble on the gather. */
export function dunkBallPos(c: Character, f: DunkFrame, p: DunkPlan, out: THREE.Vector3, dt: number): THREE.Vector3 {
  const lead = p.hand > 0 ? 'r' : 'l';
  const held = _h1;
  if (f.ball === 'two') {
    const l = c.palmBall('l', BALL_R * 0.92, _h2);
    c.palmBall('r', BALL_R * 0.92, held);
    // Palms that have slipped apart (an arm at full stretch) hand it to the lead hand.
    if (c.handWorld(_h3, 'l').distanceTo(c.handWorld(_n, 'r')) > BALL_R * 2.7) c.palmBall(lead, BALL_R * 0.97, held);
    else held.add(l).multiplyScalar(0.5);
  } else c.palmBall(lead, BALL_R * 0.97, held);
  if (f.ballIn < 1) out.lerp(held, Math.max(f.ballIn, Math.min(1, dt * 14)));
  else out.copy(held);
  return out;
}
