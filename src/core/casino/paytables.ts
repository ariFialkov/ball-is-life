// Paytable definitions. Every table is expressed as "winning" entries with a
// payout (bet multiple) and a relative weight. At resolution time the engine
// scales the winning probabilities so that the expected return equals the
// configured RTP exactly; the remaining probability mass goes to the losing
// (zero payout) outcome. Because expected value is linear in the winning
// probabilities, this keeps every mode at precisely the operator RTP while
// leaving the *shape* of the prize distribution untouched.

export interface PayEntry {
  payout: number;
  weight: number;
}

export interface ResolvedTable {
  /** Probabilities aligned with `entries`; a final implicit entry is the zero outcome. */
  probs: number[];
  entries: PayEntry[];
  zeroProb: number;
}

/**
 * Scale the winning probabilities so that sum(p_i * payout_i) === rtp.
 * Throws if the shape cannot reach the requested rtp (sum of probs would exceed 1).
 */
export function resolveTable(entries: PayEntry[], rtp: number): ResolvedTable {
  let weightedPay = 0;
  for (const e of entries) weightedPay += e.weight * e.payout;
  const k = rtp / weightedPay; // probability per unit of weight
  const probs = entries.map((e) => e.weight * k);
  const sum = probs.reduce((a, b) => a + b, 0);
  if (sum > 1 + 1e-9) {
    throw new Error(`Paytable cannot reach RTP ${rtp}: winning probability mass ${sum.toFixed(3)} > 1`);
  }
  return { probs, entries, zeroProb: Math.max(0, 1 - sum) };
}

export function expectedValue(t: ResolvedTable): number {
  let ev = 0;
  for (let i = 0; i < t.entries.length; i++) ev += t.probs[i] * t.entries[i].payout;
  return ev;
}

// ---------------------------------------------------------------------------
// Playoffs: 8-team single elimination, three rounds. exitRound index:
// 0 = lost quarter-final (zero), 1 = lost semi, 2 = lost final, 3 = champion.
export const PLAYOFF_ROUND_NAMES = ['Quarter-Final', 'Semi-Final', 'Final'];
export const PLAYOFF_LADDER = [0, 1.2, 3, 10];
export const PLAYOFF_TABLE: PayEntry[] = [
  { payout: 1.2, weight: 0.26 }, // lost semi
  { payout: 3, weight: 0.11 }, // lost final
  { payout: 10, weight: 0.0358 }, // champion
];

// ---------------------------------------------------------------------------
// Career: total contract multiplier over a whole (short) career.
export const CAREER_TABLE: PayEntry[] = [
  { payout: 0.5, weight: 22 },
  { payout: 1, weight: 18 },
  { payout: 1.5, weight: 10 },
  { payout: 2, weight: 8 },
  { payout: 3, weight: 6 },
  { payout: 5, weight: 3 },
  { payout: 8, weight: 1.5 },
  { payout: 15, weight: 0.6 },
  { payout: 30, weight: 0.25 },
  { payout: 100, weight: 0.04 },
];

// ---------------------------------------------------------------------------
// All-Star contests: 4 competitors, paid by finishing place (index = place - 1).
export const CONTEST_PAYTABLES: Record<'three' | 'dunk' | 'skills', number[]> = {
  three: [3, 1.5, 0, 0],
  dunk: [4, 1.2, 0, 0],
  skills: [3, 1.5, 0, 0],
};

export function contestTable(contest: 'three' | 'dunk' | 'skills'): PayEntry[] {
  const pt = CONTEST_PAYTABLES[contest];
  if (contest === 'dunk') {
    return [
      { payout: pt[0], weight: 0.17 },
      { payout: pt[1], weight: 0.2667 },
    ];
  }
  return [
    { payout: pt[0], weight: 0.2 },
    { payout: pt[1], weight: 0.2667 },
  ];
}

// ---------------------------------------------------------------------------
// Quick game odds. Fractional odds for the user's team as a function of the
// rating gap (opponent - user). Even money for a strong favourite, up to 2.5:1
// for a heavy underdog; the sweet spot for evenly matched teams is ~1.6:1.
export function quickGameOdds(userOvr: number, oppOvr: number): number {
  const diff = oppOvr - userOvr;
  const f = 1.6 + diff * 0.045;
  return Math.round(Math.min(2.5, Math.max(1.0, f)) * 100) / 100;
}
