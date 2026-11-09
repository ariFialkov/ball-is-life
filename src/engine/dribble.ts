/**
 * One dribble, as physics rather than a canned loop.
 *
 * The hand rests on top of the ball, pushes it down (accelerating it over the
 * push), lets go, and the ball falls under gravity, bounces off the floor and
 * rises. The hand, after a short follow-through, comes back up and meets the
 * ball on its way up, then rides it up and cushions it to a stop at the top,
 * ready for the next push. The tempo is not a constant: it falls out of how
 * high the dribble is and how hard the hand pushes (a low, hard dribble is
 * quicker than a high, soft one).
 *
 * Heights are ball-centre / palm heights above the floor, in metres. Pure: no
 * three.js, so it is unit tested.
 */
import { BALL_R, GRAVITY } from './constants.ts';

const G = -GRAVITY;

export interface DribbleParams {
  /** Palm height at the top of the dribble (where the hand holds the ball at rest). */
  palmTop: number;
  /** Palm height where the push ends and the ball is let go. */
  palmRelease: number;
  /** Palm height where the hand meets the rising ball. */
  palmCatch: number;
  /** Seconds the hand spends pushing (rest to release). */
  push: number;
  /** Seconds the hand spends receiving (catch to rest). */
  cushion: number;
}

export interface DribbleTiming {
  /** Ball speed (down) as the hand lets go. */
  vRelease: number;
  /** Ball speed (up) as the hand meets it. */
  vCatch: number;
  /** Seconds from release to the floor. */
  down: number;
  /** Seconds from the floor to the catch. */
  up: number;
  /** Seconds for the whole dribble. */
  period: number;
  /** Fraction of the cycle at which the ball hits the floor. */
  bounceAt: number;
}

/** Time to fall `d` metres starting at speed `v` (downward) under gravity. */
function fallTime(d: number, v: number) {
  return (-v + Math.sqrt(v * v + 2 * G * Math.max(0, d))) / G;
}

export function dribbleTiming(p: DribbleParams): DribbleTiming {
  // The push accelerates the ball uniformly from rest; the cushion decelerates it uniformly to rest.
  const vRelease = (2 * (p.palmTop - p.palmRelease)) / p.push;
  const vCatch = (2 * (p.palmTop - p.palmCatch)) / p.cushion;
  const down = fallTime(p.palmRelease - BALL_R - BALL_R, vRelease);
  // Rising to the catch is the time-reverse of falling from it at the catch speed.
  const up = fallTime(p.palmCatch - BALL_R - BALL_R, vCatch);
  const period = p.push + down + up + p.cushion;
  return { vRelease, vCatch, down, up, period, bounceAt: (p.push + down) / period };
}

export interface DribbleSample {
  /** Ball centre height. */
  ball: number;
  /** Palm height (on top of the ball while in contact). */
  palm: number;
  /** Whether the hand is on the ball. */
  contact: boolean;
  /** 0..1 progress through the ball's flight (release → catch); 0 while in contact. */
  flight: number;
  /** Wrist flex (positive snaps the hand down through the push, negative cocks it back to receive). */
  wrist: number;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** The ball and the hand at `u` (0..1) through one dribble, starting with the hand at rest on top. */
export function dribbleAt(p: DribbleParams, tm: DribbleTiming, u: number): DribbleSample {
  const tau = (((u % 1) + 1) % 1) * tm.period;
  const R = BALL_R;
  if (tau < p.push) {
    // Pushing: uniform acceleration from rest.
    const s = tau / p.push;
    const palm = p.palmTop - (p.palmTop - p.palmRelease) * s * s;
    return { ball: palm - R, palm, contact: true, flight: 0, wrist: -0.35 + 0.8 * smooth(s) };
  }
  const flightTime = tm.down + tm.up;
  const tf = tau - p.push;
  if (tf < flightTime) {
    let ball: number;
    if (tf < tm.down) ball = p.palmRelease - R - tm.vRelease * tf - 0.5 * G * tf * tf;
    else {
      const tu = tf - tm.down;
      const vUp = tm.vCatch + G * tm.up;
      ball = R + vUp * tu - 0.5 * G * tu * tu;
    }
    // The hand: a short follow-through after the release, then up to meet the ball moving with it.
    const s = tf / flightTime;
    const m0 = -0.25 * flightTime;
    const m1 = tm.vCatch * flightTime;
    const s2 = s * s;
    const s3 = s2 * s;
    const palm = (2 * s3 - 3 * s2 + 1) * p.palmRelease + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p.palmCatch + (s3 - s2) * m1;
    const wrist = 0.45 - 0.95 * smooth(s);
    return { ball, palm: Math.max(palm, ball + R), contact: false, flight: s, wrist };
  }
  // Cushioning: uniform deceleration to rest at the top.
  const s = Math.min(1, (tf - flightTime) / p.cushion);
  const palm = p.palmTop - (p.palmTop - p.palmCatch) * (1 - s) * (1 - s);
  return { ball: palm - R, palm, contact: true, flight: 0, wrist: -0.5 + 0.15 * smooth(s) };
}
