import type { MatchScript } from '../core/casino/types.ts';
import { clamp } from '../core/rng.ts';

export interface CareerSteer {
  targetPoints: number;
  targetAssists: number;
  targetRebounds: number;
}

export interface DirectorMods {
  /** multipliers on make-probability for the user's team and the opponent */
  userShot: number;
  oppShot: number;
  /** multiplier on the chance that the opponent steals/intercepts from the user's team */
  oppSteal: number;
  /** multiplier on the chance that the user's team steals/intercepts */
  userSteal: number;
  /** rebound bias: >1 favours the opponent */
  oppReb: number;
  /** 0..1 endgame force level, >0 means the script is in danger and bots play "perfect" */
  force: number;
  /** direction the force pushes the margin (+1 = towards the user) */
  forceDir: 1 | -1 | 0;
  /** career: how strongly teammates look for the user (0..1, 0.5 = neutral) */
  feedUser: number;
  /** career: extra multiplier applied to the user's own shots */
  userPlayerShot: number;
  targetMargin: number;
  error: number;
}

/**
 * The on-court director. It knows the predetermined result and continuously
 * tunes the bots' effectiveness so the live score tracks the scripted margin
 * trajectory and lands on the scripted outcome. The user's inputs still
 * matter moment to moment (which is what makes the game feel like a sport),
 * but the bots always have enough leverage to close the loop.
 */
export class Director {
  readonly script: MatchScript;
  readonly career: CareerSteer | null;
  /** for telemetry */
  lastMods: DirectorMods | null = null;

  /** Checkpoint amplitude scale: scripts are authored for full-length games, short games get proportionally smaller swings. */
  readonly scale: number;
  readonly finalMargin: number;

  constructor(script: MatchScript, career: CareerSteer | null = null, quarterLength = 240) {
    this.script = script;
    this.career = career;
    this.scale = clamp(quarterLength / 240, 0.35, 1);
    this.finalMargin = Math.max(1, Math.round(script.margin * this.scale)) * (script.userWins ? 1 : -1);
  }

  targetMargin(t01: number): number {
    const c = this.script.checkpoints;
    const u = clamp(t01, 0, 1) * (c.length - 1);
    const i = Math.floor(u);
    const f = u - i;
    const at = (k: number) => (k >= c.length - 1 ? this.finalMargin : c[k] * this.scale);
    if (i >= c.length - 1) return this.finalMargin;
    return at(i) + (at(i + 1) - at(i)) * f;
  }

  /**
   * @param t01 fraction of regulation elapsed (can exceed 1 in overtime)
   * @param margin current (user - opp) score margin
   * @param remaining seconds remaining in the current period (regulation or OT)
   * @param userStats optional career stat line of the user's player so far
   * @param gameFraction fraction of game time the user has played so far (career)
   */
  mods(t01: number, margin: number, remaining: number, userStats?: { pts: number; ast: number; reb: number }, gameFraction = t01): DirectorMods {
    const target = this.targetMargin(t01);
    const error = margin - target;
    // Gain ramps up through the game so early play feels loose and late play is tight.
    const k = 0.1 + Math.min(1, t01) * Math.min(1, t01) * 0.45;
    let userShot = clamp(Math.exp(-k * error), 0.08, 2.4);
    let oppShot = clamp(Math.exp(k * error), 0.08, 2.4);
    let oppSteal = clamp(Math.exp(k * error * 0.8), 0.3, 4);
    let userSteal = clamp(Math.exp(-k * error * 0.8), 0.3, 4);
    let oppReb = clamp(Math.exp(k * error * 0.5), 0.5, 2.5);

    // Endgame protection: when the clock is short and the scripted winner is
    // not comfortably ahead, the bots stop missing (or stop making) entirely.
    const need: 1 | -1 = this.script.userWins ? 1 : -1;
    let force = 0;
    let forceDir: 1 | -1 | 0 = 0;
    const late = t01 >= 0.72;
    if (late) {
      const cushion = margin * need; // positive when the scripted winner leads
      const secs = Math.max(0, remaining);
      // Required cushion grows as the end approaches less time means we need to be in front already.
      const needed = secs < 15 ? 3 : secs < 40 ? 1 : secs < 75 ? -4 : -10;
      if (cushion < needed) {
        force = clamp(1 - (cushion - needed) / 8, 0.35, 1);
        forceDir = need;
      } else if (secs < 25 && cushion < 6) {
        // Close but correct: hold the line without letting the lead evaporate.
        force = 0.35;
        forceDir = need;
      }
    }
    if (force > 0) {
      if (forceDir > 0) {
        userShot = Math.max(userShot, 1 + force * 1.6);
        oppShot = Math.min(oppShot, 1 - force * 0.98);
        userSteal = Math.max(userSteal, 1 + force * 4);
        oppSteal = Math.min(oppSteal, 1 - force * 0.9);
        oppReb = Math.min(oppReb, 1 - force * 0.7);
      } else {
        oppShot = Math.max(oppShot, 1 + force * 1.6);
        userShot = Math.min(userShot, 1 - force * 0.98);
        oppSteal = Math.max(oppSteal, 1 + force * 4);
        userSteal = Math.min(userSteal, 1 - force * 0.9);
        oppReb = Math.max(oppReb, 1 + force * 1.5);
      }
    }

    // Career steering of the user's individual stat line.
    let feedUser = 0.5;
    let userPlayerShot = 1;
    if (this.career && userStats) {
      const pace = clamp(gameFraction, 0.05, 1);
      const ptsError = userStats.pts - this.career.targetPoints * pace;
      feedUser = clamp(0.5 - ptsError * 0.08, 0.1, 0.95);
      userPlayerShot = clamp(Math.exp(-ptsError * 0.18), 0.15, 2.2);
      const astError = userStats.ast - this.career.targetAssists * pace;
      if (astError < -0.5) feedUser = Math.max(feedUser, 0.6);
    }

    const m: DirectorMods = { userShot, oppShot, oppSteal, userSteal, oppReb, force, forceDir, feedUser, userPlayerShot, targetMargin: target, error };
    this.lastMods = m;
    return m;
  }
}
