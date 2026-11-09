import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Ball } from '../src/engine/ball.ts';
import { RIM_X, THREE_R } from '../src/engine/constants.ts';
import { launchJumper, plannedMiss, releaseError, settleShot } from '../src/contests/shotPhysics.ts';

/** 3-point contest spots: five racks around the arc plus the two deep "starry" spots. */
function spots(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const deg of [-75, -40, 0, 40, 75]) {
    const a = (deg * Math.PI) / 180;
    const r = THREE_R + 0.3;
    out.push(new THREE.Vector3(RIM_X - Math.cos(a) * r, 2.35, Math.sin(a) * r));
  }
  for (const deg of [-22, 22]) {
    const a = (deg * Math.PI) / 180;
    out.push(new THREE.Vector3(RIM_X - Math.cos(a) * (THREE_R + 1.85), 2.4, Math.sin(a) * (THREE_R + 1.85)));
  }
  return out;
}

const shoot = (from: THREE.Vector3, err: { long: number; side: number }) => {
  const b = new Ball();
  launchJumper(b, from, 1, err, 0, 1);
  return settleShot(b);
};

describe('contest shot physics', () => {
  it('a perfect release goes in from every rack and deep spot', () => {
    for (const s of spots()) expect(shoot(s, { long: 0, side: 0 })).toBe(true);
  });
  it('planned bot misses never go in', () => {
    for (const s of spots()) for (let k = 0; k < 4; k++) expect(shoot(s, plannedMiss(k))).toBe(false);
  });
  it('skills-course layups: clean ones go in from either side, planned misses never do', () => {
    for (const side of [1, -1] as const) {
      for (const d of [0.6, 1.0, 1.5, 2.2]) {
        for (const z of [-0.6, 0, 0.5]) {
          const from = new THREE.Vector3(side * (RIM_X - d), 2.85, z);
          const b = new Ball();
          launchJumper(b, from, side, { long: 0, side: 0 }, 0, 2);
          expect(settleShot(b)).toBe(true);
          for (let k = 0; k < 4; k++) {
            const m = new Ball();
            launchJumper(m, from, side, plannedMiss(k, true), 0, 2);
            expect(settleShot(m)).toBe(false);
          }
        }
      }
    }
  });
  it('top-of-the-key threes at the other basket', () => {
    const from = new THREE.Vector3(-RIM_X + 7.6, 2.35, 0);
    const b = new Ball();
    launchJumper(b, from, -1, { long: 0, side: 0 }, 0, 3);
    expect(settleShot(b)).toBe(true);
    for (let k = 0; k < 4; k++) {
      const m = new Ball();
      launchJumper(m, from, -1, plannedMiss(k), 0, 3);
      expect(settleShot(m)).toBe(false);
    }
  });
  it('release heights from short guards to tall wings', () => {
    for (const y of [2.2, 2.38, 2.55]) for (const s of spots()) expect(shoot(new THREE.Vector3(s.x, y, s.z), { long: 0, side: 0 })).toBe(true);
  });
  it('layups and short jumpers work too', () => {
    for (const d of [1.2, 2, 3.5, 5]) expect(shoot(new THREE.Vector3(RIM_X - d, 2.4, 0.3), { long: 0, side: 0 })).toBe(true);
  });
  it('make rate falls off smoothly with release timing', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const rate = (q: number) => {
      let made = 0;
      const n = 300;
      const from = spots();
      for (let i = 0; i < n; i++) if (shoot(from[i % from.length], releaseError(q, 85, rnd))) made++;
      return made / n;
    };
    const green = rate(1);
    const good = rate(0.8);
    const off = rate(0.5);
    const bad = rate(0.15);
    console.log(`make rate: green ${green.toFixed(2)} good ${good.toFixed(2)} off ${off.toFixed(2)} bad ${bad.toFixed(2)}`);
    expect(green).toBeGreaterThan(0.85);
    expect(good).toBeGreaterThan(off);
    expect(off).toBeGreaterThan(bad);
    expect(bad).toBeLessThan(0.2);
  });
});
