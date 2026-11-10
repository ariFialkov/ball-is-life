import * as THREE from 'three';
import type { App, Screen } from '../app/app.ts';
import { h } from '../app/app.ts';
import { BACKBOARD_X, BALL_R, HALF_W, RIM_H, RIM_X } from '../engine/constants.ts';
import type { Ball } from '../engine/ball.ts';
import type { AirMove, Character } from '../engine/character.ts';
import type { PlayerDef, TeamDef } from '../data/teams.ts';
import { audio } from '../engine/audio.ts';
import { buttonNames } from '../engine/input.ts';
import { clamp } from '../core/rng.ts';
import { ContestScene, judgeCards, type ContestOptions, type StandingRow } from './base.ts';
import { USER, planRounds, rank, roundTargets, type Id, type RoundPlan } from './plan.ts';
import { CATCH_TIME, FIRST_MOVE_AT, MOVE_NAME, MOVE_TIME, SETUP_NAME, difficulty, dunkName, elements, judgeScore, planBotDunk, type DunkRecord, type Move, type Setup } from './dunkScore.ts';

/**
 * NBA Slam Dunk Contest, freestyle: four dunkers, two dunks each in the first
 * round, the top two go to a two-dunk final. Five judges score every dunk 6-10
 * (30-50); a dunker gets three attempts per dunk.
 *
 * Nothing is picked from a menu. The dunker picks an approach and runs it in;
 * in the run-up they can toss it off the glass, bounce it up, give it to a
 * teammate for the lob, or call a teammate into the lane to jump over. In the
 * air the right stick and the buttons do the moves (windmill, between the legs,
 * behind the back, 360, reverse), chained as long as the flight lasts, then
 * the slam. All of it is physical: lobs have to be caught, the teammate has to
 * be cleared, moves take real time, and the ball only goes down if the hand is
 * over the rim when it is thrown down. Judges score what they saw (see
 * dunkScore.ts).
 *
 * Bots freestyle too: each dunk is a combo chosen so the judges' score lands
 * where the outcome ticket needs it.
 */
const SIDE = 1 as const;
const BOT_SPEED = 1.3;
const G = 9.81;
const GATHER = 0.12;
/** Free-throw line distance and the mark for a "from the line" takeoff. */
const FAR_MARK = 4.2;

type AttemptState = 'approach' | 'run' | 'gather' | 'air' | 'land';

interface Seg {
  from: THREE.Vector3;
  v0: THREE.Vector3;
  t0: number;
  dur: number;
}

/** A ball on a planned path (a toss, a lob): parabolic segments that bounce off the glass or the floor. */
interface Toss {
  kind: Setup;
  segs: Seg[];
  t: number;
  /** When it reaches the catch point. */
  dur: number;
  caught: boolean;
  /** Teammate lob: the dunker gives it to the passer first; the lob goes up when he has it. */
  handoffAt: number;
  seg: number;
}

interface Helper {
  char: Character;
  role: 'hurdle' | 'passer';
  spot: THREE.Vector3;
  ready: boolean;
}

interface BotScript {
  rec: DunkRecord;
  sprint: boolean;
  takeoff: number;
  fail: 'none' | 'catch' | 'rim';
  calledSetup: boolean;
  nextMove: number;
}

interface Attempt {
  state: AttemptState;
  t: number;
  angle: number;
  dirIn: THREE.Vector3;
  start: THREE.Vector3;
  pos: THREE.Vector3;
  speed: number;
  ball: Ball;
  ballWith: 'dunker' | 'toss' | 'free';
  toss: Toss | null;
  hurdler: Helper | null;
  passer: Helper | null;
  /** Distance from the rim at which the hurdled teammate is set. */
  hurdleDist: number;
  hurdleCleared: boolean;
  takeoffAt: THREE.Vector3;
  takeoffDist: number;
  /** Distance from the rim when the dunker planted to go up (what "from the line" is judged on). */
  plantDist: number;
  D: number;
  tArr: number;
  v0: number;
  hang: number;
  hold: 1 | -1 | 0;
  move: { kind: Move; t: number } | null;
  queue: (Move | 'slam')[];
  movesDone: Move[];
  slamT: number | null;
  released: boolean;
  made: boolean | null;
  fail: string | null;
  yaw: number;
  exec: number;
  bot: BotScript | null;
  inRange: boolean;
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
  plans: (BotScript['rec'] | null)[];
  execs: number[];
  /** Elements the judges have already seen from this dunker. */
  seen: Set<string>;
  cards: number[] | null;
  pause: number;
}

const smooth = (x: number) => {
  const k = clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
};

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
  private cardsEl: HTMLElement;
  private legendEl: HTMLElement;
  private comboEl: HTMLElement;
  private seenByDunker = new Map<Id, Set<string>>();
  private helpers: Character[] = [];
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(readonly app: App, readonly o: ContestOptions) {
    this.scene = new ContestScene(app, o.team, o.strip, o.seed);
    this.plan = planRounds(o.place, o.botsAbove, 2, () => this.scene.rng.next());
    this.cardsEl = h('div', { class: 'judge-cards' });
    this.legendEl = h('div', { class: 'dunk-legend' });
    this.comboEl = h('div', { class: 'dunk-combo' });
    this.scene.hud.append(this.cardsEl, this.legendEl, this.comboEl);
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
    const char = s.addCharacter(def, team, new THREE.Vector3(this.rim.x - SIDE * 10, 0, 0));
    let seen = this.seenByDunker.get(id);
    if (!seen) this.seenByDunker.set(id, (seen = new Set()));
    const t: Turn = { id, def, team, name: this.name(id), char, dunkNo: 0, attemptNo: 0, scores: [], attempt: null, planned: [], fails: [], plans: [], execs: [], seen, cards: null, pause: 0 };
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
    this.startDunk();
  }

  private startDunk() {
    const t = this.turn!;
    t.attemptNo = 0;
    if (t.id !== USER) {
      // Plan a combo the judges will score at the planned number, avoiding what they've seen from this bot.
      const plan = planBotDunk(t.planned[t.dunkNo], t.seen, () => this.scene.rng.next());
      t.plans[t.dunkNo] = plan.rec;
      t.execs[t.dunkNo] = plan.exec;
    }
    this.startAttempt();
  }

  private botScript(t: Turn): BotScript {
    const s = this.scene;
    const rec = t.plans[t.dunkNo]!;
    const fail = t.attemptNo < t.fails[t.dunkNo] ? (rec.setup ? (s.rng.chance(0.6) ? 'catch' : 'rim') : 'rim') : 'none';
    return {
      rec,
      sprint: rec.far || s.rng.chance(0.5),
      takeoff: rec.far ? 4.5 : rec.hurdle ? 3.6 + s.rng.float(0, 0.3) : 2.4 + s.rng.float(0, 0.6),
      fail,
      calledSetup: false,
      nextMove: 0,
    };
  }

  private startAttempt() {
    const s = this.scene;
    const t = this.turn!;
    const isUser = t.id === USER;
    const c = t.char;
    const bot = isUser ? null : this.botScript(t);
    // Bots pick a lane; a run from the line comes straight down the middle.
    const angle = isUser ? 0 : bot!.rec.far ? s.rng.float(-0.2, 0.2) : s.rng.float(-0.8, 0.8);
    const ball = s.spawnBall('standard');
    const a: Attempt = {
      state: isUser ? 'approach' : 'run',
      t: 0,
      angle,
      dirIn: new THREE.Vector3(),
      start: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      speed: 0,
      ball,
      ballWith: 'dunker',
      toss: null,
      hurdler: null,
      passer: null,
      hurdleDist: 2.5,
      hurdleCleared: false,
      takeoffAt: new THREE.Vector3(),
      takeoffDist: 0,
      plantDist: 0,
      D: 0,
      tArr: 0.5,
      v0: 0,
      hang: 1,
      hold: 0,
      move: null,
      queue: [],
      movesDone: [],
      slamT: null,
      released: false,
      made: null,
      fail: null,
      yaw: 0,
      exec: 0,
      bot,
      inRange: false,
    };
    t.attempt = a;
    this.setApproach(a, angle);
    c.setState('idleBall');
    c.unwrapArms();
    c.fs.move = 'none';
    c.fs.slam = 0;
    c.fs.ikWeight = 0;
    this.comboEl.textContent = '';
    this.cardsEl.innerHTML = '';
    s.prompt.textContent = `${t.name.toUpperCase()} · DUNK ${t.dunkNo + 1} OF 2${t.attemptNo ? ` · ATTEMPT ${t.attemptNo + 1}` : ''}`;
    s.sub.textContent = isUser ? 'Pick your approach' : t.team.abbr;
    this.app.touch.setLabels({ a: 'GO', b: '', x: '', y: '' });
    this.app.touch.setSwipe(false);
    this.updateLegend(a, isUser);
  }

  /** Start spot on an arc around the rim (kept inside the sidelines). */
  private setApproach(a: Attempt, angle: number) {
    a.angle = angle;
    a.dirIn.set(SIDE * Math.cos(angle), 0, Math.sin(angle)).normalize();
    const r = Math.min(10.5, (HALF_W - 0.8) / Math.max(0.05, Math.abs(Math.sin(angle))));
    a.start.set(this.rim.x, 0, this.rim.z).addScaledVector(a.dirIn, -r);
    a.pos.copy(a.start);
    const c = this.turn!.char;
    c.root.position.copy(a.pos);
    a.yaw = Math.atan2(a.dirIn.x, a.dirIn.z);
    c.root.rotation.y = a.yaw;
  }

  private endAttempt() {
    const s = this.scene;
    const t = this.turn!;
    const a = t.attempt!;
    const isUser = t.id === USER;
    s.removeBall(a.ball);
    this.clearHelpers();
    t.char.unwrapArms();
    t.attempt = null;
    if (a.made && !a.fail) {
      const rec = this.recordOf(a);
      const score = isUser ? judgeScore(difficulty(rec, t.seen), a.exec, t.attemptNo, () => s.rng.gauss()) : t.planned[t.dunkNo];
      for (const e of elements(rec)) t.seen.add(e);
      this.recordDunk(t, score, dunkName(rec));
    } else if (t.attemptNo < 2) {
      t.attemptNo++;
      s.prompt.textContent = `${a.fail ?? 'NO GOOD'} · ATTEMPT ${t.attemptNo + 1} OF 3`;
      t.pause = 1.4;
      t.cards = null;
      this.pendingRetry = true;
    } else {
      this.recordDunk(t, isUser ? 30 : t.planned[t.dunkNo], 'NO DUNK');
    }
  }

  private pendingRetry = false;
  /** Debug: the last slam's geometry. */
  lastRelease: { off: number; over: number; exec: number } | null = null;
  lastClip: { t: number; air: number; along: number; takeoff: number } | null = null;

  /** What the judges saw. */
  private recordOf(a: Attempt): DunkRecord {
    return { setup: a.toss?.caught ? a.toss.kind : null, hurdle: a.hurdleCleared, far: a.plantDist >= FAR_MARK, moves: [...a.movesDone] };
  }

  private recordDunk(t: Turn, score: number, label: string) {
    const s = this.scene;
    const cards = judgeCards(score, () => s.rng.next());
    t.scores.push(score);
    t.cards = cards;
    this.cardsEl.innerHTML = '';
    for (const c of cards) this.cardsEl.append(h('span', { class: `judge-card${c === 10 ? ' ten' : ''}` }, String(c)));
    this.cardsEl.append(h('span', { class: 'judge-total' }, `= ${score}`));
    s.prompt.textContent = label === 'NO DUNK' ? 'NO DUNK · 3 MISSES' : score >= 48 ? 'PERFECT!' : score >= 44 ? 'THE CROWD IS UP!' : score >= 39 ? 'NICE' : 'SOLID';
    this.comboEl.textContent = label === 'NO DUNK' ? '' : label.toUpperCase();
    s.sub.textContent = `${t.name.toUpperCase()} · TOTAL ${t.scores.reduce((x, y) => x + y, 0)}`;
    if (score >= 44) audio.cheer(1);
    t.pause = 2.6;
    t.dunkNo++;
    this.legendEl.innerHTML = '';
  }

  private endTurn() {
    const s = this.scene;
    const t = this.turn!;
    const total = t.scores.reduce((a, b) => a + b, 0);
    (this.round === 1 ? this.r1 : this.fin).set(t.id, total);
    if (t.id === USER) this.targets = new Map();
    this.clearHelpers();
    s.removeCharacter(t.char);
    s.clearBalls();
    s.showSkip(false);
    this.cardsEl.innerHTML = '';
    this.comboEl.textContent = '';
    this.legendEl.innerHTML = '';
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
  // Teammates and tosses

  private teammate(t: Turn, n: number): PlayerDef {
    const roster = t.team.roster.filter((p) => p.id !== t.def.id);
    return roster[n % roster.length];
  }

  private spawnHelper(t: Turn, a: Attempt, role: Helper['role']): Helper {
    const s = this.scene;
    const perp = new THREE.Vector3(-a.dirIn.z, 0, a.dirIn.x);
    // The passer stands on the far side from the camera so he is in the shot.
    if (perp.z > 0) perp.multiplyScalar(-1);
    let from: THREE.Vector3;
    let spot: THREE.Vector3;
    if (role === 'hurdle') {
      spot = new THREE.Vector3(this.rim.x, 0, this.rim.z).addScaledVector(a.dirIn, -a.hurdleDist);
      from = spot.clone().addScaledVector(perp, 2.2);
    } else {
      spot = new THREE.Vector3(this.rim.x, 0, this.rim.z).addScaledVector(a.dirIn, -3.2).addScaledVector(perp, 3.6);
      spot.z = clamp(spot.z, -HALF_W + 0.6, HALF_W - 0.6);
      from = spot.clone();
    }
    const char = s.addCharacter(this.teammate(t, role === 'hurdle' ? 0 : 1), t.team, from);
    this.helpers.push(char);
    s.face(char, role === 'hurdle' ? spot.clone().addScaledVector(perp, -1) : this.rim);
    return { char, role, spot, ready: role === 'passer' };
  }

  private clearHelpers() {
    for (const c of this.helpers) this.scene.removeCharacter(c);
    this.helpers = [];
  }

  /** Where a lob is aimed: just in front of the rim, at the height the hand gets to. */
  private catchPoint(a: Attempt) {
    return new THREE.Vector3(this.rim.x, 3.15, this.rim.z).addScaledVector(a.dirIn, -0.7);
  }

  private seg(from: THREE.Vector3, to: THREE.Vector3, t0: number, dur: number): Seg {
    const v0 = to.clone().sub(from).multiplyScalar(1 / dur);
    v0.y += 0.5 * G * dur;
    return { from: from.clone(), v0, t0, dur };
  }

  private startToss(t: Turn, a: Attempt, kind: Setup) {
    const c = t.char;
    const hand = this.ballHome(t, a, this.tmp).clone();
    const P = this.catchPoint(a);
    let segs: Seg[];
    let handoffAt = 0;
    if (kind === 'backboard') {
      // Off the glass: up into the board above the rim, back out to the catch point.
      const B = new THREE.Vector3(SIDE * (BACKBOARD_X - BALL_R - 0.02), 3.72, this.rim.z + a.dirIn.z * 0.3);
      segs = [this.seg(hand, B, 0, 0.52), this.seg(B, P, 0.52, 0.42)];
    } else if (kind === 'bounce') {
      // Slammed into the floor in front of the rim, up to the catch point.
      const F = new THREE.Vector3(this.rim.x, BALL_R, this.rim.z).addScaledVector(a.dirIn, -2.1);
      segs = [this.seg(hand, F, 0, 0.3), this.seg(F, P, 0.3, 0.64)];
    } else {
      // Give and go: a flip to the teammate on the wing, who throws it up.
      a.passer = this.spawnHelper(t, a, 'passer');
      const ph = a.passer.spot.clone();
      ph.y = 1.45;
      handoffAt = 0.36;
      segs = [this.seg(hand, ph, 0, 0.36), this.seg(ph.clone().setY(2.0), P, 0.5, 0.88)];
    }
    a.toss = { kind, segs, t: 0, dur: segs[segs.length - 1].t0 + segs[segs.length - 1].dur, caught: false, handoffAt, seg: 0 };
    a.ballWith = 'toss';
    c.dribbling = false;
    c.setState('run');
    this.combo(a, `${SETUP_NAME[kind].toUpperCase()}`);
    audio.sneaker();
  }

  /** Advance a toss; returns the ball position. */
  private stepToss(a: Attempt, dt: number) {
    const ts = a.toss!;
    ts.t += dt;
    let i = ts.segs.findIndex((g) => ts.t < g.t0 + g.dur);
    if (i < 0) i = ts.segs.length - 1;
    const g = ts.segs[i];
    // The passer holds it for a beat between the flip and the lob.
    let tau = ts.t - g.t0;
    if (tau < 0) {
      const prev = ts.segs[i - 1];
      tau = prev ? prev.dur : 0;
      return this.segAt(prev ?? g, tau, this.tmp2);
    }
    if (i !== ts.seg) {
      if (ts.kind === 'backboard') audio.backboard();
      else if (ts.kind === 'bounce') audio.bounce(0.9);
      else if (a.passer) a.passer.char.setState('pass');
      ts.seg = i;
    }
    return this.segAt(g, tau, this.tmp2);
  }

  private segAt(g: Seg, tau: number, out: THREE.Vector3) {
    return out.copy(g.from).addScaledVector(g.v0, tau).add(new THREE.Vector3(0, -0.5 * G * tau * tau, 0));
  }

  private segVel(a: Attempt, out: THREE.Vector3) {
    const ts = a.toss!;
    const g = ts.segs[ts.segs.length - 1];
    const tau = Math.max(0, ts.t - g.t0);
    return out.copy(g.v0).add(new THREE.Vector3(0, -G * tau, 0));
  }

  // ---------------------------------------------------------------------------
  // Attempt

  private combo(a: Attempt, piece: string) {
    this.comboEl.textContent = this.comboEl.textContent ? `${this.comboEl.textContent} › ${piece}` : piece;
    void a;
  }

  private updateLegend(a: Attempt, isUser: boolean) {
    if (!isUser) {
      this.legendEl.innerHTML = '';
      return;
    }
    const n = buttonNames(this.app.input.state);
    let html = '';
    if (!n) {
      html =
        a.state === 'approach'
          ? 'Drag the stick to pick your approach · <b>GO</b> to run'
          : a.state === 'air' || a.state === 'gather'
            ? '<b>Swipe</b> ↑ Windmill · ↓ Between the legs · ←→ Behind the back · <b>360</b> · <b>REVERSE</b> · <b>SLAM</b>'
            : '<b>GLASS</b> toss off the backboard · <b>BOUNCE</b> it up · <b>OOP</b> teammate lob · <b>HURDLE</b> teammate to jump · <b>JUMP</b> take off';
    } else if (a.state === 'approach') {
      html = `<b>◀ ▶</b> Pick your approach · <b>${n.a}</b> Run it in`;
    } else if (a.state === 'run') {
      html = `<b>${n.sprint}</b> Hold for speed · <b>${n.y}</b> Toss off the glass · <b>${n.x}</b> Bounce it up · <b>${n.b}</b> Teammate lob · <b>${n.pick}</b> Teammate to jump over · <b>${n.a}</b> Take off`;
    } else if (a.state === 'gather' || a.state === 'air') {
      html = `<b>${n.skill}</b> ↑ Windmill · ↓ Between the legs · ← → Behind the back · <b>${n.y}</b> 360 · <b>${n.b}</b> Reverse · <b>${n.a}</b> Slam`;
    }
    if (this.legendEl.innerHTML !== html) this.legendEl.innerHTML = html;
  }

  /** Where the ball sits when the dunker has it (one hand, or between both). */
  private ballHome(t: Turn, a: Attempt, out: THREE.Vector3) {
    const c = t.char;
    if (a.state === 'run' || a.state === 'approach') {
      if (c.dribbleWeight > 0) return out.copy(c.dribbleBall);
      return c.handWorld(out);
    }
    if (a.hold === 0) {
      // Two hands on it: it sits in the lead hand (the one that reaches the rim), pulled a little
      // toward the other while they're together at the chest.
      const main = c.handWorld(out, c.handedness > 0 ? 'r' : 'l');
      const other = c.handWorld(this.tmp2, c.handedness > 0 ? 'l' : 'r');
      main.lerp(other, 0.5 * clamp(1 - (main.distanceTo(other) - 0.25) / 0.3, 0, 1));
      return main;
    }
    // Handing over between the legs / behind the back: the ball travels between the hands.
    const m = a.move;
    if (m && (m.kind === 'legs' || m.kind === 'behind')) {
      const u = m.t / MOVE_TIME[m.kind];
      const k = smooth((u - 0.38) / 0.24);
      const from = c.handWorld(out, a.hold > 0 ? 'r' : 'l');
      const to = c.handWorld(this.tmp2, a.hold > 0 ? 'l' : 'r');
      return from.lerp(to, k);
    }
    return c.handWorld(out, a.hold > 0 ? 'r' : 'l');
  }

  private takeOff(t: Turn, a: Attempt) {
    const s = this.scene;
    const d = Math.hypot(this.rim.x - a.pos.x, this.rim.z - a.pos.z);
    a.takeoffAt.copy(a.pos);
    a.takeoffDist = d;
    // A contest dunker gets up about 1.25m (shorter players a bit more), and flies to arrive with
    // the hand at the rim, decelerating into it. Too far out and the run-up speed can't carry it.
    const far = a.plantDist >= FAR_MARK;
    const jump = 1.25 + clamp(2.0 - this.turn!.def.height, -0.2, 0.25) * 0.8 + (far ? 0.08 : 0);
    a.v0 = Math.sqrt(2 * G * jump);
    a.hang = (2 * a.v0) / G;
    // Leave the floor at about run speed and decelerate into the rim (arriving with the hand there).
    // A long takeoff needs a long flight and a fast run; too far for the speed and you come up short.
    a.D = Math.max(0.15, d - 0.45);
    const vrun = Math.max(3, a.speed);
    a.tArr = clamp((2 * a.D) / (vrun * 1.1), 0.3, far ? 0.84 : 0.75);
    const vmax = vrun * 1.35;
    if ((2 * a.D) / a.tArr > vmax) a.D = (vmax * a.tArr) / 2;
    if (a.ballWith === 'dunker') a.hold = 0;
    // The teammate in the lane: not set yet and he jogs off; take off on top of him and you clip him.
    if (a.hurdler) {
      if (!a.hurdler.ready) {
        a.hurdler.char.setState('run');
        a.hurdler = null;
      } else if (d < a.hurdleDist + 0.9) {
        a.fail = 'CLIPPED YOUR TEAMMATE';
        this.lastClip = { t: 0, air: 0, along: d - a.hurdleDist, takeoff: d };
      }
    }
    if (t.id === USER) s.sub.textContent = d >= FAR_MARK ? 'FROM THE FREE-THROW LINE!' : d < 1.3 ? 'TOO CLOSE' : 'UP!';
    if (d >= FAR_MARK) this.combo(a, 'FROM THE LINE');
    audio.sneaker();
  }

  private startMove(t: Turn, a: Attempt, kind: Move) {
    if (a.hold === 0 && (kind === 'windmill' || kind === 'legs' || kind === 'behind')) a.hold = t.char.handedness;
    a.move = { kind, t: 0 };
  }

  private finishMove(t: Turn, a: Attempt) {
    const m = a.move!;
    if (m.kind === 'legs' || m.kind === 'behind') a.hold = (a.hold === 0 ? -t.char.handedness : -a.hold) as 1 | -1;
    if (m.kind === 'windmill') t.char.windmillDone(a.hold === 0 ? t.char.handedness : a.hold);
    if (m.kind === 'spin') a.yaw += Math.PI * 2;
    if (m.kind === 'reverse') a.yaw += Math.PI;
    a.movesDone.push(m.kind);
    this.combo(a, MOVE_NAME[m.kind].toUpperCase());
    a.move = null;
  }

  /** The slam: throw it down from wherever the hand is. Over the rim it goes in; short or wide meets iron. */
  private release(t: Turn, a: Attempt) {
    const s = this.scene;
    a.released = true;
    const isUser = t.id === USER;
    const hand = this.ballHome(t, a, new THREE.Vector3());
    const ball = a.ball;
    const off = Math.hypot(hand.x - this.rim.x, hand.z - this.rim.z);
    const over = hand.y - RIM_H;
    if (isUser) {
      // The dunker stretches up to ~27cm to get it over the rim; beyond that the ball meets iron.
      const toRim = new THREE.Vector3(this.rim.x - hand.x, 0, this.rim.z - hand.z);
      const adjust = toRim.clone();
      if (adjust.length() > 0.27) adjust.setLength(0.27);
      ball.place(hand.x + adjust.x, Math.max(hand.y, BALL_R), hand.z + adjust.z);
      const resid = toRim.sub(adjust).multiplyScalar(1.8);
      ball.vel.set(resid.x, over > 0 ? -4.2 : -1.0, resid.z);
      a.exec = clamp(1 - Math.max(0, off - 0.12) / 0.3, 0, 1) * 0.7 + clamp(over / 0.2, 0, 1) * 0.3;
      this.lastRelease = { off, over, exec: a.exec };
    } else if (a.bot!.fail === 'rim') {
      // A planned miss: thrown down onto the front of the rim.
      ball.place(this.rim.x - a.dirIn.x * 0.34, RIM_H + 0.3, this.rim.z - a.dirIn.z * 0.34);
      ball.vel.set(a.dirIn.x * 0.4, -4.0, a.dirIn.z * 0.4);
    } else {
      ball.place(this.rim.x - a.dirIn.x * 0.04, RIM_H + 0.26, this.rim.z - a.dirIn.z * 0.04);
      ball.vel.set(0, -4.4, 0);
      a.exec = t.execs[t.dunkNo] ?? 0.9;
    }
    a.ballWith = 'free';
    ball.mode = 'shot';
    ball.shot = { side: SIDE, willMake: false, shooterTeam: 0, shooterIndex: 0, value: 2, releasedAt: s.time, scored: false, touchedRim: false };
    s.track(ball, (made) => {
      a.made = made;
      if (made) {
        audio.cheer(0.9);
        this.app.camera.shake = 0.25;
      } else {
        audio.rim();
        if (!a.fail) a.fail = isUser && over < 0 ? 'NOT HIGH ENOUGH' : 'OFF THE RIM';
      }
    });
  }

  /** The ball gets away (a missed lob, a clipped teammate, came down with it). */
  private drop(a: Attempt, why: string) {
    if (a.ballWith === 'free') return;
    const s = this.scene;
    const v = a.ballWith === 'toss' && a.toss ? this.segVel(a, new THREE.Vector3()) : new THREE.Vector3(a.dirIn.x * 1.5, 0.5, a.dirIn.z * 1.5);
    a.ballWith = 'free';
    a.ball.mode = 'loose';
    a.ball.vel.copy(v);
    a.ball.shot = null;
    s.track(a.ball, null);
    a.fail = a.fail ?? why;
    a.made = false;
  }

  // ---------------------------------------------------------------------------
  // Cameras

  private idleCamera() {
    this.scene.cam(new THREE.Vector3(this.rim.x - SIDE * 6.5, 2.8, 7.5), new THREE.Vector3(this.rim.x - SIDE * 2.5, 2.4, 0), 2.5);
  }

  private approachCamera(a: Attempt) {
    const pos = a.pos.clone().addScaledVector(a.dirIn, -4.2);
    pos.y = 2.9;
    this.scene.cam(pos, new THREE.Vector3(this.rim.x, 2.2, this.rim.z), 5);
  }

  private attemptCamera(a: Attempt) {
    const perp = new THREE.Vector3(-a.dirIn.z, 0, a.dirIn.x);
    if (perp.z < 0) perp.multiplyScalar(-1);
    const rimG = new THREE.Vector3(this.rim.x, 0, this.rim.z);
    const d = Math.hypot(rimG.x - a.pos.x, rimG.z - a.pos.z);
    // Wide for the run-up; in the air it pushes in low and close, looking up at the rim.
    const close = a.state === 'air' || a.state === 'gather' || a.state === 'land' ? 1 : clamp(1 - (d - 3) / 6, 0, 1);
    const pos = rimG.clone().addScaledVector(a.dirIn, -(3.6 - 1.2 * close)).addScaledVector(perp, 6.4 - 2.2 * close);
    pos.y = 2.7 - 0.6 * close;
    const look = a.pos.clone().lerp(rimG, a.state === 'run' ? 0.45 : 0.6);
    look.y = 2.3 + 0.3 * close;
    this.scene.cam(pos, look, 2.6 + 1.5 * close);
  }

  // ---------------------------------------------------------------------------
  // Per frame

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
      this.idleCamera();
      if (t.pause <= 0) {
        if (this.pendingRetry) {
          this.pendingRetry = false;
          this.startAttempt();
        } else if (t.dunkNo >= 2) this.endTurn();
        else this.startDunk();
      }
      return;
    }
    const a = t.attempt;
    if (!a) {
      t.char.setState('idle');
      t.char.update(dt, 0);
      return;
    }
    const isUser = t.id === USER;
    const input = this.app.input.state;
    const bot = a.bot;
    const c = t.char;
    const fs = c.fs;
    a.t += dt;
    const d = Math.hypot(this.rim.x - a.pos.x, this.rim.z - a.pos.z);
    this.updateLegend(a, isUser);
    // Helpers.
    if (a.hurdler && !a.hurdler.ready) {
      const hc = a.hurdler.char;
      const to = this.tmp.copy(a.hurdler.spot).sub(hc.root.position);
      to.y = 0;
      const step = 4.5 * dt;
      if (to.length() <= step) {
        hc.root.position.copy(a.hurdler.spot);
        a.hurdler.ready = true;
        s.face(hc, hc.root.position.clone().add(new THREE.Vector3(-a.dirIn.z, 0, a.dirIn.x)));
        hc.setState('brace');
      } else {
        hc.root.position.addScaledVector(to.normalize(), step);
        hc.root.rotation.y = Math.atan2(to.x, to.z);
        hc.setState('run');
      }
      hc.update(dt, a.hurdler.ready ? 0 : 0.7);
    } else if (a.hurdler) a.hurdler.char.update(dt, 0);
    if (a.passer) {
      const pc = a.passer.char;
      if (pc.state === 'pass' && pc.stateTime > 0.45) pc.setState('idle');
      if (pc.state !== 'pass') pc.setState(a.toss && a.toss.t < (a.toss.segs[1]?.t0 ?? 0) && a.toss.t > a.toss.handoffAt ? 'idleBall' : 'idle');
      pc.update(dt, 0);
    }
    // The ball when it isn't in the dunker's hands.
    if (a.ballWith === 'toss' && a.toss) {
      const p = this.stepToss(a, dt);
      a.ball.place(p.x, p.y, p.z);
      a.ball.syncVisual();
      // Nobody there to catch it: it carries on and falls.
      if (a.toss.t > a.toss.dur + 0.32) this.drop(a, a.state === 'air' ? 'MISSED THE LOB' : 'NEVER GOT UP FOR IT');
    }
    switch (a.state) {
      case 'approach': {
        // Pick the lane: the stick (or arrows) slides the start spot round the arc.
        this.approachCamera(a);
        const mx = input.move.x;
        if (Math.abs(mx) > 0.2) this.setApproach(a, clamp(a.angle - mx * dt * 1.2, -1.25, 1.25));
        c.setState('idleBall');
        c.update(dt, 0);
        s.holdIn(a.ball, c, true);
        if (input.pressed.a || input.pressed.confirm || a.t > 12) {
          a.state = 'run';
          a.t = 0;
          s.sub.textContent = 'Load it up';
          this.app.touch.setLabels({ a: 'JUMP', b: 'OOP', x: 'BOUNCE', y: 'GLASS', pick: 'HURDLE' });
        }
        break;
      }
      case 'run': {
        this.attemptCamera(a);
        const sprint = isUser ? input.held.sprint : bot!.sprint;
        const top = (sprint ? 7.4 : 5.9) + (t.def.ratings.speed - 70) * 0.015;
        a.speed = Math.min(top, a.speed + dt * 7);
        a.pos.addScaledVector(a.dirIn, a.speed * dt);
        c.root.position.copy(a.pos);
        c.root.rotation.y = a.yaw;
        const dribbling = a.ballWith === 'dunker';
        c.dribbling = dribbling;
        c.setState(dribbling ? 'dribble' : 'run');
        c.update(dt, a.speed / 6.6);
        if (dribbling) {
          const p = this.ballHome(t, a, this.tmp);
          a.ball.place(p.x, p.y, p.z);
          a.ball.syncVisual();
          if (c.dribbleBounce) audio.bounce(0.5);
        }
        // Setups.
        let setup: Setup | null = null;
        let hurdle = false;
        let jump = false;
        if (isUser) {
          if (dribbling && input.pressed.y && d > 3.2) setup = 'backboard';
          else if (dribbling && input.pressed.x && d > 3.0) setup = 'bounce';
          else if (dribbling && input.pressed.b && d > 4.0) setup = 'oop';
          if (input.pressed.pick && !a.hurdler && d > 4.6) hurdle = true;
          jump = input.pressed.a;
        } else {
          const b = bot!;
          if (b.rec.hurdle && !a.hurdler) hurdle = true;
          const sp = b.rec.setup;
          if (sp && !b.calledSetup && dribbling) {
            const dur = sp === 'backboard' ? 0.94 : sp === 'bounce' ? 0.94 : 1.38;
            // Time it so the ball arrives just after takeoff (a planned miss throws it far too early).
            const toCatch = Math.max(0, d - b.takeoff) / Math.max(1, a.speed) + GATHER + CATCH_TIME - 0.04;
            if (toCatch <= dur + (b.fail === 'catch' ? 0.55 : 0)) {
              setup = sp;
              b.calledSetup = true;
            }
          }
          jump = d - a.speed * dt * 0.5 <= b.takeoff;
        }
        if (setup) this.startToss(t, a, setup);
        if (hurdle) {
          a.hurdleDist = 1.6;
          a.hurdler = this.spawnHelper(t, a, 'hurdle');
          this.combo(a, 'TEAMMATE IN THE LANE');
        }
        if (jump || d < 0.9) {
          a.state = 'gather';
          a.t = 0;
          a.plantDist = d;
          c.dribbling = false;
          if (a.ballWith === 'dunker') a.hold = 0;
          if (isUser) {
            this.app.touch.setLabels({ a: 'SLAM', b: 'REVERSE', x: '', y: '360' });
            this.app.touch.setSwipe(true);
          }
        }
        break;
      }
      case 'gather': {
        this.attemptCamera(a);
        // The plant step: the run checks as the dunker loads up.
        a.pos.addScaledVector(a.dirIn, a.speed * 0.45 * dt);
        c.root.position.copy(a.pos);
        c.setState('freestyle');
        fs.air = 0;
        fs.gather = smooth(a.t / GATHER);
        fs.tuck = 0;
        fs.hurdle = 0;
        fs.hold = a.ballWith === 'dunker' ? 0 : null;
        fs.reach = 0;
        fs.catchReach = a.ballWith === 'toss' ? 0.4 * fs.gather : 0;
        fs.move = 'none';
        fs.slam = 0;
        fs.ikWeight = 0;
        c.update(dt, 0);
        if (a.ballWith === 'dunker') {
          const p = this.ballHome(t, a, this.tmp);
          a.ball.place(p.x, p.y, p.z);
          a.ball.syncVisual();
        }
        if (a.t >= GATHER) {
          this.takeOff(t, a);
          a.state = 'air';
          a.t = 0;
        }
        break;
      }
      case 'air': {
        this.attemptCamera(a);
        // Flight: up and down on gravity; along the approach, decelerating into the rim.
        const sx = Math.min(1, a.t / a.tArr);
        const x = a.D * (1 - (1 - sx) * (1 - sx)) + Math.max(0, a.t - a.tArr) * 0.25;
        a.pos.copy(a.takeoffAt).addScaledVector(a.dirIn, x);
        const air = Math.max(0, a.v0 * a.t - 0.5 * G * a.t * a.t);
        c.root.position.copy(a.pos);
        // Spins and reverses turn the body; the base yaw already includes completed turns.
        let yaw = a.yaw;
        if (a.move?.kind === 'spin') yaw += Math.PI * 2 * smooth(a.move.t / MOVE_TIME.spin);
        if (a.move?.kind === 'reverse') yaw += Math.PI * smooth(a.move.t / MOVE_TIME.reverse);
        c.root.rotation.y = yaw;
        // Clearing the teammate: straddle him as you go over; too low and you take him out.
        if (a.hurdler?.ready && !a.fail) {
          const along = Math.hypot(this.rim.x - a.pos.x, this.rim.z - a.pos.z) - a.hurdleDist;
          fs.hurdle = clamp(1 - Math.abs(along) / 0.9, 0, 1);
          if (Math.abs(along) < 0.18) {
            if (air < 0.65) {
              a.fail = 'CLIPPED YOUR TEAMMATE';
              this.lastClip = { t: a.t, air, along, takeoff: a.takeoffDist };
            }
            else if (!a.hurdleCleared) {
              a.hurdleCleared = true;
              this.combo(a, 'OVER HIM');
            }
          }
        } else fs.hurdle = 0;
        if (a.fail && a.ballWith === 'dunker') this.drop(a, a.fail);
        // Catching the lob: reach for it; it's yours if a hand gets to it.
        const ts = a.toss;
        if (ts && !ts.caught && a.ballWith === 'toss') {
          const last = ts.segs[ts.segs.length - 1];
          const live = ts.t > last.t0 + last.dur * 0.35;
          const handR = c.handWorld(this.tmp, c.handedness > 0 ? 'r' : 'l');
          const dist = handR.distanceTo(a.ball.pos);
          fs.catchReach = live ? 1 : 0.5;
          fs.ikTarget = a.ball.pos.clone();
          fs.ikWeight = live ? clamp(1.4 - dist, 0, 1) : 0;
          const assist = !isUser && bot!.fail !== 'catch';
          // A bot planning to miss the lob never gets a hand on it.
          const canCatch = isUser || bot!.fail !== 'catch';
          if (live && canCatch && (dist < 0.62 || (assist && ts.t >= ts.dur - 0.02))) {
            ts.caught = true;
            a.ballWith = 'dunker';
            a.hold = c.handedness;
            fs.catchReach = 0;
            audio.bounce(0.25);
          }
        } else fs.catchReach = Math.max(0, fs.catchReach - dt * 6);
        // Moves and the slam.
        const holding = a.ballWith === 'dunker' && !a.released;
        if (holding) {
          let req: Move | 'slam' | null = null;
          if (isUser) {
            const f = input.flick;
            if (f) req = Math.abs(f.y) > Math.abs(f.x) ? (f.y > 0 ? 'windmill' : 'legs') : 'behind';
            if (input.pressed.y) req = 'spin';
            if (input.pressed.b) req = 'reverse';
            if (input.pressed.a) req = 'slam';
          } else {
            const b = bot!;
            const ready = a.t >= (ts ? 0 : FIRST_MOVE_AT);
            if (!a.move && !a.queue.length && ready) {
              if (b.nextMove < b.rec.moves.length) req = b.rec.moves[b.nextMove++];
              else if (a.t >= a.tArr - 0.03) req = 'slam';
            }
          }
          if (req && a.queue.length < 2 && a.slamT === null && !a.queue.includes('slam')) a.queue.push(req);
          if (!a.move && a.queue.length && a.slamT === null) {
            const nx = a.queue.shift()!;
            if (nx === 'slam') a.slamT = a.t;
            // No time left for a move: ignore it.
            else if (a.t < a.hang - 0.3) this.startMove(t, a, nx);
          }
          if (a.move) {
            a.move.t += dt;
            if (a.move.t >= MOVE_TIME[a.move.kind]) this.finishMove(t, a);
          }
        }
        // Pose.
        c.setState('freestyle');
        fs.air = air;
        fs.gather = Math.max(0, fs.gather - dt * 10);
        fs.tuck = smooth(a.t / 0.2) * (1 - smooth((a.t - (a.hang - 0.22)) / 0.2));
        fs.hold = a.ballWith === 'dunker' || a.released ? a.hold : null;
        fs.move = (a.move?.kind ?? 'none') as AirMove;
        fs.mu = a.move ? a.move.t / MOVE_TIME[a.move.kind] : 0;
        // Spins and reverses keep the ball up at the rim while the body turns under it.
        const reaching = holding && (!a.move || a.move.kind === 'spin' || a.move.kind === 'reverse');
        fs.reach = reaching || a.slamT !== null ? Math.min(1, fs.reach + dt * 7) : Math.max(0, fs.reach - dt * 8);
        if (a.ballWith !== 'toss') {
          const target = this.tmp.set(this.rim.x, RIM_H + 0.17, this.rim.z).addScaledVector(a.dirIn, -0.08);
          fs.ikTarget = target.clone();
          fs.ikWeight = reaching || a.slamT !== null ? Math.min(1, fs.ikWeight + dt * 6) : Math.max(0, fs.ikWeight - dt * 12);
        }
        fs.slam = a.slamT !== null ? smooth((a.t - a.slamT) / 0.12) : 0;
        c.update(dt, 0);
        if (holding) {
          const p = this.ballHome(t, a, this.tmp);
          a.ball.place(p.x, p.y, p.z);
          a.ball.syncVisual();
          // A cue for the slam: the hand is up at the rim.
          a.inRange = (!a.move || a.move.kind === 'spin' || a.move.kind === 'reverse') && p.y > RIM_H - 0.02 && Math.hypot(p.x - this.rim.x, p.z - this.rim.z) < 0.5;
          if (isUser) s.sub.textContent = a.inRange ? 'SLAM IT!' : a.move ? MOVE_NAME[a.move.kind].toUpperCase() : s.sub.textContent;
          if (a.slamT !== null && a.t - a.slamT >= 0.05) this.release(t, a);
          // Came down with it.
          else if (a.t > a.hang - 0.1) this.drop(a, 'CAME DOWN WITH IT');
        }
        if (a.t >= a.hang) {
          a.state = 'land';
          a.t = 0;
          fs.air = 0;
          if (a.ballWith === 'toss') this.drop(a, 'MISSED THE LOB');
          this.legendEl.innerHTML = '';
        }
        break;
      }
      case 'land': {
        this.attemptCamera(a);
        a.pos.addScaledVector(a.dirIn, Math.max(0, 1.6 - a.t * 4) * dt);
        c.root.position.copy(a.pos);
        // Turn back round to face the floor after a reverse.
        const face = Math.atan2(-a.dirIn.x, -a.dirIn.z);
        let diff = face - c.root.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        c.root.rotation.y += diff * Math.min(1, dt * 3);
        if (a.t > 0.25) c.unwrapArms();
        c.setState(a.made && !a.fail ? 'celebrate' : 'idle');
        c.update(dt, 0);
        if ((a.made !== null || a.fail) && a.t > 1.0) this.endAttempt();
        else if (a.t > 4) {
          a.made = false;
          this.endAttempt();
        }
        break;
      }
    }
  }

  destroy() {
    if (!this.finished) this.scene.destroy();
  }
}

export function dunkContest(app: App, o: ContestOptions): Screen {
  const c = new DunkContest(app, o);
  (window as any).__contest = c;
  return { el: h('div'), update: (dt) => c.update(dt), destroy: () => c.destroy() };
}
