import * as THREE from 'three';
import type { Ball } from '../engine/ball.ts';
import { RIM_H, RIM_X } from '../engine/constants.ts';

/**
 * Pure shot physics for the All-Star contests. A shot is aimed at the centre
 * of the rim and launched on a real parabola; the release error moves the
 * point where the ball crosses rim height. Whether it goes in is then decided
 * only by the ball physics (rim, backboard and net collisions): there is no
 * assist, so a contest result is exactly what the ball did.
 */
export interface ShotError {
  /** Metres past (+) or short (-) of the rim centre, along the line of the shot. */
  long: number;
  /** Metres left/right of the rim centre. */
  side: number;
}

/**
 * Flight time that brings the ball down through the rim at `entryDeg` (a real
 * jumper enters at about 45 degrees; much flatter and it clips the front rim).
 * Solved from the parabola: tan(entry) * d = 0.5 g T^2 - dy.
 */
export function flightTime(dist: number, dy = 0.7, entryDeg = 46): number {
  const t = Math.sqrt((2 * (Math.tan((entryDeg * Math.PI) / 180) * dist + dy)) / 9.81);
  return Math.min(1.6, Math.max(0.45, t));
}

/** Launch a jumper from `from` toward the rim on `side`, missing the centre by `err`. */
export function launchJumper(ball: Ball, from: THREE.Vector3, side: 1 | -1, err: ShotError, now: number, value: number, flight?: number) {
  const rx = side * RIM_X;
  const dx = rx - from.x;
  const dz = -from.z;
  const d = Math.hypot(dx, dz) || 1;
  const fx = dx / d;
  const fz = dz / d;
  const target = new THREE.Vector3(rx + fx * err.long - fz * err.side, RIM_H, fz * err.long + fx * err.side);
  ball.pos.copy(from);
  ball.mode = 'shot';
  ball.events.length = 0;
  ball.shot = { side, willMake: false, shooterTeam: 0, shooterIndex: 0, value: value as 2 | 3, releasedAt: now, scored: false, touchedRim: false };
  ball.launchTo(target, flight ?? flightTime(d, RIM_H - from.y));
}

/** A release error for a timing quality q (0..1) and the shooter's rating (0..100). */
export function releaseError(q: number, rating: number, rnd: () => number): ShotError {
  // Perfect timing still carries a little rating-based noise; bad timing sprays mostly long/short.
  const spread = Math.pow(1 - Math.min(1, Math.max(0, q)), 1.25) * 0.85 + (1 - rating / 100) * 0.07;
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { long: gauss() * spread * 0.85, side: gauss() * spread * 0.45 };
}

/** Planned misses for bots: far enough off that the physics can never rattle them in. */
export function plannedMiss(kind: number, close = false): ShotError {
  if (close) {
    // From layup range a long miss can bank in off the glass: miss short or wide instead.
    switch (kind % 4) {
      case 0:
        return { long: -0.5, side: 0.1 };
      case 1:
        return { long: 0.1, side: 0.52 };
      case 2:
        return { long: 0.05, side: -0.52 };
      default:
        return { long: -0.45, side: -0.35 };
    }
  }
  switch (kind % 4) {
    case 0:
      return { long: 0.42, side: 0.05 }; // back rim
    case 1:
      return { long: -0.4, side: -0.04 }; // front rim
    case 2:
      return { long: 0.1, side: 0.4 }; // off the side of the rim
    default:
      return { long: 0.05, side: -0.42 };
  }
}

/** Run a launched shot to completion with the real physics (used by tests and instant-sims). */
export function settleShot(ball: Ball, maxT = 4): boolean {
  let t = 0;
  const dt = 1 / 120;
  while (t < maxT) {
    ball.step(dt, t);
    t += dt;
    if (ball.shot?.scored) return true;
    if (ball.pos.y < 1.2 && ball.vel.y < 0) return false;
  }
  return !!ball.shot?.scored;
}
