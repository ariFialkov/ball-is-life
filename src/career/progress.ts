/**
 * MyCareer progression: performance grades from the real stat line, the
 * incentive bonuses they earn, playing time, and the career events that
 * reconcile what the player has earned with the predetermined payout.
 *
 * The outcome ticket fixes the total the career pays (T, in bet multiples)
 * and the maximum number of games. Everything the player sees game to game is
 * earned on the court; the ticket is honoured through what happens to the
 * career: a freak injury, a contract call that goes wrong, a locker-room
 * fallout or a trade too many when the player has banked more than T; an
 * extension, a shoe deal or a retirement tour when they have banked less.
 *
 * Pure: no DOM, no three.js, so it is unit tested.
 */
import type { Position } from '../data/teams.ts';

export interface GameLine {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  to: number;
}

export interface GradeInput {
  line: GameLine;
  pos: Position;
  /** 0 for the first game of the career. */
  gameIndex: number;
  /** Share of regulation the player was actually on the floor (0..1). */
  minutesFrac: number;
  /** Seconds per quarter (stat volume scales with game length). */
  quarterLength: number;
  teamWon: boolean;
}

export interface GradeResult {
  /** 0..5: F, D, C, B, A, A+ */
  grade: number;
  score: number;
  /** Short notes on what drove the grade (best and worst against expectations). */
  notes: string[];
}

export const GRADES = ['F', 'D', 'C', 'B', 'A', 'A+'];

type Counting = 'pts' | 'reb' | 'ast' | 'stl' | 'blk';
const COUNTING: Counting[] = ['pts', 'reb', 'ast', 'stl', 'blk'];
const LABEL: Record<Counting, string> = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', stl: 'Steals', blk: 'Blocks' };

/** One team's typical output in this game's scale (four 2-minute quarters). */
const TEAM_GAME: Record<Counting | 'to', number> = { pts: 27, reb: 10, ast: 8, stl: 3, blk: 3, to: 4 };

/** What share of the team's numbers each position is expected to produce. */
const SHARE: Record<Position, Record<Counting, number>> = {
  PG: { pts: 0.22, reb: 0.1, ast: 0.4, stl: 0.28, blk: 0.04 },
  SG: { pts: 0.25, reb: 0.13, ast: 0.2, stl: 0.24, blk: 0.07 },
  SF: { pts: 0.21, reb: 0.18, ast: 0.16, stl: 0.2, blk: 0.12 },
  PF: { pts: 0.17, reb: 0.26, ast: 0.13, stl: 0.15, blk: 0.27 },
  C: { pts: 0.15, reb: 0.33, ast: 0.11, stl: 0.13, blk: 0.5 },
};

/** How much each stat matters for each position. */
const WEIGHT: Record<Position, Record<Counting, number>> = {
  PG: { pts: 1.0, reb: 0.3, ast: 1.0, stl: 0.5, blk: 0.1 },
  SG: { pts: 1.0, reb: 0.35, ast: 0.5, stl: 0.5, blk: 0.15 },
  SF: { pts: 1.0, reb: 0.6, ast: 0.45, stl: 0.45, blk: 0.3 },
  PF: { pts: 0.9, reb: 0.9, ast: 0.3, stl: 0.3, blk: 0.6 },
  C: { pts: 0.8, reb: 1.0, ast: 0.25, stl: 0.25, blk: 0.8 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Expectations rise through a career: a rookie's first games are judged
 * gently (five points can be a good night), a veteran's harshly.
 */
export function stageFactor(gameIndex: number): number {
  return clamp(0.62 + 0.12 * gameIndex, 0.62, 1.3);
}

export function expected(pos: Position, stat: Counting, gameIndex: number, minutesFrac: number, quarterLength: number): number {
  return TEAM_GAME[stat] * SHARE[pos][stat] * clamp(minutesFrac, 0.08, 1) * (quarterLength / 120) * stageFactor(gameIndex);
}

export function gradeGame(g: GradeInput): GradeResult {
  const parts: { stat: Counting; c: number; actual: number; exp: number }[] = [];
  let sum = 0;
  let wsum = 0;
  for (const k of COUNTING) {
    const exp = expected(g.pos, k, g.gameIndex, g.minutesFrac, g.quarterLength);
    const actual = g.line[k];
    const c = clamp(Math.log2((actual + 1) / (exp + 1)), -1.6, 1.8);
    const w = WEIGHT[g.pos][k];
    sum += w * c;
    wsum += w;
    parts.push({ stat: k, c, actual, exp });
  }
  // A short stint is a small sample: it moves the grade less.
  const confidence = clamp(g.minutesFrac / 0.35, 0.45, 1);
  let score = (sum / wsum) * confidence;
  const notes: string[] = [];
  // Shooting efficiency, once there is a sample.
  if (g.line.fga >= 3) {
    const fg = g.line.fgm / g.line.fga;
    const e = clamp((fg - 0.46) * 1.6, -0.45, 0.45);
    score += e;
    if (Math.abs(e) > 0.15) notes.push(`${e > 0 ? '▲' : '▼'} Shooting ${Math.round(fg * 100)}% from the field`);
  }
  if (g.line.tpa >= 2) {
    const tp = g.line.tpm / g.line.tpa;
    const e = clamp((tp - 0.35) * 0.9, -0.25, 0.3);
    score += e;
    if (Math.abs(e) > 0.12) notes.push(`${e > 0 ? '▲' : '▼'} ${g.line.tpm}/${g.line.tpa} from three`);
  }
  const expTo = TEAM_GAME.to * 0.2 * clamp(g.minutesFrac, 0.08, 1) * (g.quarterLength / 120);
  const toPen = clamp((g.line.to - expTo) * 0.15, -0.1, 0.5);
  score -= toPen;
  if (toPen > 0.2) notes.push(`▼ ${g.line.to} turnovers`);
  score += g.teamWon ? 0.12 : -0.05;
  const grade = score >= 1.0 ? 5 : score >= 0.6 ? 4 : score >= 0.25 ? 3 : score >= -0.12 ? 2 : score >= -0.5 ? 1 : 0;
  // The two stats that moved the grade most, against what was expected of this player at this stage.
  parts.sort((a, b) => Math.abs(b.c) * WEIGHT[g.pos][b.stat] - Math.abs(a.c) * WEIGHT[g.pos][a.stat]);
  for (const p of parts.slice(0, 2)) {
    if (Math.abs(p.c) < 0.35) continue;
    notes.unshift(`${p.c > 0 ? '▲' : '▼'} ${LABEL[p.stat]}: ${p.actual} (about ${p.exp.toFixed(1)} expected of a ${g.pos} at this stage)`);
  }
  return { grade, score, notes };
}

/** Incentive bonus a game earns, in bet multiples; contracts pay more as a career goes on. */
export const GRADE_BONUS = [0, 0.04, 0.1, 0.2, 0.35, 0.55];
export function gameBonus(grade: number, gameIndex: number): number {
  return Math.round(GRADE_BONUS[grade] * (1 + 0.12 * gameIndex) * 1000) / 1000;
}

/** Playing time follows performance. */
export function nextMinutes(prev: number, grade: number): number {
  return clamp(prev + [-0.08, -0.05, 0, 0.05, 0.09, 0.12][grade], 0.3, 0.9);
}

export interface CareerState {
  /** Total the career pays (from the ticket), bet multiples. */
  total: number;
  maxGames: number;
  played: number;
  /** Earned so far (game incentives plus event money). */
  banked: number;
  midEventDone: boolean;
}

export type NegativeKind = 'injury' | 'contract' | 'locker' | 'waived' | 'traded';
export type PositiveKind = 'extension' | 'endorsement' | 'retire';

export type Next =
  | { kind: 'continue' }
  /** A mid-career boost toward the total (shoe deal / All-Star bonus); the career goes on. */
  | { kind: 'boost'; amount: number }
  | { kind: 'end-negative'; event: NegativeKind }
  | { kind: 'end-positive'; event: PositiveKind };

/**
 * What happens after a game. A player who has banked more than the career
 * pays sees it end within a few games (never before the third, likelier the longer it runs); one who
 * is short plays the full career and is topped up at the end, with a boost
 * midway when the gap is large.
 */
export function afterGame(s: CareerState, rnd: () => number): Next {
  const over = s.banked > s.total + 1e-9;
  if (over) {
    const endNow = s.played >= s.maxGames || (s.played >= 2 && rnd() < 0.12 + 0.12 * s.played);
    if (endNow) {
      const pool: NegativeKind[] = ['contract', 'locker', 'waived', 'contract'];
      if (s.played >= 3) pool.push('traded', 'traded');
      return { kind: 'end-negative', event: pool[Math.floor(rnd() * pool.length)] };
    }
    return { kind: 'continue' };
  }
  if (s.played >= s.maxGames) {
    const gap = s.total - s.banked;
    if (gap < 0.05) return { kind: 'end-positive', event: 'retire' };
    return { kind: 'end-positive', event: rnd() < 0.55 ? 'extension' : 'endorsement' };
  }
  const gap = s.total - s.banked;
  if (!s.midEventDone && s.played >= 2 && gap > 1.5 && s.maxGames - s.played >= 2 && rnd() < 0.6) {
    return { kind: 'boost', amount: Math.round(gap * (0.25 + rnd() * 0.2) * 1000) / 1000 };
  }
  return { kind: 'continue' };
}

/** A freak injury mid-game: only for a player already at or over what the career pays. */
export function injuryThisGame(s: CareerState, rnd: () => number): boolean {
  return s.played >= 1 && s.banked >= s.total - 0.02 && rnd() < 0.3;
}
