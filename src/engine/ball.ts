import * as THREE from 'three';
import { BACKBOARD_BOTTOM, BACKBOARD_H, BACKBOARD_W, BACKBOARD_X, BALL_R, GRAVITY, RIM_H, RIM_R, RIM_TUBE, RIM_X } from './constants.ts';

export type BallMode = 'held' | 'dribble' | 'shot' | 'pass' | 'loose';
/** Contest balls: regular, the red-white-blue money ball, and the deep 'starry' ball. */
export type BallStyle = 'standard' | 'money' | 'starry';

const textureCache: Partial<Record<BallStyle, THREE.Texture>> = {};
/** Linear air drag (1/s), shared by the integrator and the launch solver. */
const AIR_DRAG = 0.02;

export interface BallEvent {
  type: 'rim' | 'backboard' | 'floor' | 'score' | 'net';
  side: 1 | -1;
  strength: number;
}

/** Ball mesh + ballistic physics with rim / backboard / floor collisions. */
export class Ball {
  readonly mesh: THREE.Mesh;
  readonly pos = new THREE.Vector3(0, BALL_R, 0);
  readonly vel = new THREE.Vector3();
  readonly spin = new THREE.Vector3();
  mode: BallMode = 'loose';
  /** Set when a shot is in the air: which basket (side) it is aimed at and whether it is scripted to go in. */
  shot: { side: 1 | -1; willMake: boolean; shooterTeam: number; shooterIndex: number; value: 2 | 3; releasedAt: number; scored: boolean; touchedRim: boolean; reject?: boolean; dunk?: boolean } | null = null;
  pass: { fromTeam: number; fromIndex: number; toIndex: number; launchedAt: number; style?: 'chest' | 'bounce' | 'lob'; flight?: number } | null = null;
  events: BallEvent[] = [];
  lastTouchTeam = -1;
  private shadow: THREE.Mesh;
  private lastFloorBounce = 0;

  constructor(style: BallStyle = 'standard') {
    // No DOM (unit tests): physics only, no texture.
    const tex = typeof document === 'undefined' ? null : (textureCache[style] ??= makeBallTexture(style));
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 18), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65, metalness: 0 }));
    this.mesh.castShadow = true;
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.1, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
  }

  addTo(scene: THREE.Object3D) {
    scene.add(this.mesh, this.shadow);
  }

  removeFrom(scene: THREE.Object3D) {
    scene.remove(this.mesh, this.shadow);
  }

  /** Place the ball at a position with no velocity. */
  place(x: number, y: number, z: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
  }

  /** Launch towards a target point with a given flight time (solves the parabola). */
  launchTo(target: THREE.Vector3, flightTime: number) {
    const dx = target.x - this.pos.x;
    const dy = target.y - this.pos.y;
    const dz = target.z - this.pos.z;
    // Solve with the same linear air drag the integrator applies, so the ball arrives exactly on target.
    const k = AIR_DRAG;
    const T = flightTime;
    const f = k / (1 - Math.exp(-k * T));
    this.vel.set(dx * f, (dy - (GRAVITY * T) / k) * f + GRAVITY / k, dz * f);
    this.spin.set(0, 0, 0);
  }

  /** Physics step for free-flight modes (shot, pass, loose). */
  step(dt: number, now: number) {
    if (this.mode === 'held' || this.mode === 'dribble') return;
    // Fixed-size substeps (at most 1/360s) so rim and glass contacts come out the same at any frame rate.
    const sub = Math.max(3, Math.ceil(dt * 360 - 1e-6));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this.integrate(h, now);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.x += this.vel.z * dt * 4;
    this.mesh.rotation.z -= this.vel.x * dt * 4;
    this.shadow.position.set(this.pos.x, 0.01, this.pos.z);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.05, 0.3 - this.pos.y * 0.05);
  }

  /** Update visual position when held (position set externally). */
  /** Draw the ball somewhere without touching its physical state (replays). */
  showAt(x: number, y: number, z: number, rx = this.mesh.rotation.x, rz = this.mesh.rotation.z) {
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.x = rx;
    this.mesh.rotation.z = rz;
    this.shadow.position.set(x, 0.01, z);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.05, 0.3 - y * 0.05);
  }

  syncVisual() {
    this.mesh.position.copy(this.pos);
    this.shadow.position.set(this.pos.x, 0.01, this.pos.z);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.05, 0.3 - this.pos.y * 0.05);
  }

  private integrate(h: number, now: number) {
    const p = this.pos;
    const v = this.vel;
    const prevY = p.y;
    const prevX = p.x;
    v.y += GRAVITY * h;
    // Mild air drag.
    v.multiplyScalar(1 - AIR_DRAG * h);
    p.addScaledVector(v, h);

    // Scoring check: crossing the rim plane downward inside the cylinder.
    if (this.shot && !this.shot.scored && !this.shot.reject) {
      const side = this.shot.side;
      const rx = side * RIM_X;
      if (prevY >= RIM_H && p.y < RIM_H && v.y < 0) {
        const d = Math.hypot(p.x - rx, p.z);
        if (d < RIM_R - BALL_R * 0.35) {
          this.shot.scored = true;
          this.events.push({ type: 'score', side, strength: 1 });
          // The net slows the ball down.
          v.x *= 0.25;
          v.z *= 0.25;
          v.y *= 0.45;
        }
      }
    }
    // Rim collision (torus).
    for (const side of [1, -1] as const) {
      const rx = side * RIM_X;
      const dxz = Math.hypot(p.x - rx, p.z);
      if (Math.abs(p.y - RIM_H) < BALL_R + RIM_TUBE + 0.05 && Math.abs(dxz - RIM_R) < BALL_R + RIM_TUBE + 0.05) {
        // Closest point on the ring.
        const nx = dxz > 1e-5 ? (p.x - rx) / dxz : 1;
        const nz = dxz > 1e-5 ? p.z / dxz : 0;
        const cx = rx + nx * RIM_R;
        const cz = nz * RIM_R;
        const ex = p.x - cx;
        const ey = p.y - RIM_H;
        const ez = p.z - cz;
        const dist = Math.hypot(ex, ey, ez);
        const minDist = BALL_R + RIM_TUBE;
        if (dist < minDist && dist > 1e-5 && this.shot?.reject && !this.shot.touchedRim) {
          // A missed dunk: hammered onto the iron, it kicks up and out (never rattles in).
          v.set(nx * 2.6, 3.4, nz * 2.6);
          p.set(cx + nx * (minDist + 0.01), RIM_H + 0.02, cz + nz * (minDist + 0.01));
          this.shot.touchedRim = true;
          this.events.push({ type: 'rim', side, strength: 1 });
        } else if (dist < minDist && dist > 1e-5) {
          const n = new THREE.Vector3(ex / dist, ey / dist, ez / dist);
          const vn = v.dot(n);
          if (vn < 0) {
            // If the shot is scripted to go in, soften the rim so it rattles home.
            const soft = this.shot && this.shot.willMake && !this.shot.scored ? 0.25 : 0.62;
            v.addScaledVector(n, -(1 + soft) * vn);
            // Scripted makes get nudged toward the centre of the hoop.
            if (this.shot && this.shot.willMake && !this.shot.scored) {
              v.x += (rx - p.x) * 1.5;
              v.z += -p.z * 1.5;
              v.y = Math.min(v.y, 0.4);
            }
            v.multiplyScalar(0.92);
            this.events.push({ type: 'rim', side, strength: Math.min(1, Math.abs(vn) / 6) });
            if (this.shot) this.shot.touchedRim = true;
          }
          p.copy(n.multiplyScalar(minDist + 0.001).add(new THREE.Vector3(cx, RIM_H, cz)));
        }
      }
      // Backboard collision.
      const bx = side * BACKBOARD_X;
      if (p.y > BACKBOARD_BOTTOM - BALL_R && p.y < BACKBOARD_BOTTOM + BACKBOARD_H + BALL_R && Math.abs(p.z) < BACKBOARD_W / 2 + BALL_R) {
        const frontX = bx - side * BALL_R;
        const crossed = side > 0 ? prevX <= frontX && p.x > frontX : prevX >= frontX && p.x < frontX;
        const inside = side > 0 ? p.x > frontX && p.x < bx + 0.1 : p.x < frontX && p.x > bx - 0.1;
        if ((crossed || inside) && v.x * side > 0) {
          p.x = frontX;
          v.x = -v.x * (this.shot && this.shot.willMake && !this.shot.scored ? 0.35 : 0.55);
          v.y *= 0.9;
          v.z *= 0.9;
          if (this.shot && this.shot.willMake && !this.shot.scored) {
            // Bank it in: aim the rebound at the rim centre.
            v.z += -p.z * 2.0;
            v.y = Math.max(v.y, -1.5);
          }
          this.events.push({ type: 'backboard', side, strength: Math.min(1, Math.abs(v.x) / 5) });
        }
      }
      // Stanchion / post crude collision.
      const px = side * (RIM_X + 1.575 + 1.4);
      if (Math.abs(p.x - px) < 0.3 + BALL_R && Math.abs(p.z) < 0.3 + BALL_R && p.y < 3.9) {
        v.x = -v.x * 0.5;
        p.x = px - side * (0.3 + BALL_R + 0.01);
      }
    }
    // Floor.
    if (p.y < BALL_R) {
      p.y = BALL_R;
      if (v.y < 0) {
        const strength = Math.min(1, -v.y / 8);
        v.y = -v.y * 0.72;
        v.x *= 0.85;
        v.z *= 0.85;
        if (Math.abs(v.y) < 0.6) v.y = 0;
        if (now - this.lastFloorBounce > 0.08 && strength > 0.04) {
          this.events.push({ type: 'floor', side: p.x > 0 ? 1 : -1, strength });
          this.lastFloorBounce = now;
        }
      }
      // Rolling friction.
      v.x *= 1 - 1.2 * h;
      v.z *= 1 - 1.2 * h;
    }
    // Ceiling safety.
    if (p.y > 14) {
      p.y = 14;
      v.y = Math.min(0, v.y);
    }
  }

  get isResting() {
    return this.pos.y <= BALL_R + 0.01 && this.vel.lengthSq() < 0.05;
  }
}

function makeBallTexture(style: BallStyle = 'standard'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  if (style !== 'standard') return paintContestBall(c, ctx, style);
  ctx.fillStyle = '#d9641e';
  ctx.fillRect(0, 0, 512, 256);
  // Subtle pebble noise.
  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
  }
  ctx.strokeStyle = '#1a0d05';
  ctx.lineWidth = 7;
  // Seams in equirectangular space.
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(512, 128);
  ctx.stroke();
  for (const x of [0, 128, 256, 384, 512]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(64, 0);
  ctx.bezierCurveTo(140, 90, 140, 166, 64, 256);
  ctx.moveTo(320, 0);
  ctx.bezierCurveTo(396, 90, 396, 166, 320, 256);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Money ball (red, white and blue panels) and the deep 'starry' ball. */
function paintContestBall(c: HTMLCanvasElement, ctx: CanvasRenderingContext2D, style: BallStyle): THREE.CanvasTexture {
  if (style === 'money') {
    const cols = ['#c8102e', '#f4f4f4', '#0b3a8c', '#f4f4f4'];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = cols[i];
      ctx.fillRect(i * 128, 0, 128, 256);
    }
  } else {
    ctx.fillStyle = '#0b1e4a';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#ffd166';
    for (let i = 0; i < 40; i++) {
      const x = (i * 97) % 512;
      const y = (i * 53) % 256;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 5 : 12;
        const a = (k * Math.PI) / 5;
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.fill();
    }
  }
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(512, 128);
  ctx.stroke();
  for (const x of [0, 128, 256, 384]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
