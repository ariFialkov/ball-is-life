// Shared types for the betting/outcome layer. Erasable TS only.

export type ModeId = 'quick' | 'playoffs' | 'career' | 'three' | 'dunk' | 'skills';

export interface OperatorConfig {
  /** Return-to-player target, e.g. 0.96 */
  rtp: number;
  minBet: number;
  maxBet: number;
  /** Secret seed only the "server" knows. The client only sees its hash until the round settles. */
  serverSeed: string;
}

/**
 * A match script: the predetermined result for one game plus a target margin
 * trajectory the on-court director steers towards. Margins are (userTeam - opponent).
 */
export interface MatchScript {
  userWins: boolean;
  /** Final margin in points, positive when the user's team wins. */
  margin: number;
  /** Target margins sampled at evenly spaced fractions of game time (index 0 = tip-off, last = final). */
  checkpoints: number[];
  /** Number of lead changes the script intends (cosmetic / telemetry). */
  leadChanges: number;
}

export interface QuickOutcome {
  kind: 'quick';
  /** Fractional odds for the user's team (1.0 = even money, 2.5 = 2.5:1). */
  fractionalOdds: number;
  script: MatchScript;
}

export interface PlayoffOutcome {
  kind: 'playoffs';
  /** Round index in which the user's run ends (0 = lost first round, rounds.length = champion). */
  exitRound: number;
  /** One script per round the user plays (length = exitRound + 1 unless champion). */
  scripts: MatchScript[];
  /** Payout ladder per exit round, in bet multiples. */
  ladder: number[];
  roundNames: string[];
}

export interface CareerGameScript {
  /** Performance grade 0..5 (F, D, C, B, A, A+). */
  grade: number;
  /** Stat targets the director steers the user's on-court line towards. */
  targetPoints: number;
  targetAssists: number;
  targetRebounds: number;
  /** Share of the game the user is on the floor (0..1). */
  minutesShare: number;
  teamWins: boolean;
  script: MatchScript;
  /** Bet multiple earned by this game (bonus clause). */
  bonus: number;
}

export interface CareerOutcome {
  kind: 'career';
  games: CareerGameScript[];
  endReason: 'injury' | 'retired' | 'cut';
  totalMultiplier: number;
}

export interface ContestOutcome {
  kind: 'contest';
  contest: 'three' | 'dunk' | 'skills';
  /** Finishing place of the user, 1-based. */
  place: number;
  /** For each bot competitor (in order): true = finishes above the user. */
  botsAbove: boolean[];
  /** Multiplier table indexed by place-1. */
  paytable: number[];
}

export type Outcome = QuickOutcome | PlayoffOutcome | CareerOutcome | ContestOutcome;

export interface RoundRequest {
  mode: ModeId;
  bet: number;
  clientSeed: string;
  /** Mode specific parameters (team ids, contest etc). */
  params: Record<string, unknown>;
}

export interface RoundTicket {
  id: string;
  mode: ModeId;
  bet: number;
  nonce: number;
  clientSeed: string;
  /** Hash of serverSeed:nonce, published before the round starts (provably fair). */
  fairnessHash: string;
  createdAt: number;
  outcome: Outcome;
  /** The bet multiple this ticket pays if the round plays out to the scripted conclusion. */
  multiplier: number;
  rtp: number;
}

export interface LedgerEntry {
  ticketId: string;
  mode: ModeId;
  bet: number;
  payout: number;
  multiplier: number;
  summary: string;
  settledAt: number;
  fairnessHash: string;
  /** Revealed after settlement so the player can verify the hash. */
  revealSeed: string;
}
