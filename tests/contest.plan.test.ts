import { describe, expect, it } from 'vitest';
import { USER, intendedStandings, planRounds, rank, roundTargets } from '../src/contests/plan.ts';

let seed = 3;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function allTickets(n = 3) {
  const out: { place: number; above: boolean[] }[] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const above = Array.from({ length: n }, (_, i) => !!(mask & (1 << i)));
    out.push({ place: above.filter(Boolean).length + 1, above });
  }
  return out;
}

describe('contest round planning lands on the ticket', () => {
  for (const finalists of [2, 3]) {
    it(`every ticket with a top-${finalists} final`, () => {
      for (const t of allTickets()) {
        for (let rep = 0; rep < 20; rep++) {
          const plan = planRounds(t.place, t.above, finalists, rnd);
          const standings = intendedStandings(plan);
          expect(standings.indexOf(USER) + 1).toBe(t.place);
          // Bots the ticket puts above the user finish above them; the rest below.
          t.above.forEach((a, i) => expect(standings.indexOf(i) < standings.indexOf(USER)).toBe(a));
          expect(plan.finalOrder.length).toBe(finalists);
          expect(plan.userAdvances).toBe(plan.finalOrder.includes(USER));
          // The finalists are exactly the top of the first round.
          expect(new Set(plan.r1Order.slice(0, finalists))).toEqual(new Set(plan.finalOrder));
        }
      }
    });
  }

  it('bot targets respect the intended order around any user score', () => {
    for (const user of [0, 7, 19, 33, 40]) {
      for (const t of allTickets()) {
        const plan = planRounds(t.place, t.above, 3, rnd);
        const targets = roundTargets(user, plan.r1Order, { higherBetter: true, min: 0, max: 40, gap: [1, 5], step: 1 }, rnd);
        const results = new Map(targets);
        results.set(USER, user);
        const r = rank(results, plan.r1Order, true);
        expect(r.order).toEqual(plan.r1Order);
      }
    }
  });

  it('times: lower is better', () => {
    const order = [1, USER, 0, 2];
    const targets = roundTargets(31.4, order, { higherBetter: false, min: 15, max: 90, gap: [0.4, 3], step: 0.1 }, rnd);
    expect(targets.get(1)!).toBeLessThan(31.4);
    expect(targets.get(0)!).toBeGreaterThan(31.4);
    expect(targets.get(2)!).toBeGreaterThan(targets.get(0)!);
  });
});
