import { describe, expect, it } from 'vitest';
import { TEAMS } from '../src/data/teams.ts';

describe('league names', () => {
  const all = TEAMS.flatMap((t) => t.roster);
  const count = (key: 'first' | 'last') => {
    const m = new Map<string, number>();
    for (const p of all) m.set(p[key], (m.get(p[key]) ?? 0) + 1);
    return [...m.values()].filter((n) => n > 1).length;
  };
  it('first names are almost all distinct', () => expect(count('first')).toBeLessThanOrEqual(3));
  it('last names repeat only for the brothers', () => expect(count('last')).toBeLessThanOrEqual(2));
  it('brothers look alike', () => {
    const byLast = new Map<string, typeof all>();
    for (const p of all) byLast.set(p.last, [...(byLast.get(p.last) ?? []), p]);
    for (const group of byLast.values()) {
      if (group.length < 2) continue;
      const [a, b] = group;
      expect(b.skin).toBe(a.skin);
      expect(b.hair).toBe(a.hair);
      expect(Math.abs(b.height - a.height)).toBeLessThan(0.05);
    }
  });
  it('no full-name duplicates', () => expect(new Set(all.map((p) => p.name)).size).toBe(all.length));
});
