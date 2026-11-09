import * as THREE from 'three';
import type { App, Screen } from '../app/app.ts';
import { h } from '../app/app.ts';
import { BALL_R, RIM_H, RIM_X } from '../engine/constants.ts';
import type { Ball } from '../engine/ball.ts';
import type { Character } from '../engine/character.ts';
import type { PlayerDef, TeamDef } from '../data/teams.ts';
import { audio } from '../engine/audio.ts';
import { clamp } from '../core/rng.ts';
import { ContestScene, judgeCards, type ContestOptions, type StandingRow } from './base.ts';
import { USER, planRounds, rank, roundTargets, type Id, type RoundPlan } from './plan.ts';

/**
 * NBA Slam Dunk Contest: four dunkers, two dunks each in the first round, the
 * top two go to a two-dunk final. Five judges score every dunk 6-10 (30-50).
 * A dunker gets three attempts per dunk.
 *
 * Every attempt is physical: the dunker runs in, takes off where the player
 * presses, flies on a real arc, and the ball leaves the actual hand when the
 * player slams. Takeoff too early and the hand never gets over the rim; too
 * late and it is past it. The rim decides.
 */
const SIDE = 1 as const;
const BOT_SPEED = 1.4;
/** Dunk animation timing (matches Character 'dunk'): airborne 0.055s-0.99s. */
const T_LAND = 0.99;

interface DunkDef {
  name: string;
  diff: number;
  style: 'two' | 'tomahawk' | 'windmill' | 'legs';
  /** Approach angle from straight on, degrees. */
  approach: number;
  spin: 0 | 1;
  reverse: boolean;
  /** Ideal takeoff distance from the rim (the free-throw-line dunk leaves from 4.6m). */
  takeoff: number;
}

export const DUNKS: DunkDef[] = [
  { name: 'Two-Hand Slam', diff: 1, style: 'two', approach: 0, spin: 0, reverse: false, takeoff: 2.4 },
  { name: 'Tomahawk', diff: 2, style: 'tomahawk', approach: 25, spin: 0, reverse: false, takeoff: 2.4 },
  { name: 'Windmill', diff: 3, style: 'windmill', approach: 35, spin: 0, reverse: false, takeoff: 2.4 },
  { name: 'Baseline Reverse', diff: 3, style: 'two', approach: 72, spin: 0, reverse: true, takeoff: 2.2 },
  { name: '360', diff: 4, style: 'two', approach: 15, spin: 1, reverse: false, takeoff: 2.5 },
  { name: 'Between the Legs', diff: 5, style: 'legs', approach: 20, spin: 0, reverse: false, takeoff: 2.5 },
  { name: 'Free-Throw Line', diff: 5, style: 'two', approach: 0, spin: 0, reverse: false, takeoff: 4.6 },
];

type AttemptState = 'run' | 'air' | 'land' | 'result';

interface Attempt {
  dunk: DunkDef;
  state: AttemptState;
  t: number;
  dirIn: THREE.Vector3;
  start: THREE.Vector3;
  pos: THREE.Vector3;
  speed: number;
  /** Horizontal speed in the air. */
  vh: number;
  takeoffAt: THREE.Vector3 | null;
  takeoffDist: number;
  /** Measured slam point: when the hand is furthest over the rim while still above it, and how far in front of the body. */
  tSlam: number;
  reachFwd: number;
  slammed: boolean;
  slamT: number;
  /** When the user pressed slam (null until they do). */
  slamPress: number | null;
  /** Where the hand was at the slam point (a slightly late press still releases from here). */
  handAtSlam: THREE.Vector3 | null;
  slamOffset: number;
  made: boolean | null;
  ball: Ball;
  /** Bots: planned takeoff distance and slam time. */
  botTake: number;
  botSlam: number;
}

interface Turn {
  id: Id;
  def: PlayerDef;
  team: TeamDef;
  name: string;
  char: Character;
  dunkNo: number;
  attemptNo: number;
  scores: number[];
  attempt: Attempt | null;
  /** Bots: planned score per dunk and failed attempts before the make. */
  planned: number[];
  fails: number[];
  cards: number[] | null;
  pause: number;
}

class DunkContest {
  readonly scene: ContestScene;
  readonly rim = new THREE.Vector3(SIDE * RIM_X, RIM_H, 0);
  readonly plan: RoundPlan;
  readonly r1 = new Map<Id, number>();
  readonly fin = new Map<Id, number>();
  private queue: (() => void)[] = [];
  private turn: Turn | null = null;
  private round: 1 | 2 = 1;
  private targets = new Map<Id, number>();
  private finished = false;
  private ring: HTMLElement;
  private cardsEl: HTMLElement;

  constructor(readonly app: App, readonly o: ContestOptions) {
    this.scene = new ContestScene(app, o.team, o.strip, o.seed);
    this.plan = planRounds(o.place, o.botsAbove, 2, () => this.scene.rng.next());
    this.ring = h('div', { class: 'timing-ring' }, h('div', { class: 'timing-inner' }), h('div', { class: 'timing-outer' }));
    this.ring.style.display = 'none';
    this.cardsEl = h('div', { class: 'judge-cards' });
    this.scene.hud.append(this.ring, this.cardsEl);
    this.queue = [() => this.startRound(1)];
    this.next();
  }

  private name(id: Id) {
    return id === USER ? this.o.userName : this.o.bots[id].def.name;
  }
  private teamOf(id: Id) {
    return id === USER ? this.o.team : this.o.bots[id].team;
  }
  private defOf(id: Id) {
    return id === USER ? this.o.player : this.o.bots[id].def;
  }
  private next() {
    this.queue.shift()?.();
  }

  // ---------------------------------------------------------------------------
  // Rounds

  private startRound(round: 1 | 2) {
    this.round = round;
    const s = this.scene;
    if (round === 2 && !this.plan.userAdvances) {
      let v = 88 + s.rng.int(0, 10);
      for (const id of this.plan.finalOrder) {
        this.fin.set(id, clamp(v, 60, 100));
        v -= s.rng.int(1, 5);
      }
      this.queue.push(() => this.roundCard(2), () => this.finish());
      this.next();
      return;
    }
    const field = round === 1 ? this.plan.r1Order : this.plan.finalOrder;
    const bots = s.rng.shuffle(field.filter((id) => id !== USER));
    this.queue.push(() => this.beginTurn(USER));
    for (const id of bots) this.queue.push(() => this.beginTurn(id));
    this.queue.push(() => this.roundCard(round));
    this.queue.push(round === 1 ? () => this.startRound(2) : () => this.finish());
    this.next();
  }

  private beginTurn(id: Id) {
    const s = this.scene;
    if (id !== USER && !this.targets.size) {
      const user = (this.round === 1 ? this.r1 : this.fin).get(USER) ?? 60;
      const order = this.round === 1 ? this.plan.r1Order : this.plan.finalOrder;
      this.targets = roundTargets(user, order, { higherBetter: true, min: 60, max: 100, gap: [1, 6], step: 1 }, () => s.rng.next());
    }
    const def = this.defOf(id);
    const team = this.teamOf(id);
    const char = s.addCharacter(def, team, new THREE.Vector3(this.rim.x - SIDE * 11, 0, 0));
    // Contest dunkers get up: a leap of about 1.15m instead of an in-game 0.85m.
    char.jumpBoost = 1.35;
    const t: Turn = { id, def, team, name: this.name(id), char, dunkNo: 0, attemptNo: 0, scores: [], attempt: null, planned: [], fails: [], cards: null, pause: 0 };
    if (id !== USER) {
      const total = this.targets.get(id) ?? 80;
      const d1 = clamp(Math.round(total / 2 + s.rng.int(-3, 3)), Math.max(30, total - 50), Math.min(50, total - 30));
      t.planned = [d1, total - d1];
      t.fails = t.planned.map((sc) => (sc <= 30 ? 3 : sc < 36 ? 2 : sc < 40 ? s.rng.int(0, 1) : 0));
    }
    this.turn = t;
    s.showSkip(id !== USER);
    s.big.textContent = this.round === 1 ? 'ROUND 1' : 'FINAL';
    this.cardsEl.innerHTML = '';
    this.chooseDunk();
  }

  private chooseDunk() {
    const s = this.scene;
    const t = this.turn!;
    t.attemptNo = 0;
    s.prompt.textContent = `${t.name.toUpperCase()} · DUNK ${t.dunkNo + 1} OF 2`;
    s.sub.textContent = t.id === USER ? 'Harder dunks score higher but need cleaner timing' : t.team.abbr;
    this.idleCamera();
    if (t.id === USER) {
      s.choose(`DUNK ${t.dunkNo + 1} · PICK YOUR DUNK`, DUNKS.map((d) => `${d.name} ★${d.diff}`), (i) => this.startAttempt(DUNKS[i]), 1);
    } else {
      const want = t.planned[t.dunkNo];
      const pool = DUNKS.filter((d) => (want >= 46 ? d.diff >= 4 : want >= 40 ? d.diff >= 2 && d.diff <= 4 : d.diff <= 3));
      this.startAttempt(s.rng.pick(pool));
    }
  }

  private startAttempt(dunk: DunkDef) {
    const s = this.scene;
    const t = this.turn!;
    const a = (dunk.approach * Math.PI) / 180;
    const side = s.rng.chance(0.5) ? 1 : -1;
    const dirIn = new THREE.Vector3(SIDE * Math.cos(a), 0, side * Math.sin(a)).normalize();
    const start = new THREE.Vector3(this.rim.x, 0, 0).addScaledVector(dirIn, -Math.max(9.5, dunk.takeoff + 7));
    const c = t.char;
    c.root.position.copy(start);
    c.dunkStyle = dunk.style;
    c.root.rotation.y = Math.atan2(dirIn.x, dirIn.z);
    const { tSlam, fwd: reachFwd } = this.measureSlam(c, dunk, dirIn);
    // Horizontal speed in the air that carries an ideal takeoff's hand over the rim at the slam.
    // (15cm of the takeoff is reserved for reaction time: a press right as the ring closes lands in the middle of the window.)
    const lead = dunk.style === 'tomahawk' ? 0.4 : 0.15;
    const vh = clamp((dunk.takeoff - lead - reachFwd) / tSlam, 2.5, 9.5);
    const ball = s.spawnBall('standard');
    const fail = t.id !== USER && t.attemptNo < t.fails[t.dunkNo];
    t.attempt = {
      dunk,
      state: 'run',
      t: 0,
      dirIn,
      start,
      pos: start.clone(),
      speed: 0,
      vh,
      takeoffAt: null,
      takeoffDist: 0,
      tSlam,
      reachFwd,
      slammed: false,
      slamT: 0,
      slamPress: null,
      handAtSlam: null,
      slamOffset: 0,
      made: null,
      ball,
      // A planned miss leaves a metre early: the hand never gets over the rim.
      botTake: dunk.takeoff + (fail ? 1.0 : 0),
      botSlam: tSlam + (fail ? 0 : s.rng.float(-0.02, 0.01)),
    };
    s.prompt.textContent = `${dunk.name.toUpperCase()}${t.attemptNo ? ` · ATTEMPT ${t.attemptNo + 1}` : ''}`;
    s.sub.textContent = t.id === USER ? 'PRESS SHOOT TO TAKE OFF AS THE RING CLOSES, THEN AGAIN TO SLAM' : t.team.abbr;
    this.ring.style.display = t.id === USER ? '' : 'none';
    this.app.touch.setLabels({ a: 'JUMP', b: '', x: '', y: '' });
  }

  /**
   * Dry-run the dunk animation on this dunker to find the slam point: the
   * moment the dunking hand is furthest forward while still well above the
   * rim, and how far in front of the body it is then. The ideal takeoff is
   * built from this, so it is exact for the dunker's size and the dunk style.
   */
  private measureSlam(c: Character, dunk: DunkDef, dirIn: THREE.Vector3): { tSlam: number; fwd: number } {
    const base = c.root.rotation.y;
    const pos = c.root.position.clone();
    // Start from a dribbling run-up, as in the real attempt, so the arms blend in the same way.
    c.setState('dribble');
    for (let i = 0; i < 30; i++) c.update(1 / 60, 0.9);
    c.setState('dunk');
    const samples: { t: number; y: number; fwd: number }[] = [];
    for (let tt = 1 / 120; tt < 0.85; tt += 1 / 120) {
      c.root.rotation.y = base + this.extraYaw(dunk, tt);
      c.update(1 / 120, 0);
      const hand = c.handWorld(new THREE.Vector3());
      samples.push({ t: tt, y: hand.y, fwd: (hand.x - pos.x) * dirIn.x + (hand.z - pos.z) * dirIn.z });
    }
    // The slam point: furthest forward while well above the rim, and still above it a beat later
    // (so a human press a frame or two late still has the ball over the rim).
    let best: { tSlam: number; fwd: number } | null = null;
    samples.forEach((p, i) => {
      if (p.t < 0.3 || p.y < RIM_H + 0.14) return;
      const later = samples.slice(i, i + 8);
      if (later.some((q) => q.y < RIM_H + 0.06)) return;
      if (!best || p.fwd > best.fwd) best = { tSlam: p.t, fwd: p.fwd };
    });
    if (!best) {
      const top = samples.reduce((a, b) => (b.y > a.y ? b : a));
      best = { tSlam: top.t, fwd: top.fwd };
    }
    c.root.rotation.y = base;
    c.setState('idle');
    return best;
  }

  /** Body rotation during the dunk: a full turn for the 360, a half turn for the reverse. */
  private extraYaw(dunk: DunkDef, t: number) {
    const u = (x: number) => {
      const k = clamp(x, 0, 1);
      return k * k * (3 - 2 * k);
    };
    if (dunk.spin) return Math.PI * 2 * u(t / 0.5);
    if (dunk.reverse) return Math.PI * u(t / 0.38);
    return 0;
  }

  private endAttempt() {
    const s = this.scene;
    const t = this.turn!;
    const a = t.attempt!;
    const isUser = t.id === USER;
    s.removeBall(a.ball);
    t.attempt = null;
    if (a.made) {
      const score = isUser ? this.userScore(a, t.attemptNo) : t.planned[t.dunkNo];
      this.recordDunk(t, score, a.dunk.name);
    } else if (t.attemptNo < 2) {
      t.attemptNo++;
      s.prompt.textContent = `MISSED · ATTEMPT ${t.attemptNo + 1} OF 3`;
      t.pause = 1.2;
      t.cards = null;
      this.pendingRetry = a.dunk;
    } else {
      this.recordDunk(t, isUser ? 30 : t.planned[t.dunkNo], 'NO DUNK');
    }
  }

  private pendingRetry: DunkDef | null = null;

  /** Judges: difficulty, execution (how centred and how close to the peak) and attempts. */
  private userScore(a: Attempt, attemptNo: number): number {
    const s = this.scene;
    const centred = clamp(1 - a.slamOffset / 0.26, 0, 1);
    const peak = clamp(1 - Math.abs((a.slamPress ?? a.slamT) - a.tSlam) / 0.18, 0, 1);
    const exec = centred * 0.6 + peak * 0.4;
    const q = 0.36 * (a.dunk.diff / 5) + 0.46 * exec + 0.18 * s.rng.next() - 0.12 * attemptNo;
    let total = 0;
    for (let j = 0; j < 5; j++) total += clamp(Math.round(6 + 4 * q + s.rng.gauss() * 0.45), 6, 10);
    return total;
  }

  private recordDunk(t: Turn, score: number, label: string) {
    const s = this.scene;
    const cards = judgeCards(score, () => s.rng.next());
    t.scores.push(score);
    t.cards = cards;
    this.cardsEl.innerHTML = '';
    for (const c of cards) this.cardsEl.append(h('span', { class: `judge-card${c === 10 ? ' ten' : ''}` }, String(c)));
    this.cardsEl.append(h('span', { class: 'judge-total' }, `= ${score}`));
    s.prompt.textContent = label === 'NO DUNK' ? 'NO DUNK · 3 MISSES' : score >= 48 ? 'PERFECT!' : score >= 44 ? 'THE CROWD IS UP!' : 'SOLID';
    s.sub.textContent = `${t.name.toUpperCase()} · TOTAL ${t.scores.reduce((x, y) => x + y, 0)}`;
    if (score >= 44) audio.cheer(1);
    t.pause = 2.4;
    t.dunkNo++;
  }

  private endTurn() {
    const s = this.scene;
    const t = this.turn!;
    const total = t.scores.reduce((a, b) => a + b, 0);
    (this.round === 1 ? this.r1 : this.fin).set(t.id, total);
    if (t.id === USER) this.targets = new Map();
    s.removeCharacter(t.char);
    s.clearBalls();
    s.showSkip(false);
    this.ring.style.display = 'none';
    this.cardsEl.innerHTML = '';
    this.turn = null;
    this.next();
  }

  /** Skip a bot: its remaining dunks are scored as planned. */
  private skipTurn(t: Turn) {
    if (t.attempt) this.scene.removeBall(t.attempt.ball);
    t.attempt = null;
    while (t.scores.length < 2) t.scores.push(t.planned[t.scores.length]);
    this.endTurn();
  }

  private roundCard(round: 1 | 2) {
    const res = round === 1 ? this.r1 : this.fin;
    const { order } = rank(res, round === 1 ? this.plan.r1Order : this.plan.finalOrder, true);
    this.scene.prompt.textContent = '';
    this.scene.sub.textContent = '';
    this.scene.card(
      round === 1 ? 'FIRST ROUND · TOP 2 ADVANCE' : 'FINAL ROUND',
      order.map((id, i) => ({ name: this.name(id), team: this.teamOf(id), value: `${res.get(id)}`, tag: round === 1 ? (i < 2 ? 'ADVANCES' : 'OUT') : i === 0 ? 'CHAMPION' : '', you: id === USER })),
      () => this.next(),
    );
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    const f = rank(this.fin, this.plan.finalOrder, true);
    const r1Only = new Map([...this.r1].filter(([id]) => !this.fin.has(id)));
    const r = rank(r1Only, this.plan.r1Order, true);
    const ids = [...f.order, ...r.order];
    const rows: StandingRow[] = ids.map((id) => ({ id, name: this.name(id), team: this.teamOf(id), r1: this.r1.get(id) ?? 0, final: this.fin.get(id) ?? null }));
    this.scene.destroy();
    this.o.onFinish({ rows, place: ids.indexOf(USER) + 1, unit: 'PTS', higherBetter: true, tiebreak: f.tiebreak || r.tiebreak });
  }

  // ---------------------------------------------------------------------------
  // Physics of an attempt

  private idleCamera() {
    this.scene.cam(new THREE.Vector3(this.rim.x - SIDE * 6.5, 2.8, 7.5), new THREE.Vector3(this.rim.x - SIDE * 2.5, 2.4, 0), 2.5);
  }

  private attemptCamera(a: Attempt) {
    const perp = new THREE.Vector3(-a.dirIn.z, 0, a.dirIn.x);
    if (perp.z < 0) perp.multiplyScalar(-1);
    const rimG = new THREE.Vector3(this.rim.x, 0, 0);
    const pos = rimG.clone().addScaledVector(a.dirIn, -3.2).addScaledVector(perp, 6.2);
    pos.y = 2.7;
    const look = a.pos.clone().lerp(rimG, a.state === 'run' ? 0.45 : 0.85);
    look.y = 2.5;
    this.scene.cam(pos, look, 3.2);
  }

  private slam(t: Turn, a: Attempt) {
    if (a.slammed) return;
    const s = this.scene;
    a.slammed = true;
    a.slamT = a.t;
    let hand = t.char.handWorld(new THREE.Vector3());
    // Up to ~100ms late still counts as on time (human reaction); the judges mark it down.
    if (a.handAtSlam && a.t - a.tSlam <= 0.1) hand = a.handAtSlam.clone();
    a.slamOffset = Math.hypot(hand.x - this.rim.x, hand.z - this.rim.z);
    // The dunker stretches the arm (up to ~27cm) to get the ball over the rim, then throws it down.
    // Off by more than that and the ball meets iron: the rim decides.
    const ball = a.ball;
    const toRim = new THREE.Vector3(this.rim.x - hand.x, 0, this.rim.z - hand.z);
    const adjust = toRim.clone();
    if (adjust.length() > 0.27) adjust.setLength(0.27);
    ball.place(hand.x + adjust.x, Math.max(hand.y, BALL_R), hand.z + adjust.z);
    const resid = toRim.sub(adjust).multiplyScalar(1.8);
    ball.vel.set(a.dirIn.x * a.vh * 0.15 + resid.x, -4.2, a.dirIn.z * a.vh * 0.15 + resid.z);
    ball.mode = 'shot';
    ball.shot = { side: SIDE, willMake: false, shooterTeam: 0, shooterIndex: 0, value: 2, releasedAt: s.time, scored: false, touchedRim: false };
    s.track(ball, (made) => {
      a.made = made;
      if (made) {
        audio.cheer(0.9);
        this.app.camera.shake = 0.25;
      } else audio.rim();
    });
  }

  update(dtReal: number) {
    const s = this.scene;
    const t = this.turn;
    const dt = t && t.id !== USER ? dtReal * BOT_SPEED : dtReal;
    s.update(dt);
    s.stepBalls(dt);
    if (!t) return;
    if (t.id !== USER && s.takeSkip()) {
      this.skipTurn(t);
      return;
    }
    if (t.pause > 0) {
      t.pause -= dt;
      t.char.setState('idle');
      t.char.update(dt, 0);
      if (t.pause <= 0) {
        if (this.pendingRetry) {
          const d = this.pendingRetry;
          this.pendingRetry = null;
          this.startAttempt(d);
        } else if (t.dunkNo >= 2) this.endTurn();
        else this.chooseDunk();
      }
      return;
    }
    const a = t.attempt;
    if (!a) {
      t.char.setState('idle');
      t.char.update(dt, 0);
      return;
    }
    const c = t.char;
    const input = this.app.input.state;
    const rimG = new THREE.Vector3(this.rim.x, 0, 0);
    a.t += dt;
    this.attemptCamera(a);
    switch (a.state) {
      case 'run': {
        a.speed = Math.min(6.4 + (t.def.ratings.speed - 70) * 0.02, a.speed + dt * 7);
        a.pos.addScaledVector(a.dirIn, a.speed * dt);
        const d = Math.hypot(rimG.x - a.pos.x, rimG.z - a.pos.z);
        c.root.position.copy(a.pos);
        c.setState('dribble');
        c.update(dt, a.speed / 6.6);
        // Dribble with the right hand on the way in.
        const hand = c.handWorld(new THREE.Vector3());
        const ph = (c.dribblePhase / (Math.PI * 2)) % 1;
        const top = Math.max(0.7, hand.y - 0.05);
        a.ball.place(hand.x + a.dirIn.x * 0.2, top - (top - BALL_R) * Math.sin(ph * Math.PI), hand.z + a.dirIn.z * 0.2);
        a.ball.syncVisual();
        const scale = 1 + clamp((d - a.dunk.takeoff) / 2.5, 0, 2.6);
        (this.ring.querySelector('.timing-outer') as HTMLElement).style.transform = `translate(-50%,-50%) scale(${scale})`;
        // Bots jump on the frame closest to their mark.
        const jump = t.id === USER ? input.pressed.a : d - a.speed * dt * 0.5 <= a.botTake;
        if (jump || d < 0.9) {
          a.state = 'air';
          a.t = 0;
          a.takeoffAt = a.pos.clone();
          a.takeoffDist = d;
          c.setState('dunk');
          audio.sneaker();
          if (t.id === USER) {
            const off = d - a.dunk.takeoff;
            s.sub.textContent = Math.abs(off) < 0.25 ? 'PERFECT TAKEOFF' : off > 0 ? 'EARLY TAKEOFF' : 'LATE TAKEOFF';
            s.sub.textContent += ' · SLAM WHEN THE RING CLOSES AGAIN';
          }
        }
        break;
      }
      case 'air': {
        const base = Math.atan2(a.dirIn.x, a.dirIn.z);
        c.root.rotation.y = base + this.extraYaw(a.dunk, a.t);
        if (a.t < T_LAND) a.pos.copy(a.takeoffAt!).addScaledVector(a.dirIn, a.vh * a.t);
        c.root.position.copy(a.pos);
        c.update(dt, 0);
        if (!a.slammed) {
          const handNow = c.handWorld(new THREE.Vector3());
          if (!a.handAtSlam && a.t + dt * 0.5 >= a.tSlam) a.handAtSlam = handNow.clone();
          a.ball.place(handNow.x, handNow.y, handNow.z);
          a.ball.syncVisual();
          let due = false;
          if (t.id === USER) {
            // A press shortly before the slam point means "carry it to the rim": release at the slam point.
            // A press far too early, or a late one, releases right away from wherever the hand is.
            if (input.pressed.a && a.t > 0.12 && a.slamPress === null) a.slamPress = a.t;
            const p = a.slamPress;
            if (p !== null) due = p < a.tSlam - 0.15 || a.t + dt * 0.5 >= a.tSlam;
          } else due = a.t + dt * 0.5 >= a.botSlam;
          if (due || a.t >= Math.min(0.9, a.tSlam + 0.12)) this.slam(t, a);
          (this.ring.querySelector('.timing-outer') as HTMLElement).style.transform = `translate(-50%,-50%) scale(${1 + clamp((a.tSlam - a.t) / 0.25, 0, 2.6)})`;
        }
        if (a.t >= T_LAND) {
          a.state = 'land';
          a.t = 0;
          this.ring.style.display = 'none';
        }
        break;
      }
      case 'land': {
        // Drift to a stop under the rim, then wait for the ball.
        a.pos.addScaledVector(a.dirIn, a.vh * Math.max(0, 0.6 - a.t) * dt);
        c.root.position.copy(a.pos);
        c.setState(a.made ? 'celebrate' : 'idle');
        c.update(dt, 0);
        if (a.made !== null && a.t > 0.9) this.endAttempt();
        break;
      }
      case 'result':
        break;
    }
  }

  destroy() {
    if (!this.finished) this.scene.destroy();
  }
}

export function dunkContest(app: App, o: ContestOptions): Screen {
  const c = new DunkContest(app, o);
  (window as any).__DUNKS = DUNKS;
  (window as any).__contest = c;
  return { el: h('div'), update: (dt) => c.update(dt), destroy: () => c.destroy() };
}
