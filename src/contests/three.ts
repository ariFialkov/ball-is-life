import * as THREE from 'three';
import type { App, Screen } from '../app/app.ts';
import { h } from '../app/app.ts';
import { RIM_H, RIM_X } from '../engine/constants.ts';
import type { Ball, BallStyle } from '../engine/ball.ts';
import type { Character } from '../engine/character.ts';
import type { PlayerDef, TeamDef } from '../data/teams.ts';
import { audio } from '../engine/audio.ts';
import { clamp, lerp } from '../core/rng.ts';
import { ContestScene, ReleaseMeter, type ContestOptions, type StandingRow } from './base.ts';
import { launchJumper, plannedMiss, releaseError } from './shotPhysics.ts';
import { USER, planRounds, rank, roundTargets, type Id, type RoundPlan } from './plan.ts';

/**
 * NBA 3-Point Contest (current format): 70 seconds, five racks around the arc
 * (four regular balls worth 1 and a money ball worth 2), one all-money rack of
 * the shooter's choice, and two deep "starry" balls worth 3 between the wings
 * and the top of the key. 40 points maximum. First round, then a final for the
 * top three. Every shot is a real ball flight; only the physics decides makes.
 */
const SIDE = 1 as const;
const TIME = 70;
const MAX_SCORE = 40;
const RACK_NAMES = ['LEFT CORNER', 'LEFT WING', 'TOP OF THE KEY', 'RIGHT WING', 'RIGHT CORNER'];
const BOT_SPEED = 2.2;

interface Station {
  kind: 'rack' | 'deep';
  rack: number;
  name: string;
  /** Where the shooter stands. */
  spot: THREE.Vector3;
  /** Where the balls sit. */
  stand: THREE.Vector3;
  /** Unit vector along the rack. */
  along: THREE.Vector3;
}

function buildStations(): Station[] {
  const rim = new THREE.Vector3(SIDE * RIM_X, 0, 0);
  const onArc = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return new THREE.Vector3(rim.x - SIDE * Math.cos(a) * r, 0, Math.sin(a) * r);
  };
  const spots: { kind: 'rack' | 'deep'; spot: THREE.Vector3 }[] = [
    { kind: 'rack', spot: new THREE.Vector3(rim.x - SIDE * 0.35, 0, -7.02) },
    { kind: 'rack', spot: onArc(-45, 7.54) },
    { kind: 'deep', spot: onArc(-22, 9.07) },
    { kind: 'rack', spot: onArc(0, 7.54) },
    { kind: 'deep', spot: onArc(22, 9.07) },
    { kind: 'rack', spot: onArc(45, 7.54) },
    { kind: 'rack', spot: new THREE.Vector3(rim.x - SIDE * 0.35, 0, 7.02) },
  ];
  let rack = 0;
  return spots.map((s) => {
    const out = new THREE.Vector3(s.spot.x - rim.x, 0, s.spot.z).normalize();
    const perp = new THREE.Vector3(-out.z, 0, out.x);
    // The rack sits just behind the shooter, to their side, along the arc.
    const stand = s.spot.clone().addScaledVector(out, 0.55).addScaledVector(perp, -0.95);
    const st: Station = { kind: s.kind, rack: s.kind === 'rack' ? rack : -1, name: s.kind === 'rack' ? RACK_NAMES[rack] : 'DEEP BALL', spot: s.spot, stand, along: perp };
    if (s.kind === 'rack') rack++;
    return st;
  });
}

interface Shot {
  station: number;
  value: 1 | 2 | 3;
  style: BallStyle;
  ball: Ball;
  rest: THREE.Vector3;
  released: boolean;
  result: boolean | null;
  /** Bots: whether this ball is planned to go in. */
  plan: boolean;
}

type TurnState = 'move' | 'pickup' | 'ready' | 'shoot' | 'recover' | 'wait' | 'done';

class Turn {
  shots: Shot[] = [];
  i = 0;
  score = 0;
  timer = TIME;
  state: TurnState = 'move';
  t = 0;
  moveFrom = new THREE.Vector3();
  meter = new ReleaseMeter();
  releaseAt = 0.44;
  constructor(
    readonly id: Id,
    readonly def: PlayerDef,
    readonly team: TeamDef,
    readonly name: string,
    readonly char: Character,
    readonly moneyRack: number,
    readonly target: number | null,
  ) {}
  get isUser() {
    return this.id === USER;
  }
  get current(): Shot | null {
    return this.shots[this.i] ?? null;
  }
}

/** Pick which balls a bot makes so the made values add up exactly to the target. */
function choosePlan(values: number[], target: number, rnd: () => number): boolean[] {
  const total = values.reduce((a, b) => a + b, 0);
  const T = Math.round(clamp(target, 0, total));
  const plan = values.map(() => rnd() < T / Math.max(1, total));
  let sum = values.reduce((a, v, i) => a + (plan[i] ? v : 0), 0);
  for (let guard = 0; guard < 400 && sum !== T; guard++) {
    const over = sum > T;
    const cands = values.map((v, i) => i).filter((i) => plan[i] === over);
    if (!cands.length) break;
    const diff = Math.abs(sum - T);
    const fit = cands.filter((i) => values[i] <= diff);
    const pool = fit.length ? fit : cands.sort((a, b) => values[a] - values[b]).slice(0, 1);
    const i = pool[Math.floor(rnd() * pool.length)];
    plan[i] = !over;
    sum += over ? -values[i] : values[i];
  }
  return plan;
}

class ThreePointContest {
  readonly scene: ContestScene;
  readonly stations = buildStations();
  readonly rim = new THREE.Vector3(SIDE * RIM_X, RIM_H, 0);
  readonly plan: RoundPlan;
  readonly r1 = new Map<Id, number>();
  readonly fin = new Map<Id, number>();
  private queue: (() => void)[] = [];
  private turn: Turn | null = null;
  private round: 1 | 2 = 1;
  private targets = new Map<Id, number>();
  private finished = false;
  private stands: THREE.Object3D[] = [];
  private boardEls: HTMLElement[][] = [];

  constructor(readonly app: App, readonly o: ContestOptions) {
    this.scene = new ContestScene(app, o.team, o.strip, o.seed);
    this.plan = planRounds(o.place, o.botsAbove, 3, () => this.scene.rng.next());
    this.buildRacks();
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
    const step = this.queue.shift();
    if (step) step();
  }

  // ---------------------------------------------------------------------------
  // Rounds

  private startRound(round: 1 | 2) {
    this.round = round;
    const s = this.scene;
    const field = round === 1 ? this.plan.r1Order : this.plan.finalOrder;
    if (round === 2 && !this.plan.userAdvances) {
      // The user is out: the final is between bots only, shown as a result card.
      let v = 17 + s.rng.int(0, 9);
      for (const id of this.plan.finalOrder) {
        this.fin.set(id, clamp(v, 0, MAX_SCORE));
        v -= s.rng.int(1, 4);
      }
      this.queue.push(() => this.roundCard(2), () => this.finish());
      this.next();
      return;
    }
    const bots = field.filter((id) => id !== USER);
    s.rng.shuffle(bots);
    this.queue.push(() => this.userTurn());
    for (const id of bots) this.queue.push(() => this.botTurn(id));
    this.queue.push(() => this.roundCard(round));
    if (round === 1) this.queue.push(() => this.startRound(2));
    else this.queue.push(() => this.finish());
    this.next();
  }

  private userTurn() {
    const s = this.scene;
    s.big.textContent = this.round === 1 ? 'ROUND 1' : 'FINAL ROUND';
    s.prompt.textContent = 'CHOOSE YOUR MONEY RACK';
    s.sub.textContent = 'Every ball on it is worth 2';
    this.stageCamera(this.stations[3]);
    s.snapCamera();
    s.choose('MONEY RACK', RACK_NAMES, (i) => this.beginTurn(USER, i), 4);
  }

  private botTurn(id: Id) {
    const s = this.scene;
    // Targets are set from the user's actual score in this round.
    if (!this.targets.size) {
      const user = (this.round === 1 ? this.r1 : this.fin).get(USER) ?? 0;
      const order = this.round === 1 ? this.plan.r1Order : this.plan.finalOrder;
      this.targets = roundTargets(user, order, { higherBetter: true, min: 0, max: MAX_SCORE, gap: [1, 5], step: 1 }, () => s.rng.next());
    }
    this.beginTurn(id, s.rng.pick([4, 4, 3, 1, 0]));
  }

  private beginTurn(id: Id, moneyRack: number) {
    const s = this.scene;
    const def = this.defOf(id);
    const team = this.teamOf(id);
    const start = this.stations[0].spot.clone().addScaledVector(new THREE.Vector3(-SIDE, 0, 0), 2.5);
    const char = s.addCharacter(def, team, start);
    const t = new Turn(id, def, team, this.name(id), char, moneyRack, id === USER ? null : this.targets.get(id) ?? 15);
    t.moveFrom.copy(start);
    this.resetRacks(t);
    if (t.target !== null) {
      const plan = choosePlan(t.shots.map((x) => x.value), t.target, () => s.rng.next());
      t.shots.forEach((x, i) => (x.plan = plan[i]));
    }
    this.turn = t;
    s.showSkip(!t.isUser);
    s.big.textContent = '0';
    s.prompt.textContent = t.isUser ? 'HOLD SHOOT, RELEASE IN THE GREEN' : `${t.name.toUpperCase()} · ${team.abbr}`;
    s.prompt.style.color = '';
    this.renderBoard(t);
    this.app.touch.setLabels({ a: 'SHOOT', b: '', x: '', y: '' });
  }

  private endTurn() {
    const s = this.scene;
    const t = this.turn!;
    (this.round === 1 ? this.r1 : this.fin).set(t.id, t.score);
    if (t.isUser) this.targets = new Map();
    s.removeCharacter(t.char);
    s.clearBalls();
    s.showSkip(false);
    s.setMeter(null);
    this.turn = null;
    this.next();
  }

  private roundCard(round: 1 | 2) {
    const s = this.scene;
    const res = round === 1 ? this.r1 : this.fin;
    const intended = round === 1 ? this.plan.r1Order : this.plan.finalOrder;
    const { order } = rank(res, intended, true);
    s.big.textContent = round === 1 ? 'ROUND 1' : 'FINAL';
    s.prompt.textContent = '';
    s.sub.textContent = '';
    this.renderBoard(null);
    s.card(
      round === 1 ? 'FIRST ROUND · TOP 3 ADVANCE' : 'CHAMPIONSHIP ROUND',
      order.map((id, i) => ({ name: this.name(id), team: this.teamOf(id), value: `${res.get(id)} PTS`, tag: round === 1 ? (i < 3 ? 'ADVANCES' : 'OUT') : i === 0 ? 'CHAMPION' : '', you: id === USER })),
      () => this.next(),
    );
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    const finalRank = rank(this.fin, this.plan.finalOrder, true);
    const r1Only = new Map([...this.r1].filter(([id]) => !this.fin.has(id)));
    const r1Rank = rank(r1Only, this.plan.r1Order, true);
    const ids = [...finalRank.order, ...r1Rank.order];
    const rows: StandingRow[] = ids.map((id) => ({ id, name: this.name(id), team: this.teamOf(id), r1: this.r1.get(id) ?? 0, final: this.fin.get(id) ?? null }));
    this.scene.destroy();
    this.o.onFinish({ rows, place: ids.indexOf(USER) + 1, unit: 'PTS', higherBetter: true, tiebreak: finalRank.tiebreak || r1Rank.tiebreak });
  }

  // ---------------------------------------------------------------------------
  // Racks and balls

  private buildRacks() {
    const s = this.scene;
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, metalness: 0.5, roughness: 0.4 });
    const accent = new THREE.MeshStandardMaterial({ color: this.o.team.colors.primary, emissive: new THREE.Color(this.o.team.colors.primary).multiplyScalar(0.3) });
    for (const st of this.stations) {
      const g = new THREE.Group();
      const len = st.kind === 'rack' ? 1.45 : 0.45;
      const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.36), accent);
      top.position.y = 0.74;
      g.add(top);
      for (const dx of [-len / 2 + 0.06, len / 2 - 0.06]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.74, 0.3), mat);
        leg.position.set(dx, 0.37, 0);
        g.add(leg);
      }
      g.position.copy(st.stand);
      g.rotation.y = Math.atan2(st.along.z, -st.along.x) + Math.PI;
      g.rotation.y = Math.atan2(-st.along.z, st.along.x);
      s.group.add(g);
      this.stands.push(g);
    }
  }

  private resetRacks(t: Turn) {
    const s = this.scene;
    s.clearBalls();
    for (let si = 0; si < this.stations.length; si++) {
      const st = this.stations[si];
      const n = st.kind === 'rack' ? 5 : 1;
      for (let k = 0; k < n; k++) {
        const money = st.kind === 'rack' && (st.rack === t.moneyRack || k === n - 1);
        const style: BallStyle = st.kind === 'deep' ? 'starry' : money ? 'money' : 'standard';
        const rest = st.stand.clone().addScaledVector(st.along, (k - (n - 1) / 2) * 0.27);
        rest.y = 0.89;
        const ball = s.spawnBall(style, rest);
        t.shots.push({ station: si, value: st.kind === 'deep' ? 3 : money ? 2 : 1, style, ball, rest, released: false, result: null, plan: false });
      }
    }
  }

  private renderBoard(t: Turn | null) {
    const s = this.scene;
    s.board.innerHTML = '';
    this.boardEls = [];
    if (!t) return;
    const wrap = h('div', { class: 'tp-board' });
    this.stations.forEach((st, si) => {
      const grp = h('div', { class: `tp-st${st.kind === 'deep' ? ' deep' : ''}` });
      const els: HTMLElement[] = [];
      for (const shot of t.shots.filter((x) => x.station === si)) {
        const e = h('span', { class: `tp-ball ${shot.style}` });
        grp.append(e);
        els.push(e);
      }
      wrap.append(grp);
      this.boardEls.push(els);
    });
    s.board.append(wrap);
  }

  private markBoard(t: Turn, shot: Shot) {
    const idx = t.shots.filter((x) => x.station === shot.station).indexOf(shot);
    const el = this.boardEls[shot.station]?.[idx];
    if (el) el.classList.add(shot.result ? 'made' : 'miss');
  }

  // ---------------------------------------------------------------------------
  // Shooting

  private stageCamera(st: Station) {
    const out = new THREE.Vector3(st.spot.x - this.rim.x, 0, st.spot.z).normalize();
    const pos = st.spot.clone().addScaledVector(out, 4.4).addScaledVector(new THREE.Vector3(-out.z, 0, out.x), 1.3);
    pos.y = 2.9;
    const look = st.spot.clone().lerp(new THREE.Vector3(this.rim.x, 0, 0), 0.55);
    look.y = 2.3;
    this.scene.cam(pos, look, 3);
  }

  private releasePoint(t: Turn): THREE.Vector3 {
    const c = t.char;
    const yaw = c.root.rotation.y;
    return new THREE.Vector3(c.root.position.x + Math.sin(yaw) * 0.28, clamp(1.18 * t.def.height, 2.2, 2.55), c.root.position.z + Math.cos(yaw) * 0.28);
  }

  private release(t: Turn, q: number | null) {
    const s = this.scene;
    const shot = t.current!;
    shot.released = true;
    let err;
    if (t.isUser) err = releaseError(q ?? 0, t.def.ratings.three, () => s.rng.next());
    else err = shot.plan ? { long: 0, side: 0 } : plannedMiss(s.rng.int(0, 3));
    launchJumper(shot.ball, this.releasePoint(t), SIDE, err, s.time, shot.value);
    s.track(shot.ball, (made) => this.resolve(t, shot, made));
    if (t.isUser && q !== null) {
      s.prompt.textContent = q > 0.9 ? 'GREEN!' : q > 0.65 ? 'GOOD RELEASE' : q > 0.35 ? 'SLIGHTLY OFF' : 'WAY OFF';
      s.prompt.style.color = q > 0.9 ? '#38ff7a' : q > 0.65 ? '#ffd166' : '#ff6b6b';
    }
  }

  private resolve(t: Turn, shot: Shot, made: boolean) {
    shot.result = made;
    if (made) {
      t.score += shot.value;
      this.scene.big.textContent = String(t.score);
      audio.cheer(shot.value > 1 ? 0.8 : 0.4);
    }
    if (this.turn === t) this.markBoard(t, shot);
    // A bot whose ball did not do what was planned re-plans the balls it has not shot yet.
    if (!t.isUser && made !== shot.plan && t.target !== null) {
      const pending = t.shots.filter((x) => x.released && x.result === null && x.plan).reduce((a, x) => a + x.value, 0);
      const rest = t.shots.filter((x) => !x.released);
      const plan = choosePlan(rest.map((x) => x.value), t.target - t.score - pending, () => this.scene.rng.next());
      rest.forEach((x, i) => (x.plan = plan[i]));
    }
  }

  /** Skip a bot's turn: finish every remaining ball with the same physics, instantly. */
  private skipTurn(t: Turn) {
    const s = this.scene;
    s.settleAll();
    while (t.current && t.timer > 0) {
      const st = this.stations[t.current.station];
      t.char.root.position.copy(st.spot);
      s.face(t.char, this.rim);
      this.release(t, null);
      s.settleAll();
      t.timer -= 1.0;
      t.i++;
    }
    this.endTurn();
  }

  update(dtReal: number) {
    const s = this.scene;
    const t = this.turn;
    const dt = t && !t.isUser ? dtReal * BOT_SPEED : dtReal;
    s.update(dt);
    s.stepBalls(dt);
    if (!t) return;
    if (!t.isUser && s.takeSkip()) {
      this.skipTurn(t);
      return;
    }
    const input = this.app.input.state;
    const shot = t.current;
    const st = shot ? this.stations[shot.station] : this.stations[this.stations.length - 1];
    if (t.state !== 'wait' && t.state !== 'done') {
      t.timer -= dt;
      if (t.timer <= 0) {
        t.timer = 0;
        audio.buzzer();
        // A ball still in the hands at the horn does not count.
        if (shot && !shot.released) shot.ball.mesh.visible = false;
        t.state = 'wait';
        s.setMeter(null);
      }
    }
    s.sub.textContent = `${t.timer > 0 ? st.name : 'TIME'} · ${Math.ceil(t.timer)}s`;
    t.t += dt;
    const c = t.char;
    switch (t.state) {
      case 'move': {
        const dur = t.i === 0 ? 0.8 : 0.85;
        const u = Math.min(1, t.t / dur);
        const k = u * u * (3 - 2 * u);
        c.root.position.lerpVectors(t.moveFrom, st.spot, k);
        s.face(c, u < 0.75 ? st.spot.clone().add(st.spot.clone().sub(t.moveFrom)) : this.rim);
        c.setState('run');
        c.update(dt, 0.55 * Math.sin(Math.PI * u));
        this.stageCamera(st);
        if (u >= 1) {
          s.face(c, this.rim);
          t.state = 'pickup';
          t.t = 0;
        }
        break;
      }
      case 'pickup': {
        const u = Math.min(1, t.t / 0.28);
        c.setState('catch');
        c.update(dt, 0);
        const hand = c.handWorld(new THREE.Vector3());
        shot!.ball.place(lerp(shot!.rest.x, hand.x, u), lerp(shot!.rest.y, hand.y, u), lerp(shot!.rest.z, hand.z, u));
        shot!.ball.syncVisual();
        if (u >= 1) {
          t.state = 'ready';
          t.t = 0;
        }
        break;
      }
      case 'ready': {
        c.setState('idleBall');
        c.update(dt, 0);
        s.holdIn(shot!.ball, c, true);
        const go = t.isUser ? input.held.a : t.t > 0.06;
        if (go) {
          t.state = 'shoot';
          t.t = 0;
          c.setState('shoot');
          if (t.isUser) t.meter.start();
        }
        break;
      }
      case 'shoot': {
        c.update(dt, 0);
        if (!shot!.released) {
          s.holdIn(shot!.ball, c);
          if (t.isUser) {
            t.meter.update(dt);
            s.setMeter(t.meter.t01, t.meter.greenBand);
            if (!input.held.a || t.meter.t01 > 1.15) {
              const q = t.meter.release();
              s.setMeter(null);
              this.release(t, q);
            }
          } else if (t.t >= t.releaseAt) this.release(t, null);
        }
        if (shot!.released && t.t >= 0.62) {
          t.state = 'recover';
          t.t = 0;
        }
        break;
      }
      case 'recover': {
        c.update(dt, 0);
        if (t.t >= 0.08) {
          t.i++;
          t.t = 0;
          const nxt = t.current;
          if (!nxt) t.state = 'wait';
          else if (nxt.station !== shot!.station) {
            t.moveFrom.copy(c.root.position);
            t.state = 'move';
          } else t.state = 'pickup';
        }
        break;
      }
      case 'wait': {
        c.setState('idle');
        c.update(dt, 0);
        if (s.inFlight === 0) {
          t.state = 'done';
          t.t = 0;
          s.prompt.textContent = `${t.score} POINTS`;
          s.prompt.style.color = '';
        }
        break;
      }
      case 'done': {
        c.update(dt, 0);
        if (t.t > (t.isUser ? 1.6 : 0.8)) this.endTurn();
        break;
      }
    }
  }

  destroy() {
    if (!this.finished) this.scene.destroy();
  }
}

export function threePointContest(app: App, o: ContestOptions): Screen {
  const c = new ThreePointContest(app, o);
  (window as any).__contest = c;
  return { el: h('div'), update: (dt) => c.update(dt), destroy: () => c.destroy() };
}
