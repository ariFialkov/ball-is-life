import { describe, expect, it } from 'vitest';
import { BALL_R } from '../src/engine/constants.ts';
import { dribbleAt, dribbleTiming, type DribbleParams } from '../src/engine/dribble.ts';

const standing: DribbleParams = { palmTop: 0.98, palmRelease: 0.76, palmCatch: 0.86, push: 0.1, cushion: 0.095 };
const speed: DribbleParams = { palmTop: 1.02, palmRelease: 0.78, palmCatch: 0.9, push: 0.08, cushion: 0.08 };

describe('dribble physics', () => {
  it('has a realistic tempo, quicker when pushed harder', () => {
    const a = dribbleTiming(standing);
    const b = dribbleTiming(speed);
    expect(a.period).toBeGreaterThan(0.38);
    expect(a.period).toBeLessThan(0.7);
    expect(b.period).toBeLessThan(a.period);
    // Floor speed and restitution in a plausible range.
    const vFloor = a.vRelease + 9.81 * a.down;
    const vUp = a.vCatch + 9.81 * a.up;
    expect(vUp / vFloor).toBeGreaterThan(0.6);
    expect(vUp / vFloor).toBeLessThan(1.05);
  });

  for (const [name, p] of [['standing', standing], ['speed', speed]] as const) {
    it(`${name}: the ball is continuous, hits the floor once, and the hand never passes through it`, () => {
      const tm = dribbleTiming(p);
      const N = 2000;
      let prev = dribbleAt(p, tm, 0);
      let minBall = Infinity;
      let maxStep = 0;
      for (let i = 1; i <= N; i++) {
        const s = dribbleAt(p, tm, i / N);
        minBall = Math.min(minBall, s.ball);
        maxStep = Math.max(maxStep, Math.abs(s.ball - prev.ball));
        expect(s.palm).toBeGreaterThanOrEqual(s.ball + BALL_R - 1e-9);
        if (s.contact) expect(s.palm - s.ball).toBeCloseTo(BALL_R, 6);
        prev = s;
      }
      expect(minBall).toBeGreaterThan(BALL_R - 0.01);
      expect(minBall).toBeLessThan(BALL_R + 0.01);
      // No jumps: the most the ball moves in 1/2000 of a cycle is what ~6 m/s allows.
      expect(maxStep).toBeLessThan((6 * tm.period) / N + 1e-3);
      // It starts and ends at rest on top.
      expect(dribbleAt(p, tm, 0).palm).toBeCloseTo(p.palmTop, 6);
      expect(dribbleAt(p, tm, 0.99999).palm).toBeCloseTo(p.palmTop, 3);
    });
  }
});
