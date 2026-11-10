import { describe, expect, it } from 'vitest';
import { allCombos, difficulty, elements, expectedScore, fits, judgeScore, planBotDunk, type DunkRecord } from '../src/contests/dunkScore.ts';

const plain: DunkRecord = { setup: null, hurdle: false, far: false, moves: [] };

describe('freestyle dunk judging', () => {
  it('harder dunks score higher', () => {
    const windmill = { ...plain, moves: ['windmill'] } as DunkRecord;
    const combo = { ...plain, setup: 'backboard', moves: ['legs'] } as DunkRecord;
    const monster = { ...plain, setup: 'oop', hurdle: true, moves: ['legs'] } as DunkRecord;
    const s = [plain, windmill, combo, monster].map((r) => expectedScore(difficulty(r)));
    expect(s[0]).toBeLessThan(s[1]);
    expect(s[1]).toBeLessThan(s[2]);
    expect(s[2]).toBeLessThan(s[3]);
    expect(s[0]).toBeGreaterThanOrEqual(34);
    expect(s[0]).toBeLessThanOrEqual(38);
    expect(s[3]).toBeGreaterThanOrEqual(47);
  });
  it('a repeat is worth less to the judges', () => {
    const r = { ...plain, moves: ['legs', 'spin'] } as DunkRecord;
    expect(difficulty(r, new Set(elements(r)))).toBeLessThan(difficulty(r));
  });
  it('a clean finish beats a sloppy one, and retries cost', () => {
    let seed = 3;
    const g = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0;
    expect(judgeScore(5, 1, 0, g)).toBeGreaterThan(judgeScore(5, 0.2, 0, g));
    expect(judgeScore(5, 1, 0, g)).toBeGreaterThan(judgeScore(5, 1, 2, g));
  });
  it('only combos that fit in the air are offered', () => {
    const all = allCombos();
    expect(all.length).toBeGreaterThan(30);
    for (const r of all) expect(fits(r)).toBe(true);
    // Three moves after a lob does not fit.
    expect(fits({ setup: 'oop', hurdle: false, far: false, moves: ['legs', 'spin', 'windmill'] })).toBe(false);
  });
  it('bots get a dunk that scores about what they should', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let target = 32; target <= 50; target++) {
      const { rec, exec } = planBotDunk(target, new Set(), rnd);
      expect(fits(rec)).toBe(true);
      expect(Math.abs(expectedScore(difficulty(rec), exec) - target), `target ${target}`).toBeLessThanOrEqual(2);
    }
  });
});
