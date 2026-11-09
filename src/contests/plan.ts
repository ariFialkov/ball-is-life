/**
 * Round planning for the two-round All-Star contests (first round, then a
 * final for the top finishers), driven by the outcome ticket.
 *
 * The ticket fixes the user's final place and which bots finish above them.
 * The user always performs first in every round; the bots' results are then
 * steered (relative to whatever the user actually scored) so the standings
 * land on the ticket. Competitor ids: -1 is the user, 0..n-1 are the bots.
 */
export type Id = number;
export const USER: Id = -1;

export interface RoundPlan {
  finalists: number;
  userAdvances: boolean;
  /** Intended first-round ranking, best first. */
  r1Order: Id[];
  /** Ids in the final (best first, as intended). */
  finalOrder: Id[];
}

type Rnd = () => number;

function shuffle<T>(a: T[], rnd: Rnd): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function planRounds(place: number, botsAbove: boolean[], finalists: number, rnd: Rnd): RoundPlan {
  const bots = botsAbove.map((_, i) => i);
  const above = shuffle(bots.filter((i) => botsAbove[i]), rnd);
  const below = shuffle(bots.filter((i) => !botsAbove[i]), rnd);
  const userAdvances = place <= finalists;
  if (userAdvances) {
    // Every bot that beats the user overall is in the final; fill the remaining final spots from the rest.
    const fill = below.slice(0, finalists - 1 - above.length);
    const eliminated = below.slice(fill.length);
    const finalOrder = [...above, USER, ...fill];
    // First round: the finalists in any order at the top, the eliminated below them.
    const r1Top = shuffle([...above, ...fill], rnd);
    r1Top.splice(Math.floor(rnd() * (r1Top.length + 1)), 0, USER);
    return { finalists, userAdvances, r1Order: [...r1Top, ...eliminated], finalOrder };
  }
  // The user is out after the first round: exactly `place - 1` bots beat them there.
  const r1Order = [...above, USER, ...below];
  const finalOrder = shuffle(r1Order.slice(0, finalists), rnd);
  return { finalists, userAdvances, r1Order, finalOrder };
}

/** Overall standings from a plan: finalists by the final, then the rest by the first round. */
export function intendedStandings(plan: RoundPlan): Id[] {
  const inFinal = new Set(plan.finalOrder);
  return [...plan.finalOrder, ...plan.r1Order.filter((id) => !inFinal.has(id))];
}

export interface TargetOpts {
  /** true when a higher result is better (points), false for times. */
  higherBetter: boolean;
  min: number;
  max: number;
  /** Gap between neighbours in result units: [min, max]. */
  gap: [number, number];
  /** Results are multiples of this (1 for points, 0.1 for seconds). */
  step: number;
}

/**
 * Bot targets for a round, given the user's actual result and the intended
 * order (best first). Bots ranked above the user beat them by a margin, bots
 * ranked below fall short by a margin. Values clamp to the legal range, so a
 * perfect or zero result can force a tie; ties are broken by the intended
 * order (a tiebreaker), which the caller reports.
 */
export function roundTargets(user: number, order: Id[], o: TargetOpts, rnd: Rnd): Map<Id, number> {
  const out = new Map<Id, number>();
  const ui = order.indexOf(USER);
  const better = o.higherBetter ? 1 : -1;
  const snap = (v: number) => Math.round(Math.min(o.max, Math.max(o.min, v)) / o.step) * o.step;
  const gap = () => o.gap[0] + rnd() * (o.gap[1] - o.gap[0]);
  let prev = user;
  for (let i = ui - 1; i >= 0; i--) {
    prev = snap(prev + better * gap());
    out.set(order[i], prev);
  }
  prev = user;
  for (let i = ui + 1; i < order.length; i++) {
    prev = snap(prev - better * gap());
    out.set(order[i], prev);
  }
  return out;
}

/** Sort ids by result, breaking ties (and only ties) with the intended order. */
export function rank(results: Map<Id, number>, intended: Id[], higherBetter: boolean): { order: Id[]; tiebreak: boolean } {
  let tiebreak = false;
  const ids = [...results.keys()];
  ids.sort((a, b) => {
    const d = (results.get(b)! - results.get(a)!) * (higherBetter ? 1 : -1);
    if (Math.abs(d) > 1e-9) return d;
    tiebreak = true;
    return intended.indexOf(a) - intended.indexOf(b);
  });
  return { order: ids, tiebreak };
}
