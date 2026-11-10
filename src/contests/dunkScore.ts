/**
 * Freestyle dunk judging. A dunk is whatever the dunker put together: an
 * optional setup in the run-up (a toss off the backboard, a bounce, a lob from
 * a teammate), an optional teammate to clear, a takeoff spot, and the moves
 * done in the air before the slam. Judges reward difficulty, chaining moves,
 * variety (a move they have already seen from this dunker is worth less), and
 * a clean finish, and they mark down retries.
 *
 * Also plans the bots' dunks: given the score a bot should get, a combo that
 * judges would score about that and that fits in the air.
 *
 * Pure: no DOM, no three.js, so it is unit tested.
 */
export type Setup = 'backboard' | 'bounce' | 'oop';
export type Move = 'windmill' | 'legs' | 'behind' | 'spin' | 'reverse';

export interface DunkRecord {
  setup: Setup | null;
  hurdle: boolean;
  /** Took off from the free-throw line (or further). */
  far: boolean;
  moves: Move[];
}

export const SETUP_NAME: Record<Setup, string> = { backboard: 'Off the Glass', bounce: 'Bounce Oop', oop: 'Teammate Alley-Oop' };
export const MOVE_NAME: Record<Move, string> = { windmill: 'Windmill', legs: 'Between the Legs', behind: 'Behind the Back', spin: '360', reverse: 'Reverse' };

const SETUP_PTS: Record<Setup, number> = { backboard: 2.0, bounce: 1.6, oop: 1.2 };
const MOVE_PTS: Record<Move, number> = { windmill: 1.5, legs: 2.4, behind: 2.0, spin: 2.0, reverse: 1.1 };
const HURDLE_PTS = 2.4;
const FAR_PTS = 2.2;

/** Seconds each move takes in the air. */
export const MOVE_TIME: Record<Move, number> = { windmill: 0.32, legs: 0.34, behind: 0.3, spin: 0.44, reverse: 0.3 };
/** Air time used by a setup before the moves can start (the catch). */
export const CATCH_TIME = 0.3;
/** When the moves can start without a setup (after the gather). */
export const FIRST_MOVE_AT = 0.1;
/** The slam has to come by about here, while the hand is still above the rim. */
export const LAST_SLAM_AT = 0.76;

/** Keys the judges remember, so a repeat is worth less. */
export function elements(r: DunkRecord): string[] {
  const out: string[] = [];
  if (r.setup) out.push(`setup:${r.setup}`);
  if (r.hurdle) out.push('hurdle');
  if (r.far) out.push('far');
  for (const m of r.moves) out.push(`move:${m}`);
  return out;
}

/** Difficulty points. `seen` holds elements this dunker already showed the judges. */
export function difficulty(r: DunkRecord, seen: ReadonlySet<string> = new Set()): number {
  const fresh = (key: string) => (seen.has(key) ? 0.6 : 1);
  let d = 0;
  if (r.setup) d += SETUP_PTS[r.setup] * fresh(`setup:${r.setup}`);
  if (r.hurdle) d += HURDLE_PTS * fresh('hurdle');
  if (r.far) d += FAR_PTS * fresh('far');
  // Chained moves: each one after the first is worth more (it has to fit in the same flight).
  r.moves.forEach((m, i) => {
    const again = r.moves.indexOf(m) < i ? 0.5 : 1;
    d += MOVE_PTS[m] * (1 + 0.3 * i) * fresh(`move:${m}`) * again;
  });
  // Doing a lot at once is more than the sum of its parts.
  const parts = (r.setup ? 1 : 0) + (r.hurdle ? 1 : 0) + (r.far ? 1 : 0) + r.moves.length;
  if (parts >= 3) d += 0.6 * (parts - 2);
  return d;
}

/** 0..1 quality the judges see, from difficulty, execution (0..1) and how many attempts it took. */
export function judgeQuality(diff: number, exec: number, attemptNo: number): number {
  const q = Math.min(1, 0.22 + 0.105 * diff) * (0.55 + 0.45 * Math.max(0, Math.min(1, exec))) - 0.1 * attemptNo;
  return Math.max(0, Math.min(1, q));
}

/** Total of five judges' cards (6..10 each) for a made dunk. */
export function judgeScore(diff: number, exec: number, attemptNo: number, gauss: () => number): number {
  const q = judgeQuality(diff, exec, attemptNo);
  let total = 0;
  for (let j = 0; j < 5; j++) total += Math.min(10, Math.max(6, Math.round(6 + 4 * q + gauss() * 0.4)));
  return total;
}

/** The expected (noise-free) score of a dunk made cleanly on the first try. */
export function expectedScore(diff: number, exec = 0.9): number {
  return 5 * Math.min(10, Math.max(6, 6 + 4 * judgeQuality(diff, exec, 0)));
}

export function dunkName(r: DunkRecord): string {
  const parts: string[] = [];
  if (r.far) parts.push('Free-Throw Line');
  if (r.hurdle) parts.push('Over a Teammate');
  if (r.setup) parts.push(SETUP_NAME[r.setup]);
  for (const m of r.moves) parts.push(MOVE_NAME[m]);
  return parts.length ? parts.join(' · ') : 'Two-Hand Slam';
}

/** Whether the moves fit in the air after the setup. */
export function fits(r: DunkRecord): boolean {
  const start = r.setup ? CATCH_TIME : FIRST_MOVE_AT;
  const end = start + r.moves.reduce((t, m) => t + MOVE_TIME[m], 0) + 0.03;
  // Taking off from far out is a longer flight to the rim: a little less time to play with.
  return end <= LAST_SLAM_AT - (r.far ? 0.06 : 0);
}

const SETUPS: (Setup | null)[] = [null, 'backboard', 'bounce', 'oop'];
const MOVES: Move[] = ['windmill', 'legs', 'behind', 'spin', 'reverse'];

/** Every dunk that fits in the air (up to three moves). */
export function allCombos(): DunkRecord[] {
  const out: DunkRecord[] = [];
  const seqs: Move[][] = [[]];
  for (const a of MOVES) {
    seqs.push([a]);
    for (const b of MOVES) {
      if (b === a) continue;
      seqs.push([a, b]);
      for (const c of MOVES) if (c !== a && c !== b) seqs.push([a, b, c]);
    }
  }
  for (const setup of SETUPS)
    for (const hurdle of [false, true])
      for (const far of [false, true]) {
        // You can't clear a teammate from the free-throw line and still reach a lob; keep it physical.
        if (far && (hurdle || setup)) continue;
        for (const moves of seqs) {
          const r = { setup, hurdle, far, moves };
          if (fits(r)) out.push(r);
        }
      }
  return out;
}

/**
 * A dunk for a bot that should score `target` (30..50): among the combos that
 * fit, one whose clean score is closest, picked at random among near ties, and
 * preferring elements the judges haven't seen from this bot.
 */
export function planBotDunk(target: number, seen: ReadonlySet<string>, rnd: () => number): { rec: DunkRecord; exec: number } {
  const combos = allCombos();
  const scored = combos.map((rec) => {
    const d = difficulty(rec, seen);
    // Execution is the free variable: pick the one that lands nearest the target for this combo.
    let best = { exec: 0.9, err: Infinity };
    for (let e = 0.3; e <= 1.0001; e += 0.05) {
      const err = Math.abs(expectedScore(d, e) - target);
      if (err < best.err - 1e-9) best = { exec: e, err };
    }
    return { rec, exec: best.exec, err: best.err };
  });
  const min = Math.min(...scored.map((s) => s.err));
  const close = scored.filter((s) => s.err <= min + 1);
  const pick = close[Math.floor(rnd() * close.length)];
  return { rec: pick.rec, exec: pick.exec };
}
