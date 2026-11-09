import { describe, expect, it } from 'vitest';
import { afterGame, gameBonus, gradeGame, nextMinutes, type CareerState, type GameLine } from '../src/career/progress.ts';

const line = (o: Partial<GameLine>): GameLine => ({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, to: 0, ...o });
const base = { quarterLength: 120, teamWon: true, minutesFrac: 0.4 };

describe('performance grades', () => {
  it('better games grade higher', () => {
    const quiet = gradeGame({ ...base, pos: 'SF', gameIndex: 2, line: line({ pts: 1, reb: 0, fgm: 0, fga: 4 }) });
    const solid = gradeGame({ ...base, pos: 'SF', gameIndex: 2, line: line({ pts: 4, reb: 2, ast: 1, fgm: 2, fga: 4 }) });
    const big = gradeGame({ ...base, pos: 'SF', gameIndex: 2, line: line({ pts: 11, reb: 4, ast: 3, stl: 2, fgm: 5, fga: 7 }) });
    expect(quiet.grade).toBeLessThan(solid.grade);
    expect(solid.grade).toBeLessThan(big.grade);
  });
  it('the same night means more early in a career than late', () => {
    const l = line({ pts: 5, reb: 2, ast: 1, fgm: 2, fga: 5 });
    const rookie = gradeGame({ ...base, pos: 'SG', gameIndex: 0, line: l });
    const vet = gradeGame({ ...base, pos: 'SG', gameIndex: 6, line: l });
    expect(rookie.score).toBeGreaterThan(vet.score);
    expect(rookie.grade).toBeGreaterThan(vet.grade);
  });
  it('one rebound is fine for a point guard and poor for a center', () => {
    const l = line({ pts: 3, reb: 1, ast: 2, fgm: 1, fga: 3 });
    const pg = gradeGame({ ...base, pos: 'PG', gameIndex: 2, line: l });
    const c = gradeGame({ ...base, pos: 'C', gameIndex: 2, line: l });
    expect(pg.score).toBeGreaterThan(c.score);
  });
  it('blocks, steals and efficiency count', () => {
    const plain = gradeGame({ ...base, pos: 'C', gameIndex: 1, line: line({ pts: 4, reb: 3, fgm: 2, fga: 6 }) });
    const defense = gradeGame({ ...base, pos: 'C', gameIndex: 1, line: line({ pts: 4, reb: 3, blk: 3, stl: 1, fgm: 2, fga: 6 }) });
    const efficient = gradeGame({ ...base, pos: 'C', gameIndex: 1, line: line({ pts: 4, reb: 3, fgm: 2, fga: 2 }) });
    expect(defense.score).toBeGreaterThan(plain.score);
    expect(efficient.score).toBeGreaterThan(plain.score);
  });
  it('bonuses and minutes follow the grade', () => {
    expect(gameBonus(5, 0)).toBeGreaterThan(gameBonus(2, 0));
    expect(gameBonus(3, 5)).toBeGreaterThan(gameBonus(3, 0));
    expect(nextMinutes(0.3, 5)).toBeGreaterThan(nextMinutes(0.3, 0));
  });
});

describe('careers always pay exactly the ticket', () => {
  it('reconciles any run of grades to the total', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let trial = 0; trial < 4000; trial++) {
      const total = [0, 0, 0.5, 1, 1.5, 2, 3, 5, 8, 15, 30, 100][trial % 12];
      const s: CareerState = { total, maxGames: 3 + (trial % 5), played: 0, banked: 0, midEventDone: false };
      let paid: number | null = null;
      for (let g = 0; g < 20 && paid === null; g++) {
        s.banked += gameBonus(Math.floor(rnd() * 6), s.played);
        s.played++;
        const n = afterGame(s, rnd);
        if (n.kind === 'boost') {
          s.banked += n.amount;
          s.midEventDone = true;
        } else if (n.kind === 'end-negative') {
          expect(s.banked).toBeGreaterThan(total);
          paid = total;
        } else if (n.kind === 'end-positive') {
          expect(s.banked).toBeLessThanOrEqual(total + 1e-9);
          paid = total;
        }
      }
      expect(paid).toBe(total);
      expect(s.played).toBeLessThanOrEqual(s.maxGames);
    }
  });
});
