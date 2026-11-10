/**
 * Instant replay: a rolling recording of what was drawn (every player's root transform, hips and
 * bone rotations, and the ball), and playback of a stretch of it. Playback only rewrites the scene
 * graph; the match itself is simply not updated while a replay runs, so a replay can never affect
 * the game. The next match update puts every transform back where the simulation has it.
 */
import type * as THREE from 'three';
import type { Match } from './match.ts';
import type { Character } from '../engine/character.ts';

const RATE = 60;
const SECONDS = 6;

interface Rig {
  char: Character;
  bones: THREE.Bone[];
}

export class ReplayRecorder {
  private rigs: Rig[];
  private stride: number;
  private buf: Float32Array;
  private times: Float64Array;
  private cap = RATE * SECONDS;
  private head = 0;
  private count = 0;
  private acc = 0;
  /** Recorder clock (seconds of recorded play). */
  time = 0;

  constructor(private match: Match) {
    this.rigs = match.athletes.map((a) => ({ char: a.char, bones: Object.values(a.char.bones) as THREE.Bone[] }));
    // Per player: root x,y,z, yaw, visible, hips x,y,z, then bones (x,y,z each). Then the ball (x,y,z, rx, rz).
    this.stride = this.rigs.reduce((n, r) => n + 8 + r.bones.length * 3, 0) + 5;
    this.buf = new Float32Array(this.cap * this.stride);
    this.times = new Float64Array(this.cap);
  }

  /** Record the current frame (call after the match update, at most RATE times a second). */
  capture(dt: number) {
    this.time += dt;
    this.acc += dt;
    if (this.acc < 1 / RATE - 1e-6 && this.count) return;
    this.acc = 0;
    this.write(this.buf, this.head * this.stride);
    this.times[this.head] = this.time;
    this.head = (this.head + 1) % this.cap;
    this.count = Math.min(this.cap, this.count + 1);
  }

  /** The scene as it is right now (to put back after a replay). */
  snapshot(): Float32Array {
    const f = new Float32Array(this.stride);
    this.write(f, 0);
    return f;
  }

  private write(b: Float32Array, o: number) {
    let i = o;
    for (const r of this.rigs) {
      const root = r.char.root;
      b[i++] = root.position.x;
      b[i++] = root.position.y;
      b[i++] = root.position.z;
      b[i++] = root.rotation.y;
      b[i++] = root.visible ? 1 : 0;
      const hips = r.char.hips.position;
      b[i++] = hips.x;
      b[i++] = hips.y;
      b[i++] = hips.z;
      for (const bone of r.bones) {
        b[i++] = bone.rotation.x;
        b[i++] = bone.rotation.y;
        b[i++] = bone.rotation.z;
      }
    }
    const m = this.match.ball.mesh;
    b[i++] = m.position.x;
    b[i++] = m.position.y;
    b[i++] = m.position.z;
    b[i++] = m.rotation.x;
    b[i++] = m.rotation.z;
  }

  /** Copy out the frames recorded between two recorder times (oldest first). */
  clip(t0: number, t1: number): Clip | null {
    const frames: Float32Array[] = [];
    const times: number[] = [];
    for (let k = this.count; k >= 1; k--) {
      const idx = (this.head - k + this.cap) % this.cap;
      const t = this.times[idx];
      if (t < t0 || t > t1) continue;
      frames.push(this.buf.slice(idx * this.stride, (idx + 1) * this.stride));
      times.push(t);
    }
    if (frames.length < 10) return null;
    return { frames, times };
  }

  /** Draw a recorded frame. */
  apply(f: Float32Array) {
    let i = 0;
    for (const r of this.rigs) {
      const root = r.char.root;
      root.position.set(f[i], f[i + 1], f[i + 2]);
      root.rotation.y = f[i + 3];
      root.visible = f[i + 4] > 0.5;
      r.char.hips.position.set(f[i + 5], f[i + 6], f[i + 7]);
      i += 8;
      for (const bone of r.bones) {
        bone.rotation.set(f[i], f[i + 1], f[i + 2]);
        i += 3;
      }
    }
    this.match.ball.showAt(f[i], f[i + 1], f[i + 2], f[i + 3], f[i + 4]);
  }

  /** Where the ball was in a frame. */
  ballIn(f: Float32Array, out: THREE.Vector3) {
    const i = this.stride - 5;
    return out.set(f[i], f[i + 1], f[i + 2]);
  }
}

export interface Clip {
  frames: Float32Array[];
  times: number[];
}
