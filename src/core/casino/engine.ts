// The outcome engine. Pure and deterministic: given the operator config, a
// client seed and a nonce it produces the complete result of a round *before*
// the round is played. The front end then stages a game whose bots are steered
// to reproduce that result. This file has no DOM dependencies and uses only
// erasable TypeScript syntax so it can run unchanged inside Node for a real
// backend (see server/server.mjs).

import { Rng, hashHex, clamp } from '../rng.ts';
import type {
  CareerGameScript,
  CareerOutcome,
  ContestOutcome,
  MatchScript,
  ModeId,
  OperatorConfig,
  Outcome,
  PlayoffOutcome,
  QuickOutcome,
  RoundRequest,
  RoundTicket,
} from './types.ts';
import {
  CAREER_TABLE,
  PLAYOFF_LADDER,
  PLAYOFF_ROUND_NAMES,
  PLAYOFF_TABLE,
  CONTEST_PAYTABLES,
  contestTable,
  quickGameOdds,
  resolveTable,
} from './paytables.ts';

export const DEFAULT_OPERATOR: OperatorConfig = {
  rtp: 0.96,
  minBet: 1,
  maxBet: 500,
  serverSeed: 'ball-is-life-demo-server-seed-change-me',
};

export class OutcomeEngine {
  config: OperatorConfig;
  nonce: number;

  constructor(config: OperatorConfig, nonce = 0) {
    this.config = config;
    this.nonce = nonce;
  }

  setRtp(rtp: number) {
    this.config = { ...this.config, rtp: clamp(rtp, 0.5, 0.995) };
  }

  /** The commitment published to the player before a round: hash(serverSeed:nonce). */
  fairnessHash(nonce: number): string {
    return hashHex(`${this.config.serverSeed}:${nonce}`);
  }

  revealSeed(nonce: number): string {
    return `${this.config.serverSeed}:${nonce}`;
  }

  createTicket(req: RoundRequest): RoundTicket {
    const bet = clamp(req.bet, this.config.minBet, this.config.maxBet);
    const nonce = ++this.nonce;
    const rng = new Rng(`${this.config.serverSeed}:${req.clientSeed}:${nonce}:${req.mode}`);
    const outcome = resolveOutcome(req.mode, req.params, rng, this.config.rtp);
    return {
      id: hashHex(`ticket:${this.config.serverSeed}:${nonce}`).slice(0, 12),
      mode: req.mode,
      bet,
      nonce,
      clientSeed: req.clientSeed,
      fairnessHash: this.fairnessHash(nonce),
      createdAt: Date.now(),
      outcome,
      multiplier: ticketMultiplier(outcome),
      rtp: this.config.rtp,
    };
  }
}

export function ticketMultiplier(o: Outcome): number {
  switch (o.kind) {
    case 'quick':
      return o.script.userWins ? 1 + o.fractionalOdds : 0;
    case 'playoffs':
      return o.ladder[o.exitRound];
    case 'career':
      return o.totalMultiplier;
    case 'contest':
      return o.paytable[o.place - 1] ?? 0;
  }
}

export function resolveOutcome(mode: ModeId, params: Record<string, unknown>, rng: Rng, rtp: number): Outcome {
  switch (mode) {
    case 'quick':
      return resolveQuick(params, rng, rtp);
    case 'playoffs':
      return resolvePlayoffs(params, rng, rtp);
    case 'career':
      return resolveCareer(params, rng, rtp);
    case 'three':
    case 'dunk':
    case 'skills':
      return resolveContest(mode, rng, rtp);
  }
}

// ---------------------------------------------------------------------------
// Match scripts

/**
 * Draw a realistic final margin. Most games are decided by single digits;
 * blowouts are rare. Always >= 1.
 */
export function drawMargin(rng: Rng, gap = 0): number {
  const base = Math.abs(rng.gauss()) * 6 + 1 + Math.max(0, gap) * 0.25;
  return clamp(Math.round(base), 1, 24);
}

/**
 * Build a margin trajectory (Brownian bridge) that starts at 0 and lands on
 * the final margin, with enough variance that leads change hands.
 */
export function makeMatchScript(rng: Rng, userWins: boolean, margin: number, steps = 16): MatchScript {
  const target = userWins ? margin : -margin;
  const walk: number[] = [0];
  const sigma = 4.5;
  for (let i = 1; i <= steps; i++) walk.push(walk[i - 1] + rng.gauss() * sigma);
  const drift = walk[steps] - target;
  const checkpoints = walk.map((v, i) => Math.round(v - drift * (i / steps)));
  checkpoints[0] = 0;
  checkpoints[steps] = target;
  // Guarantee the result is unambiguous near the end so the director does not
  // need to force a late swing: the last two checkpoints share the final sign.
  const sign = Math.sign(target);
  const penultimate = checkpoints[steps - 1];
  checkpoints[steps - 1] = penultimate * sign > 0 ? penultimate : sign * Math.max(1, Math.ceil(margin / 2));
  let leadChanges = 0;
  let last = 0;
  for (const c of checkpoints) {
    const s = Math.sign(c);
    if (s !== 0 && last !== 0 && s !== last) leadChanges++;
    if (s !== 0) last = s;
  }
  return { userWins, margin, checkpoints, leadChanges };
}

// ---------------------------------------------------------------------------

function resolveQuick(params: Record<string, unknown>, rng: Rng, rtp: number): QuickOutcome {
  const userOvr = Number(params.userOvr ?? 80);
  const oppOvr = Number(params.oppOvr ?? 80);
  const fractionalOdds = quickGameOdds(userOvr, oppOvr);
  const pWin = rtp / (1 + fractionalOdds);
  const userWins = rng.chance(pWin);
  const margin = drawMargin(rng, userWins ? userOvr - oppOvr : oppOvr - userOvr);
  return { kind: 'quick', fractionalOdds, script: makeMatchScript(rng, userWins, margin) };
}

function resolvePlayoffs(params: Record<string, unknown>, rng: Rng, rtp: number): PlayoffOutcome {
  const table = resolveTable(PLAYOFF_TABLE, rtp);
  const r = rng.next();
  let acc = 0;
  let exitRound = 0;
  for (let i = 0; i < table.probs.length; i++) {
    acc += table.probs[i];
    if (r < acc) {
      exitRound = i + 1;
      break;
    }
  }
  const rounds = PLAYOFF_ROUND_NAMES.length;
  const scripts: MatchScript[] = [];
  for (let i = 0; i < rounds; i++) {
    if (i < exitRound) scripts.push(makeMatchScript(rng, true, drawMargin(rng)));
    else if (i === exitRound) scripts.push(makeMatchScript(rng, false, drawMargin(rng)));
    else break;
  }
  return { kind: 'playoffs', exitRound, scripts, ladder: PLAYOFF_LADDER.slice(), roundNames: PLAYOFF_ROUND_NAMES.slice() };
}

const CAREER_BONUS_THRESHOLDS = [0.08, 0.2, 0.42, 0.8, 1.5]; // grade boundaries on per-game bonus

export function gradeFromBonus(bonus: number): number {
  let g = 0;
  for (const t of CAREER_BONUS_THRESHOLDS) if (bonus >= t) g++;
  return g;
}

function resolveCareer(_params: Record<string, unknown>, rng: Rng, rtp: number): CareerOutcome {
  const table = resolveTable(CAREER_TABLE, rtp);
  const r = rng.next();
  let acc = 0;
  let total = 0;
  for (let i = 0; i < table.probs.length; i++) {
    acc += table.probs[i];
    if (r < acc) {
      total = table.entries[i].payout;
      break;
    }
  }
  const nGames = rng.int(3, 7);
  // Per-game weights trend upward (the rookie earns more minutes as the career goes on),
  // then the bonuses are normalised to sum exactly to the drawn total.
  const weights: number[] = [];
  for (let i = 0; i < nGames; i++) weights.push(0.45 + rng.next() * 0.8 + i * 0.18);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const games: CareerGameScript[] = [];
  let minutesShare = 0.22;
  for (let i = 0; i < nGames; i++) {
    const bonus = Math.round(((total * weights[i]) / wsum) * 1000) / 1000;
    const grade = gradeFromBonus(bonus);
    minutesShare = clamp(minutesShare + (grade - 2) * 0.06 + 0.04, 0.2, 0.75);
    const teamWins = rng.chance(0.35 + grade * 0.1);
    const targetPoints = Math.round(clamp(3 + grade * 4.2 + rng.gauss() * 1.5, 0, 36) * minutesShare * 1.6);
    games.push({
      grade,
      targetPoints,
      targetAssists: Math.round(clamp(grade * 0.9 + rng.next() * 2, 0, 9) * minutesShare * 1.5),
      targetRebounds: Math.round(clamp(1 + grade * 0.8 + rng.next() * 2, 0, 10) * minutesShare * 1.5),
      minutesShare,
      teamWins,
      script: makeMatchScript(rng, teamWins, drawMargin(rng)),
      bonus,
    });
  }
  let endReason: CareerOutcome['endReason'];
  if (total === 0) endReason = rng.chance(0.55) ? 'cut' : 'injury';
  else if (total < 1.5) endReason = rng.chance(0.5) ? 'injury' : 'cut';
  else endReason = rng.chance(0.45) ? 'injury' : 'retired';
  return { kind: 'career', games, endReason, totalMultiplier: total };
}

function resolveContest(contest: 'three' | 'dunk' | 'skills', rng: Rng, rtp: number): ContestOutcome {
  const table = resolveTable(contestTable(contest), rtp);
  const r = rng.next();
  let acc = 0;
  let place = 4;
  for (let i = 0; i < table.probs.length; i++) {
    acc += table.probs[i];
    if (r < acc) {
      place = i + 1;
      break;
    }
  }
  if (place === 4) place = rng.chance(0.5) ? 3 : 4; // the two losing places are cosmetic
  const botsAbove = [false, false, false];
  const idx = rng.shuffle([0, 1, 2]);
  for (let i = 0; i < place - 1; i++) botsAbove[idx[i]] = true;
  return { kind: 'contest', contest, place, botsAbove, paytable: CONTEST_PAYTABLES[contest].slice() };
}
