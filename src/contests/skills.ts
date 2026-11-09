import * as THREE from 'three';
import type { App, Screen } from '../app/app.ts';
import { h } from '../app/app.ts';
import { BALL_R, HALF_L, HALF_W, RIM_H, RIM_X } from '../engine/constants.ts';
import type { Ball } from '../engine/ball.ts';
import type { Character } from '../engine/character.ts';
import type { PlayerDef, TeamDef } from '../data/teams.ts';
import { audio } from '../engine/audio.ts';
import { clamp } from '../core/rng.ts';
import { ContestScene, ReleaseMeter, type ContestOptions, type StandingRow } from './base.ts';
import { launchJumper, plannedMiss, releaseError } from './shotPhysics.ts';
import { USER, planRounds, rank, roundTargets, type Id, type RoundPlan } from './plan.ts';

/**
 * NBA Skills Challenge (classic individual course): dribble through the
 * chairs to half court, hit the chest-pass target, make a layup at the far
 * basket, then dribble back to the top of the key and make a three. Every
 * pass and shot must go in before moving on; fastest time wins. First round,
 * then a final between the two fastest.
 */
const BOT_SPEED = 2.0;
const CHAIRS = [-10.5, -7.5, -4.5, -1.5];
const GATE_SIDE = [1, -1, 1, -1];
const CONE_Z = 2.4;
const PASS_SPOT = new THREE.Vector3(1.6, 0, 2.2);
const TARGET = new THREE.Vector3(5.4, 1.5, 6.3);
const TARGET_R = 0.42;
const START = new THREE.Vector3(-HALF_L + 1.0, 0, 0);
const THREE_SPOT = new THREE.Vector3(-RIM_X + 7.6, 0, 0);

type Stage = 'slalom' | 'pass' | 'layup' | 'three' | 'done';

interface Run {
  id: Id;
  def: PlayerDef;
  team: TeamDef;
  name: string;
  char: Character;
  ball: Ball;
  stage: Stage;
  gate: number;
  time: number;
  started: boolean;
  vel: THREE.Vector3;
  /** Ball is in the air (pass or shot); the runner waits for it. */
  busy: boolean;
  /** Seconds until a missed ball comes back to the runner. */
  regain: number;
  meter: ReleaseMeter;
  sweep: number;
  penalties: number;
  finished: number;
  /** Bots: planned misses per task and cruising speed. */
  misses: { pass: number; layup: number; three: number };
  speed: number;
  waypoints: THREE.Vector3[];
  wp: number;
  facing: number;
  /** Bots: planned finishing time. */
  target: number;
}

function botPath(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [START.clone()];
  CHAIRS.forEach((x, i) => pts.push(new THREE.Vector3(x, 0, GATE_SIDE[i] * CONE_Z * 0.5)));
  pts.push(PASS_SPOT.clone());
  pts.push(new THREE.Vector3(RIM_X - 1.2, 0, 0.5));
  pts.push(THREE_SPOT.clone());
  return pts;
}

function pathLength(pts: THREE.Vector3[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]);
  return L;
}

class SkillsChallenge {
  readonly scene: ContestScene;
  readonly plan: RoundPlan;
  readonly r1 = new Map<Id, number>();
  readonly fin = new Map<Id, number>();
  private queue: (() => void)[] = [];
  private run: Run | null = null;
  private round: 1 | 2 = 1;
  private targets = new Map<Id, number>();
  private finished = false;
  private passRing: THREE.Mesh;
  private markers: THREE.Mesh[] = [];
  private passMeterEl: HTMLElement;

  constructor(readonly app: App, readonly o: ContestOptions) {
    this.scene = new ContestScene(app, o.team, o.strip, o.seed);
    this.plan = planRounds(o.place, o.botsAbove, 2, () => this.scene.rng.next());
    this.passRing = this.buildCourse();
    this.passMeterEl = h('div', { class: 'timing-ring' }, h('div', { class: 'timing-inner' }), h('div', { class: 'timing-outer' }));
    this.passMeterEl.style.display = 'none';
    this.scene.hud.append(this.passMeterEl);
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

  private buildCourse(): THREE.Mesh {
    const s = this.scene;
    const team = this.o.team;
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x23232b, roughness: 0.6 });
    const seatMat = new THREE.MeshStandardMaterial({ color: team.colors.primary });
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0x552200 });
    CHAIRS.forEach((x, i) => {
      const chair = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), seatMat);
      seat.position.y = 0.48;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.05), seatMat);
      back.position.set(0, 0.75, -0.22);
      chair.add(seat, back);
      for (const [dx, dz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.48, 0.04), chairMat);
        leg.position.set(dx, 0.24, dz);
        chair.add(leg);
      }
      chair.position.set(x, 0, 0);
      chair.rotation.y = -Math.PI / 2;
      s.group.add(chair);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 12), coneMat);
      cone.position.set(x, 0.25, GATE_SIDE[i] * CONE_Z);
      s.group.add(cone);
      // An arrow on the floor shows which side of the chair to go.
      const arrow = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.32, 3), new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide }));
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.set(x, 0.02, GATE_SIDE[i] * CONE_Z * 0.5);
      s.group.add(arrow);
      this.markers.push(arrow);
    });
    // Chest-pass target: a ring on a stand, facing the passing spot.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(TARGET_R, 0.05, 10, 32), new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0x551010 }));
    ring.position.copy(TARGET);
    ring.lookAt(PASS_SPOT.x, TARGET.y, PASS_SPOT.z);
    s.group.add(ring);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, TARGET.y - TARGET_R), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    pole.position.set(TARGET.x, (TARGET.y - TARGET_R) / 2, TARGET.z);
    s.group.add(pole);
    for (const p of [PASS_SPOT, THREE_SPOT]) {
      const spot = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 32), new THREE.MeshBasicMaterial({ color: 0x38ff7a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      spot.rotation.x = -Math.PI / 2;
      spot.position.set(p.x, 0.02, p.z);
      s.group.add(spot);
    }
    return ring;
  }

  // ---------------------------------------------------------------------------
  // Rounds

  private startRound(round: 1 | 2) {
    this.round = round;
    const s = this.scene;
    if (round === 2 && !this.plan.userAdvances) {
      let v = 13 + s.rng.float(0, 6);
      for (const id of this.plan.finalOrder) {
        this.fin.set(id, Math.round(v * 10) / 10);
        v += s.rng.float(0.5, 3);
      }
      this.queue.push(() => this.roundCard(2), () => this.finish());
      this.next();
      return;
    }
    const field = round === 1 ? this.plan.r1Order : this.plan.finalOrder;
    const bots = s.rng.shuffle(field.filter((id) => id !== USER));
    this.queue.push(() => this.begin(USER));
    for (const id of bots) this.queue.push(() => this.begin(id));
    this.queue.push(() => this.roundCard(round));
    this.queue.push(round === 1 ? () => this.startRound(2) : () => this.finish());
    this.next();
  }

  private begin(id: Id) {
    const s = this.scene;
    if (id !== USER && !this.targets.size) {
      const user = (this.round === 1 ? this.r1 : this.fin).get(USER) ?? 25;
      const order = this.round === 1 ? this.plan.r1Order : this.plan.finalOrder;
      this.targets = roundTargets(user, order, { higherBetter: false, min: 9.5, max: 120, gap: [0.6, 4], step: 0.1 }, () => s.rng.next());
    }
    const def = this.defOf(id);
    const team = this.teamOf(id);
    const char = s.addCharacter(def, team, START);
    const ball = s.spawnBall('standard');
    const waypoints = botPath();
    const r: Run = { id, def, team, name: this.name(id), char, ball, stage: 'slalom', gate: 0, time: 0, started: false, vel: new THREE.Vector3(), busy: false, regain: 0, meter: new ReleaseMeter(), sweep: 0, penalties: 0, finished: 0, misses: { pass: 0, layup: 0, three: 0 }, speed: 5.5, waypoints, wp: 1, facing: Math.PI / 2, target: 0 };
    char.root.rotation.y = r.facing;
    if (id !== USER) this.planBot(r, this.targets.get(id) ?? 25);
    this.run = r;
    s.showSkip(id !== USER);
    s.big.textContent = '0.0';
    s.prompt.textContent = id === USER ? 'MOVE TO START · THROUGH THE CHAIRS ON THE ARROW SIDE' : `${r.name.toUpperCase()} · ${team.abbr}`;
    s.sub.textContent = this.round === 1 ? 'ROUND 1' : 'FINAL';
    this.markers.forEach((m) => ((m.material as THREE.MeshBasicMaterial).color.set(0xffd166)));
    this.app.touch.setLabels({ a: 'SHOOT', b: 'PASS', x: 'SPRINT', y: '' });
  }

  /** Bots: misses and cruising speed that make the run take the target time. */
  private planBot(r: Run, target: number) {
    const s = this.scene;
    const L = pathLength(r.waypoints);
    const tasks = 0.7 + 1.1 + 1.3;
    const cost = { pass: 1.4, layup: 1.3, three: 1.9 };
    let spare = target - tasks;
    const order: (keyof typeof cost)[] = ['three', 'pass', 'layup', 'three'];
    // Slow runs come from misses rather than jogging.
    // Slow runs come from misses (real ones) rather than jogging.
    for (let n = 0; n < 40 && L / spare < 3.4; n++) {
      const k = order[n % order.length];
      if (spare - cost[k] <= L / 6.8) break;
      r.misses[k]++;
      spare -= cost[k];
    }
    r.speed = clamp(L / Math.max(0.5, spare), 2.5, 7.2);
    r.target = target;
    void s;
  }

  private finishRun(r: Run) {
    const s = this.scene;
    const time = Math.round((r.time + r.penalties) * 10) / 10;
    (this.round === 1 ? this.r1 : this.fin).set(r.id, time);
    if (r.id === USER) this.targets = new Map();
    s.removeCharacter(r.char);
    s.clearBalls();
    s.showSkip(false);
    s.setMeter(null);
    this.passMeterEl.style.display = 'none';
    this.run = null;
    this.next();
  }

  private roundCard(round: 1 | 2) {
    const res = round === 1 ? this.r1 : this.fin;
    const { order } = rank(res, round === 1 ? this.plan.r1Order : this.plan.finalOrder, false);
    this.scene.prompt.textContent = '';
    this.scene.card(
      round === 1 ? 'FIRST ROUND · FASTEST 2 ADVANCE' : 'FINAL',
      order.map((id, i) => ({ name: this.name(id), team: this.teamOf(id), value: `${res.get(id)!.toFixed(1)}s`, tag: round === 1 ? (i < 2 ? 'ADVANCES' : 'OUT') : i === 0 ? 'CHAMPION' : '', you: id === USER })),
      () => this.next(),
    );
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    const f = rank(this.fin, this.plan.finalOrder, false);
    const r1Only = new Map([...this.r1].filter(([id]) => !this.fin.has(id)));
    const r = rank(r1Only, this.plan.r1Order, false);
    const ids = [...f.order, ...r.order];
    const rows: StandingRow[] = ids.map((id) => ({ id, name: this.name(id), team: this.teamOf(id), r1: this.r1.get(id) ?? 0, final: this.fin.get(id) ?? null }));
    this.scene.destroy();
    this.o.onFinish({ rows, place: ids.indexOf(USER) + 1, unit: 's', higherBetter: false, tiebreak: f.tiebreak || r.tiebreak });
  }

  // ---------------------------------------------------------------------------
  // Course mechanics

  private stageDir(r: Run): THREE.Vector3 {
    const p = r.char.root.position;
    if (r.stage === 'pass') {
      const to = hDist(p, PASS_SPOT) > 2 ? PASS_SPOT : TARGET;
      return new THREE.Vector3(to.x - p.x, 0, to.z - p.z).normalize();
    }
    if (r.stage === 'three') return hDist(p, THREE_SPOT) > 1.5 ? new THREE.Vector3(THREE_SPOT.x - p.x, 0, THREE_SPOT.z - p.z).normalize() : new THREE.Vector3(-1, 0, 0);
    return new THREE.Vector3(1, 0, 0);
  }

  private camera(r: Run) {
    const dir = this.stageDir(r);
    const p = r.char.root.position;
    const pos = p.clone().addScaledVector(dir, -5.4);
    pos.y = 3.5;
    const look = p.clone().addScaledVector(dir, 3.2);
    look.y = 1.2;
    this.scene.cam(pos, look, 3.2);
  }

  private dribble(r: Run) {
    const c = r.char;
    const hand = c.handWorld(new THREE.Vector3());
    const ph = (c.dribblePhase / (Math.PI * 2)) % 1;
    const top = Math.max(0.7, hand.y - 0.05);
    const yaw = c.root.rotation.y;
    r.ball.mode = 'held';
    r.ball.place(hand.x + Math.sin(yaw) * 0.18, top - (top - BALL_R) * Math.sin(ph * Math.PI), hand.z + Math.cos(yaw) * 0.18);
    r.ball.syncVisual();
  }

  /** Chairs and cones are solid. */
  private collide(p: THREE.Vector3) {
    CHAIRS.forEach((x, i) => {
      for (const [ox, oz, rad] of [[x, 0, 0.62], [x, GATE_SIDE[i] * CONE_Z, 0.4]] as [number, number, number][]) {
        const dx = p.x - ox;
        const dz = p.z - oz;
        const d = Math.hypot(dx, dz);
        if (d < rad && d > 1e-4) {
          p.x = ox + (dx / d) * rad;
          p.z = oz + (dz / d) * rad;
        }
      }
    });
    p.x = clamp(p.x, -HALF_L + 0.3, HALF_L - 0.3);
    p.z = clamp(p.z, -HALF_W + 0.3, HALF_W - 0.3);
  }

  private checkGates(r: Run, prevX: number) {
    if (r.stage !== 'slalom') return;
    const x = CHAIRS[r.gate];
    const p = r.char.root.position;
    if (prevX < x && p.x >= x) {
      const ok = Math.sign(p.z) === GATE_SIDE[r.gate] && Math.abs(p.z) < CONE_Z;
      (this.markers[r.gate].material as THREE.MeshBasicMaterial).color.set(ok ? 0x38ff7a : 0xff4d4d);
      if (!ok) {
        r.penalties += 1;
        this.scene.prompt.textContent = 'WRONG SIDE · +1s';
      } else audio.click();
      r.gate++;
      if (r.gate >= CHAIRS.length) {
        r.stage = 'pass';
        this.scene.prompt.textContent = r.id === USER ? 'GET TO THE GREEN SPOT · PASS IN THE GREEN' : this.scene.prompt.textContent;
      }
    }
  }

  private doPass(r: Run, q: number) {
    const s = this.scene;
    const ball = r.ball;
    const from = r.char.handWorld(new THREE.Vector3());
    from.y = Math.max(1.3, from.y);
    const toT = new THREE.Vector3().subVectors(TARGET, from);
    const right = new THREE.Vector3(-toT.z, 0, toT.x).normalize();
    const miss = r.id === USER ? (1 - q) * 0.95 : r.misses.pass > 0 ? 0.85 : 0;
    const ang = s.rng.float(0, Math.PI * 2);
    const aim = TARGET.clone().addScaledVector(right, Math.cos(ang) * miss).add(new THREE.Vector3(0, Math.sin(ang) * miss * 0.7, 0));
    ball.place(from.x, from.y, from.z);
    ball.mode = 'pass';
    ball.launchTo(aim, 0.5);
    r.busy = true;
    r.char.setState('pass');
    const normal = toT.clone().normalize();
    let prevSide = 0;
    let done = false;
    // Watch the ball through the target's plane.
    const watch = () => {
      if (done) return;
      const rel = new THREE.Vector3().subVectors(ball.pos, TARGET);
      const side = Math.sign(rel.dot(normal));
      if (prevSide < 0 && side >= 0) {
        done = true;
        const hit = rel.sub(normal.clone().multiplyScalar(rel.dot(normal))).length() < TARGET_R - BALL_R * 0.4;
        this.passResult(r, hit);
        return;
      }
      prevSide = side || prevSide;
      if (ball.pos.y < 0.3 || this.scene.time - started > 1.6) {
        done = true;
        this.passResult(r, false);
      }
    };
    const started = this.scene.time;
    this.watchers.push(watch);
  }

  private watchers: (() => void)[] = [];

  private passResult(r: Run, hit: boolean) {
    const s = this.scene;
    if (hit) {
      audio.cheer(0.4);
      s.prompt.textContent = 'ON TARGET!';
      r.stage = 'layup';
      r.busy = false;
      r.regain = 0.15;
      if (r.id === USER) s.sub.textContent = 'DRIVE AND PRESS SHOOT AT THE RIM';
    } else {
      s.prompt.textContent = 'MISSED THE TARGET · AGAIN';
      if (r.id !== USER) r.misses.pass = Math.max(0, r.misses.pass - 1);
      r.regain = 0.9;
    }
  }

  private shoot(r: Run, kind: 'layup' | 'three', q: number) {
    const s = this.scene;
    const side = kind === 'layup' ? 1 : -1;
    const c = r.char;
    const p = c.root.position;
    const rimX = side * RIM_X;
    const toward = new THREE.Vector3(rimX - p.x, 0, -p.z).normalize();
    const from = p.clone().addScaledVector(toward, kind === 'layup' ? 0.5 : 0.28);
    from.y = kind === 'layup' ? 2.85 : clamp(1.18 * r.def.height, 2.2, 2.55);
    let err;
    if (r.id === USER) {
      if (kind === 'layup') {
        const speed = r.vel.length();
        err = releaseError(clamp(0.95 - Math.max(0, speed - 4) * 0.12, 0, 1), r.def.ratings.inside, () => s.rng.next());
      } else err = releaseError(q, r.def.ratings.three, () => s.rng.next());
    } else err = r.misses[kind] > 0 ? plannedMiss(s.rng.int(0, 3), kind === 'layup') : { long: 0, side: 0 };
    c.setState(kind === 'layup' ? 'layup' : 'shoot');
    launchJumper(r.ball, from, side as 1 | -1, err, s.time, kind === 'layup' ? 2 : 3);
    r.busy = true;
    s.track(r.ball, (made) => {
      if (made) {
        audio.cheer(kind === 'three' ? 0.8 : 0.4);
        if (kind === 'layup') {
          r.stage = 'three';
          r.busy = false;
          r.regain = 0.35;
          s.prompt.textContent = r.id === USER ? 'BACK TO THE TOP OF THE KEY AT THE OTHER END' : s.prompt.textContent;
        } else {
          r.stage = 'done';
          r.finished = 0;
          s.prompt.textContent = `${(r.time + r.penalties).toFixed(1)}s`;
        }
      } else {
        if (r.id !== USER) r.misses[kind] = Math.max(0, r.misses[kind] - 1);
        s.prompt.textContent = kind === 'layup' ? 'MISSED THE LAYUP · AGAIN' : 'MISSED · GET IT AND SHOOT AGAIN';
        r.regain = kind === 'layup' ? 0.8 : 1.3;
      }
    });
  }

  private skipRun(r: Run) {
    r.time = (this.targets.get(r.id) ?? r.time) - r.penalties;
    this.finishRun(r);
  }

  update(dtReal: number) {
    const s = this.scene;
    const r = this.run;
    const dt = r && r.id !== USER ? dtReal * BOT_SPEED : dtReal;
    s.update(dt);
    s.stepBalls(dt);
    for (const w of [...this.watchers]) w();
    if (r && r.ball.mode === 'pass') r.ball.step(dt, s.time);
    if (!r) return;
    if (r.id !== USER && s.takeSkip()) {
      this.skipRun(r);
      return;
    }
    const c = r.char;
    const p = c.root.position;
    const input = this.app.input.state;
    const prevX = p.x;
    if (r.started && r.stage !== 'done') r.time += dt;
    s.big.textContent = (r.time + r.penalties).toFixed(1);
    this.camera(r);
    if (r.stage === 'done') {
      c.setState('celebrate');
      c.update(dt, 0);
      r.finished += dt;
      if (r.finished > (r.id === USER ? 1.8 : 0.9)) this.finishRun(r);
      return;
    }
    // A missed ball comes back to the runner after a moment.
    if (r.regain > 0) {
      r.regain -= dt;
      if (r.regain <= 0) {
        this.watchers = [];
        s.removeBall(r.ball);
        r.ball = s.spawnBall('standard');
        r.busy = false;
      }
    }
    // Movement.
    const want = new THREE.Vector3();
    let speedMax = 0;
    if (r.id === USER) {
      const mag = Math.min(1, Math.hypot(input.move.x, input.move.y));
      this.app.camera.moveToWorld(input.move.x, input.move.y, want);
      speedMax = (input.sprint ? 6.1 : 5.0) * mag;
      if (mag > 0.1) r.started = true;
    } else {
      r.started = true;
      const limit = { slalom: 5, pass: 5, layup: 6, three: 7, done: 7 }[r.stage];
      const wp = r.waypoints[Math.min(r.wp, limit)];
      want.set(wp.x - p.x, 0, wp.z - p.z);
      const d = want.length();
      if (d < 0.45 && r.wp < limit) r.wp++;
      want.normalize();
      speedMax = this.botPace(r) * clamp(d / 0.9, 0.35, 1);
    }
    const stopped = r.busy || r.regain > 0;
    r.vel.lerp(want.multiplyScalar(stopped ? 0 : speedMax), Math.min(1, dt * 9));
    p.addScaledVector(r.vel, dt);
    this.collide(p);
    if (r.vel.lengthSq() > 0.3) r.facing = Math.atan2(r.vel.x, r.vel.z);
    if (!r.busy && c.state !== 'pass' && c.state !== 'shoot' && c.state !== 'layup') c.setState(r.vel.length() > 0.4 ? 'dribble' : 'idleBall');
    if ((c.state === 'pass' || c.state === 'shoot' || c.state === 'layup') && c.stateTime > 1.0) c.setState('idleBall');
    let diff = r.facing - c.root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    c.root.rotation.y += diff * Math.min(1, dt * 10);
    c.update(dt, clamp(r.vel.length() / 6.6, 0, 1));
    if (!r.busy && r.ball.mode !== 'shot' && r.ball.mode !== 'pass') this.dribble(r);
    this.checkGates(r, prevX);
    this.tasks(r, dt);
  }

  /** Bots re-pace every frame so the run finishes on the planned time. */
  private botPace(r: Run): number {
    const p = r.char.root.position;
    const limit = 7;
    let remL = 0;
    let prev = p;
    for (let i = r.wp; i <= limit; i++) {
      remL += hDist(prev, r.waypoints[i]);
      prev = r.waypoints[i];
    }
    const order: Stage[] = ['slalom', 'pass', 'layup', 'three'];
    const at = order.indexOf(r.stage);
    let tasks = 0;
    if (at <= 1) tasks += 0.7 + r.misses.pass * 1.4;
    if (at <= 2) tasks += 1.1 + r.misses.layup * 1.3;
    if (at <= 3) tasks += 1.3 + r.misses.three * 1.9;
    const left = r.target - (r.time + r.penalties);
    return clamp(remL / Math.max(0.3, left - tasks), 2.0, 7.5);
  }

  private atTask(r: Run) {
    const p = r.char.root.position;
    return (r.stage === 'pass' && hDist(p, PASS_SPOT) < 0.5) || (r.stage === 'three' && hDist(p, THREE_SPOT) < 0.5);
  }

  private tasks(r: Run, dt: number) {
    const s = this.scene;
    const input = this.app.input.state;
    const p = r.char.root.position;
    const user = r.id === USER;
    if (r.busy || r.regain > 0) {
      s.setMeter(null);
      this.passMeterEl.style.display = 'none';
      return;
    }
    if (r.stage === 'pass') {
      const on = hDist(p, PASS_SPOT) < 0.85;
      this.passMeterEl.style.display = on && user ? '' : 'none';
      if (!on) return;
      r.facing = Math.atan2(TARGET.x - p.x, TARGET.z - p.z);
      r.sweep += dt;
      const t01 = (Math.sin(r.sweep * 4.2) + 1) / 2;
      (this.passMeterEl.querySelector('.timing-outer') as HTMLElement).style.transform = `translate(-50%,-50%) scale(${1 + t01 * 1.6})`;
      if (user ? input.pressed.b : r.sweep > 0.35) {
        this.passMeterEl.style.display = 'none';
        this.doPass(r, user ? clamp(1 - t01 / 0.35, 0, 1) : 1);
        r.sweep = 0;
      }
    } else if (r.stage === 'layup') {
      const d = Math.hypot(RIM_X - p.x, p.z);
      if (d < 2.6 && (user ? input.pressed.a : d < 1.6)) this.shoot(r, 'layup', 1);
    } else if (r.stage === 'three') {
      const on = hDist(p, THREE_SPOT) < 0.9;
      if (!on) {
        s.setMeter(null);
        return;
      }
      r.facing = Math.atan2(-RIM_X - p.x, -p.z);
      if (user) {
        if (input.pressed.a && !r.meter.active) {
          r.meter.start();
          r.char.setState('shoot');
        }
        if (r.meter.active) {
          r.meter.update(dt);
          s.setMeter(r.meter.t01, r.meter.greenBand);
          if (!input.held.a || r.meter.t01 > 1.15) {
            const q = r.meter.release();
            s.setMeter(null);
            s.prompt.textContent = q > 0.9 ? 'GREEN!' : q > 0.65 ? 'GOOD RELEASE' : 'OFF';
            this.shoot(r, 'three', q);
          }
        }
      } else if (hDist(p, THREE_SPOT) < 0.5 && (r.misses.three > 0 || r.time + r.penalties >= r.target - 1.25)) this.shoot(r, 'three', 1);
    }
  }

  destroy() {
    if (!this.finished) this.scene.destroy();
  }
}

function hDist(a: THREE.Vector3, b: THREE.Vector3) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function skillsChallenge(app: App, o: ContestOptions): Screen {
  const c = new SkillsChallenge(app, o);
  (window as any).__contest = c;
  return { el: h('div'), update: (dt) => c.update(dt), destroy: () => c.destroy() };
}
