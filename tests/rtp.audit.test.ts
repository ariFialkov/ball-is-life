import { describe, expect, it } from 'vitest';
import { OutcomeEngine, DEFAULT_OPERATOR, makeMatchScript } from '../src/core/casino/engine.ts';
import { Rng } from '../src/core/rng.ts';
import { CAREER_TABLE, PLAYOFF_TABLE, contestTable, expectedValue, resolveTable } from '../src/core/casino/paytables.ts';
import type { ModeId } from '../src/core/casino/types.ts';

const N = 200_000;

function simulate(mode: ModeId, rtp: number, params: Record<string, unknown> = {}) {
  const engine = new OutcomeEngine({ ...DEFAULT_OPERATOR, rtp, serverSeed: `audit-${mode}-${rtp}` });
  let wagered = 0;
  let returned = 0;
  for (let i = 0; i < N; i++) {
    const t = engine.createTicket({ mode, bet: 10, clientSeed: 'c', params });
    wagered += t.bet;
    returned += t.bet * t.multiplier;
  }
  return returned / wagered;
}

describe('paytables hit the configured RTP exactly in expectation', () => {
  for (const rtp of [0.9, 0.96, 0.985]) {
    it(`playoffs table EV = ${rtp}`, () => expect(expectedValue(resolveTable(PLAYOFF_TABLE, rtp))).toBeCloseTo(rtp, 9));
    it(`career table EV = ${rtp}`, () => expect(expectedValue(resolveTable(CAREER_TABLE, rtp))).toBeCloseTo(rtp, 9));
    for (const c of ['three', 'dunk', 'skills'] as const) {
      it(`${c} contest EV = ${rtp}`, () => expect(expectedValue(resolveTable(contestTable(c), rtp))).toBeCloseTo(rtp, 9));
    }
  }
});

describe('monte-carlo audit of the ticket engine', () => {
  const tol = 0.02;
  it('quick game, even teams', () => expect(simulate('quick', 0.96, { userOvr: 82, oppOvr: 82 })).toBeCloseTo(0.96, 1));
  it('quick game, heavy underdog', () => expect(Math.abs(simulate('quick', 0.96, { userOvr: 72, oppOvr: 92 }) - 0.96)).toBeLessThan(tol));
  it('quick game, heavy favourite', () => expect(Math.abs(simulate('quick', 0.96, { userOvr: 92, oppOvr: 72 }) - 0.96)).toBeLessThan(tol));
  it('playoffs', () => expect(Math.abs(simulate('playoffs', 0.96) - 0.96)).toBeLessThan(tol));
  it('career (high variance, wider tolerance)', () => expect(Math.abs(simulate('career', 0.96) - 0.96)).toBeLessThan(0.08));
  it('3pt contest', () => expect(Math.abs(simulate('three', 0.96) - 0.96)).toBeLessThan(tol));
  it('dunk contest', () => expect(Math.abs(simulate('dunk', 0.96) - 0.96)).toBeLessThan(tol));
  it('skills contest', () => expect(Math.abs(simulate('skills', 0.96) - 0.96)).toBeLessThan(tol));
  it('rtp is configurable', () => expect(Math.abs(simulate('quick', 0.9, { userOvr: 80, oppOvr: 80 }) - 0.9)).toBeLessThan(tol));
});

describe('determinism & fairness', () => {
  it('same seeds produce the same ticket', () => {
    const a = new OutcomeEngine({ ...DEFAULT_OPERATOR, serverSeed: 's' });
    const b = new OutcomeEngine({ ...DEFAULT_OPERATOR, serverSeed: 's' });
    const ta = a.createTicket({ mode: 'playoffs', bet: 5, clientSeed: 'x', params: {} });
    const tb = b.createTicket({ mode: 'playoffs', bet: 5, clientSeed: 'x', params: {} });
    expect(ta.outcome).toEqual(tb.outcome);
    expect(ta.fairnessHash).toEqual(tb.fairnessHash);
  });
  it('match scripts land on the scripted margin and contain lead changes', () => {
    const rng = new Rng('scripts');
    let changes = 0;
    for (let i = 0; i < 500; i++) {
      const win = rng.chance(0.5);
      const s = makeMatchScript(rng, win, 7);
      expect(s.checkpoints[0]).toBe(0);
      expect(s.checkpoints[s.checkpoints.length - 1]).toBe(win ? 7 : -7);
      expect(Math.sign(s.checkpoints[s.checkpoints.length - 2])).toBe(win ? 1 : -1);
      changes += s.leadChanges;
    }
    expect(changes / 500).toBeGreaterThan(1);
  });
  it('career bonuses sum to the total multiplier', () => {
    const e = new OutcomeEngine({ ...DEFAULT_OPERATOR, serverSeed: 'career' });
    for (let i = 0; i < 300; i++) {
      const t = e.createTicket({ mode: 'career', bet: 1, clientSeed: 'c', params: {} });
      if (t.outcome.kind !== 'career') throw new Error('bad');
      const sum = t.outcome.games.reduce((a, g) => a + g.bonus, 0);
      expect(Math.abs(sum - t.outcome.totalMultiplier)).toBeLessThan(0.01);
    }
  });
});
