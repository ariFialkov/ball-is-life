import * as THREE from 'three';
import type { MatchScript } from '../core/casino/types.ts';
import { Rng, clamp, lerp } from '../core/rng.ts';
import type { PlayerDef, TeamDef } from '../data/teams.ts';
import { Arena } from '../engine/arena.ts';
import { Ball } from '../engine/ball.ts';
import { CameraRig } from '../engine/camera.ts';
import { Character } from '../engine/character.ts';
import { APRON, BALL_R, HALF_L, HALF_W, PLAYER_RADIUS, RIM_H, RIM_R, RIM_X, SPRINT_SPEED, THREE_CORNER_Z, THREE_R, WALK_SPEED } from '../engine/constants.ts';
import type { Input } from '../engine/input.ts';
import { audio } from '../engine/audio.ts';
import { Director } from './director.ts';

export interface Stats {
  pts: number;
  ast: number;
  reb: number;
  stl: number;
  blk: number;
  fga: number;
  fgm: number;
  tpa: number;
  tpm: number;
  to: number;
}

const emptyStats = (): Stats => ({ pts: 0, ast: 0, reb: 0, stl: 0, blk: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, to: 0 });

type ActionType = 'none' | 'shoot' | 'layup' | 'dunk' | 'pass' | 'block' | 'steal' | 'catch' | 'crossover';

interface Action {
  type: ActionType;
  t: number;
  dur: number;
  /** for shots: time the button was released (user), or scripted release */
  releaseAt: number;
  released: boolean;
  quality: number;
  target?: Athlete;
  dir?: THREE.Vector3;
}

export interface Athlete {
  team: 0 | 1;
  slot: number;
  def: PlayerDef;
  char: Character;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  facing: number;
  target: THREE.Vector3;
  action: Action;
  cooldown: number;
  stunned: number;
  decisionTimer: number;
  cutTimer: number;
  cutting: boolean;
  driving: boolean;
  stats: Stats;
  onCourt: boolean;
  isUser: boolean;
  lastCatch: number;
  sprint: boolean;
}

export interface MatchEvent {
  type: 'score' | 'miss' | 'block' | 'steal' | 'turnover' | 'rebound' | 'shotclock' | 'oob' | 'period' | 'end' | 'green' | 'dunk' | 'assist' | 'tip' | 'sub';
  team: 0 | 1;
  text: string;
  points?: number;
  athlete?: Athlete;
}

export interface CareerOptions {
  player: PlayerDef;
  targetPoints: number;
  targetAssists: number;
  targetRebounds: number;
  minutesShare: number;
}

export interface MatchOptions {
  teams: [TeamDef, TeamDef];
  /** The predetermined script; null for free play (menu reel). */
  script: MatchScript | null;
  quarterLength: number;
  userControlled: boolean;
  homeIndex: 0 | 1;
  career?: CareerOptions;
  scene: THREE.Scene;
  camera: CameraRig;
  input: Input;
  mobile: boolean;
  seed?: string;
  /** Quick sims (menu reel) skip pauses. */
  reel?: boolean;
}

export type Phase = 'live' | 'dead' | 'period' | 'end' | 'intro';

const SPOTS: [number, number][] = [
  [7.6, 0], // PG top
  [5.8, 5.6], // SG right wing
  [5.8, -5.6], // SF left wing
  [1.4, -5.8], // PF left corner
  [1.6, 2.4], // C low post
];

export class Match {
  readonly opts: MatchOptions;
  readonly arena: Arena;
  readonly ball = new Ball();
  readonly athletes: Athlete[] = [];
  readonly group = new THREE.Group();
  readonly director: Director | null;
  readonly rng: Rng;
  scores: [number, number] = [0, 0];
  period = 1;
  clock: number;
  shotClock = 24;
  phase: Phase = 'intro';
  phaseTimer = 0;
  possession: 0 | 1 = 0;
  holder: Athlete | null = null;
  controlled: Athlete | null = null;
  events: MatchEvent[] = [];
  elapsed = 0;
  time = 0;
  private lastPasser: Athlete | null = null;
  private lastPassTime = -10;
  private pendingInbound: { team: 0 | 1; x: number; z: number; reason: string } | null = null;
  private shotMeter: { active: boolean; t: number } = { active: false, t: 0 };
  readonly tmp = new THREE.Vector3();
  readonly tmp2 = new THREE.Vector3();
  readonly tmp3 = new THREE.Vector3();
  /** Career: whether the user's player is on the floor. */
  userOnCourt = false;
  userAthlete: Athlete | null = null;
  private benchedStarter: Athlete | null = null;
  private momentPlan: { start: number; end: number }[] = [];
  fastForwarding = false;
  lastEventText = '';
  debug = false;
  private crowdLevel = 0.2;
  shotFeedback: { text: string; at: number; color: string } | null = null;
  paused = false;
  /** Test hook: 'ai' lets the bots drive the controlled player, 'stall' makes the controlled player hold the ball and run from defenders. */
  autopilot: 'ai' | 'stall' | null = null;
  directorMisses = 0;
  /** Telemetry counters (event type -> count) and time spent per phase. */
  readonly counts: Record<string, number> = {};
  readonly phaseTime: Record<string, number> = {};

  constructor(opts: MatchOptions) {
    this.opts = opts;
    this.rng = new Rng(opts.seed ?? `match:${Date.now()}`);
    this.clock = opts.quarterLength;
    this.director = opts.script ? new Director(opts.script, opts.career ? { targetPoints: opts.career.targetPoints, targetAssists: opts.career.targetAssists, targetRebounds: opts.career.targetRebounds } : null, opts.quarterLength) : null;
    const home = opts.teams[opts.homeIndex];
    const away = opts.teams[opts.homeIndex === 0 ? 1 : 0];
    this.arena = new Arena({ homeTeam: home, awayTeam: away, mobile: opts.mobile });
    this.group.add(this.arena.group);
    this.ball.addTo(this.group as unknown as THREE.Scene);
    for (const team of [0, 1] as const) {
      const t = opts.teams[team];
      const kit = team === opts.homeIndex ? t.kits.home : t.kits.away;
      for (let slot = 0; slot < 5; slot++) {
        const a = this.makeAthlete(team, slot, t.roster[slot], kit);
        this.athletes.push(a);
        this.group.add(a.char.root);
      }
      if (team === 0 && opts.career) {
        const u = this.makeAthlete(0, 5, opts.career.player, kit);
        u.isUser = true;
        u.onCourt = false;
        u.char.root.visible = false;
        this.userAthlete = u;
        this.athletes.push(u);
        this.group.add(u.char.root);
      }
    }
    opts.scene.add(this.group);
    if (opts.career) this.planMoments();
    this.setupPeriodStart();
    this.phase = 'intro';
    this.phaseTimer = opts.reel ? 0.2 : 2.6;
    this.events.push({ type: 'tip', team: 0, text: `${opts.teams[0].abbr} vs ${opts.teams[1].abbr}` });
  }

  private makeAthlete(team: 0 | 1, slot: number, def: PlayerDef, kit: TeamDef['kits']['home']): Athlete {
    const char = new Character(def, kit, { lowDetail: this.opts.mobile });
    return {
      team,
      slot,
      def,
      char,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      facing: 0,
      target: new THREE.Vector3(),
      action: { type: 'none', t: 0, dur: 0, releaseAt: 0, released: false, quality: 0 },
      cooldown: 0,
      stunned: 0,
      decisionTimer: 0,
      cutTimer: this.rng.float(2, 5),
      cutting: false,
      driving: false,
      stats: emptyStats(),
      onCourt: true,
      isUser: false,
      lastCatch: 0,
      sprint: false,
    };
  }

  dispose() {
    this.opts.scene.remove(this.group);
    for (const a of this.athletes) a.char.dispose();
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers

  attackDir(team: 0 | 1): 1 | -1 {
    const base = team === 0 ? 1 : -1;
    return (this.period >= 3 ? -base : base) as 1 | -1;
  }

  basket(team: 0 | 1, out: THREE.Vector3) {
    return out.set(this.attackDir(team) * RIM_X, RIM_H, 0);
  }

  spotWorld(team: 0 | 1, slot: number, out: THREE.Vector3) {
    const dir = this.attackDir(team);
    const [u, v] = SPOTS[slot % 5];
    return out.set(dir * (RIM_X - u), 0, v * (team === 0 ? 1 : -1));
  }

  onCourt(team: 0 | 1): Athlete[] {
    return this.athletes.filter((a) => a.team === team && a.onCourt);
  }

  opponents(a: Athlete): Athlete[] {
    return this.onCourt(a.team === 0 ? 1 : 0);
  }

  teammates(a: Athlete): Athlete[] {
    return this.onCourt(a.team).filter((x) => x !== a);
  }

  nearestOpponent(a: Athlete): { who: Athlete | null; dist: number } {
    let best: Athlete | null = null;
    let bd = Infinity;
    for (const o of this.opponents(a)) {
      const d = hdist(o.pos, a.pos);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return { who: best, dist: bd };
  }

  get regulation() {
    return this.opts.quarterLength * 4;
  }

  get t01() {
    return this.elapsed / this.regulation;
  }

  get margin() {
    return this.scores[0] - this.scores[1];
  }

  get userTeamStats(): Stats {
    const s = emptyStats();
    for (const a of this.athletes) if (a.team === 0) for (const k of Object.keys(s) as (keyof Stats)[]) s[k] += a.stats[k];
    return s;
  }

  isThree(team: 0 | 1, pos: THREE.Vector3): boolean {
    const bx = this.attackDir(team) * RIM_X;
    const d = Math.hypot(pos.x - bx, pos.z);
    return d >= THREE_R || Math.abs(pos.z) >= THREE_CORNER_Z;
  }

  // ---------------------------------------------------------------------------
  // Period / possession management

  private setupPeriodStart() {
    this.clock = this.period <= 4 ? this.opts.quarterLength : Math.min(60, this.opts.quarterLength);
    this.shotClock = 24;
    const team: 0 | 1 = this.period % 2 === 1 ? 0 : 1;
    this.possession = team;
    this.holder = null;
    this.ball.shot = null;
    this.ball.pass = null;
    for (const a of this.athletes) {
      if (!a.onCourt) continue;
      this.homeSpot(a, true);
      a.pos.copy(a.target);
      a.vel.set(0, 0, 0);
      a.action.type = 'none';
      a.driving = false;
      a.cutting = false;
      a.char.root.position.copy(a.pos);
    }
    const pg = this.onCourt(team).find((a) => a.slot === 0) ?? this.onCourt(team)[0];
    this.giveBall(pg);
    this.pickControlled();
    this.opts.camera.attackDir = this.attackDir(this.possession);
    this.opts.camera.snap();
  }

  /** Default spots: offense at their set, defense matched up. */
  private homeSpot(a: Athlete, start = false) {
    if (a.team === this.possession) {
      this.spotWorld(a.team, a.slot, a.target);
      if (start) {
        // Start possession in the backcourt so the offense walks it up.
        a.target.x = -this.attackDir(a.team) * (HALF_L - 3 - a.slot * 1.2);
        a.target.z = (a.slot - 2) * 2.4;
      }
    } else {
      const man = this.matchup(a);
      if (man) {
        const bx = this.attackDir(man.team) * RIM_X;
        const dx = bx - man.pos.x;
        const dz = -man.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        a.target.set(man.pos.x + (dx / len) * 1.6, 0, man.pos.z + (dz / len) * 1.6);
      }
    }
  }

  matchup(a: Athlete): Athlete | null {
    const opp = this.opponents(a);
    return opp.find((o) => o.slot % 5 === a.slot % 5) ?? opp[0] ?? null;
  }

  giveBall(a: Athlete) {
    this.holder = a;
    this.possession = a.team;
    this.ball.mode = 'dribble';
    this.ball.shot = null;
    this.ball.pass = null;
    this.ball.lastTouchTeam = a.team;
    a.lastCatch = this.time;
    a.driving = false;
    a.decisionTimer = this.rng.float(0.3, 0.8);
    this.opts.camera.attackDir = this.attackDir(a.team);
    if (this.opts.userControlled && a.team === 0) {
      this.controlled = a;
      this.updateHighlights();
    }
  }

  private pickControlled() {
    if (!this.opts.userControlled) {
      this.controlled = null;
      return;
    }
    if (this.opts.career) {
      this.controlled = this.userOnCourt ? this.userAthlete : null;
      this.updateHighlights();
      return;
    }
    if (this.possession === 0 && this.holder && this.holder.team === 0) this.controlled = this.holder;
    else {
      // Defense: pick the teammate guarding the ball / closest to the ball.
      let best: Athlete | null = null;
      let bd = Infinity;
      for (const a of this.onCourt(0)) {
        const d = hdist(a.pos, this.ball.pos);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      this.controlled = best;
    }
    this.updateHighlights();
  }

  private updateHighlights() {
    for (const a of this.athletes) a.char.setHighlight(a === this.controlled, this.possession === 0 ? 0x7dff9a : 0xff6b6b);
  }

  switchControlled() {
    if (!this.opts.userControlled || this.opts.career) return;
    if (this.possession === 0) return;
    const mates = this.onCourt(0).filter((a) => a !== this.controlled);
    mates.sort((a, b) => hdist(a.pos, this.ball.pos) - hdist(b.pos, this.ball.pos));
    if (mates[0]) this.controlled = mates[0];
    this.updateHighlights();
  }

  private startDead(seconds: number, inbound: { team: 0 | 1; x: number; z: number; reason: string }) {
    this.phase = 'dead';
    this.phaseTimer = this.opts.reel ? Math.min(seconds, 0.6) : seconds;
    this.pendingInbound = inbound;
    this.holder = null;
    this.ball.shot = null;
    this.ball.pass = null;
    this.ball.mode = 'loose';
    this.possession = inbound.team;
    for (const a of this.athletes) {
      a.driving = false;
      a.cutting = false;
      if (a.action.type !== 'none' && a.action.type !== 'catch') a.action.type = 'none';
    }
    this.opts.camera.attackDir = this.attackDir(inbound.team);
  }

  private resolveInbound() {
    const ib = this.pendingInbound!;
    this.pendingInbound = null;
    const team = ib.team;
    this.shotClock = 24;
    // The inbounder is the closest teammate to the inbound spot.
    const mates = this.onCourt(team).slice().sort((a, b) => Math.hypot(a.pos.x - ib.x, a.pos.z - ib.z) - Math.hypot(b.pos.x - ib.x, b.pos.z - ib.z));
    const inb = mates[0];
    inb.pos.set(clamp(ib.x, -HALF_L + 0.6, HALF_L - 0.6), 0, clamp(ib.z, -HALF_W + 0.6, HALF_W - 0.6));
    inb.vel.set(0, 0, 0);
    this.ball.place(inb.pos.x, 1, inb.pos.z);
    this.giveBall(inb);
    this.phase = 'live';
    this.pickControlled();
  }

  private endPeriod() {
    audio.buzzer();
    const tied = this.scores[0] === this.scores[1];
    if (this.period >= 4 && !tied) {
      if (this.opts.script && this.opts.script.userWins !== this.margin > 0) this.directorMisses++;
      this.phase = 'end';
      this.phaseTimer = 4;
      this.events.push({ type: 'end', team: this.margin > 0 ? 0 : 1, text: 'FINAL' });
      for (const a of this.athletes) {
        if (!a.onCourt) continue;
        const won = (a.team === 0) === this.margin > 0;
        a.char.setState(won ? 'celebrate' : 'dejected');
        a.action.type = 'none';
      }
      this.holder = null;
      this.ball.mode = 'loose';
      return;
    }
    this.phase = 'period';
    this.phaseTimer = this.opts.reel ? 0.5 : 3;
    this.events.push({ type: 'period', team: 0, text: this.period >= 4 ? 'OVERTIME' : this.period === 2 ? 'HALFTIME' : `END OF Q${this.period}` });
    this.holder = null;
    this.ball.mode = 'loose';
  }

  private nextPeriod() {
    this.period++;
    this.setupPeriodStart();
    this.phase = 'intro';
    this.phaseTimer = this.opts.reel ? 0.2 : 1.6;
  }

  // ---------------------------------------------------------------------------
  // Career moments

  private planMoments() {
    const c = this.opts.career!;
    const total = this.regulation;
    const share = clamp(c.minutesShare, 0.15, 0.8);
    const n = share > 0.55 ? 4 : 3;
    const each = (total * share) / n;
    const gap = (total - total * share) / (n + 1);
    this.momentPlan = [];
    for (let i = 0; i < n; i++) {
      const start = gap * (i + 1) + each * i;
      this.momentPlan.push({ start, end: start + each });
    }
  }

  get nextMoment() {
    return this.momentPlan.find((m) => m.end > this.elapsed + 0.5) ?? null;
  }

  /** Career: advance the sim until the next moment, scoring along the script. */
  fastForwardToNextMoment(): boolean {
    const m = this.nextMoment;
    if (!m) {
      this.fastForwardTo(this.regulation);
      return false;
    }
    if (this.elapsed < m.start) this.fastForwardTo(m.start);
    this.subUserIn();
    return true;
  }

  private fastForwardTo(targetElapsed: number) {
    const delta = targetElapsed - this.elapsed;
    if (delta <= 0) return;
    this.subUserOut();
    // Pace: roughly 2 points per 10 seconds per team, split so the margin follows the script.
    const totalPts = Math.round((delta / 10) * 2 * 2);
    const targetMargin = this.director ? Math.round(this.director.targetMargin(targetElapsed / this.regulation)) : this.margin + Math.round(this.rng.gauss() * 3);
    const deltaMargin = targetMargin - this.margin;
    let userPts = Math.round((totalPts + deltaMargin) / 2);
    let oppPts = totalPts - userPts;
    if (userPts < 0) { oppPts += -userPts; userPts = 0; }
    if (oppPts < 0) { userPts += -oppPts; oppPts = 0; }
    this.scores[0] += userPts;
    this.scores[1] += oppPts;
    // Spread the points over the starters' stat lines.
    const spread = (team: 0 | 1, pts: number) => {
      const guys = this.athletes.filter((a) => a.team === team && !a.isUser);
      while (pts > 0) {
        const g = this.rng.pick(guys);
        const v = pts >= 3 && this.rng.chance(0.3) ? 3 : Math.min(2, pts);
        g.stats.pts += v;
        g.stats.fgm++;
        g.stats.fga += this.rng.chance(0.5) ? 2 : 1;
        pts -= v;
      }
    };
    spread(0, userPts);
    spread(1, oppPts);
    // Advance clocks across periods.
    let remaining = delta;
    while (remaining > 0) {
      const step = Math.min(remaining, this.clock);
      this.clock -= step;
      this.elapsed += step;
      remaining -= step;
      if (this.clock <= 0.001 && remaining > 0) {
        this.period = Math.min(4, this.period + 1);
        this.clock = this.opts.quarterLength;
      }
    }
    if (this.clock <= 0.001 && this.period >= 4) {
      this.phase = 'period';
      this.phaseTimer = 0;
      this.endPeriod();
      return;
    }
    // Resume with a fresh inbound for whichever team.
    const team: 0 | 1 = this.rng.chance(0.5) ? 0 : 1;
    this.possession = team;
    this.holder = null;
    for (const a of this.athletes) {
      if (!a.onCourt) continue;
      this.homeSpot(a, true);
      a.pos.copy(a.target);
      a.vel.set(0, 0, 0);
      a.action.type = 'none';
    }
    this.startDead(0.8, { team, x: -this.attackDir(team) * (HALF_L - 2.5), z: 0, reason: 'sub' });
  }

  subUserIn() {
    if (!this.userAthlete || this.userOnCourt) return;
    const u = this.userAthlete;
    const starter = this.onCourt(0).find((a) => a.def.pos === u.def.pos) ?? this.onCourt(0)[0];
    starter.onCourt = false;
    starter.char.root.visible = false;
    this.benchedStarter = starter;
    u.onCourt = true;
    u.slot = starter.slot;
    u.char.root.visible = true;
    u.pos.copy(starter.pos);
    u.vel.set(0, 0, 0);
    u.char.root.position.copy(u.pos);
    if (this.holder === starter) this.giveBall(u);
    this.userOnCourt = true;
    this.controlled = u;
    this.updateHighlights();
    this.events.push({ type: 'sub', team: 0, text: `${u.def.last.toUpperCase()} CHECKS IN` });
  }

  subUserOut() {
    if (!this.userAthlete || !this.userOnCourt) return;
    const u = this.userAthlete;
    const starter = this.benchedStarter;
    if (starter) {
      starter.onCourt = true;
      starter.char.root.visible = true;
      starter.pos.copy(u.pos);
      starter.char.root.position.copy(starter.pos);
      if (this.holder === u) this.giveBall(starter);
    }
    u.onCourt = false;
    u.char.root.visible = false;
    this.userOnCourt = false;
    this.controlled = null;
    this.updateHighlights();
  }

  /** Whether the current career moment has ended. */
  get momentOver(): boolean {
    if (!this.opts.career) return false;
    const m = this.momentPlan.find((m) => this.elapsed >= m.start && this.elapsed < m.end);
    return this.userOnCourt && !m;
  }

  // ---------------------------------------------------------------------------
  // Main update

  update(dt: number) {
    if (this.paused) return;
    this.time += dt;
    this.phaseTime[this.phase] = (this.phaseTime[this.phase] ?? 0) + dt;
    const input = this.opts.input.state;
    const mods = this.director
      ? this.director.mods(this.t01, this.margin, this.clock, this.userAthlete ? { pts: this.userAthlete.stats.pts, ast: this.userAthlete.stats.ast, reb: this.userAthlete.stats.reb } : undefined, this.userAthlete ? this.careerFraction() : this.t01)
      : null;

    // Phase machine.
    if (this.phase === 'intro' || this.phase === 'dead' || this.phase === 'period' || this.phase === 'end') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (this.phase === 'intro') {
          this.phase = 'live';
          this.pickControlled();
        } else if (this.phase === 'dead') this.resolveInbound();
        else if (this.phase === 'period') this.nextPeriod();
      }
    }
    const live = this.phase === 'live';
    if (live) {
      this.clock -= dt;
      this.elapsed += dt;
      this.shotClock -= dt;
      if (this.shotClock <= 0 && this.holder && !this.ball.shot) {
        this.shotClockViolation();
      }
      if (this.clock <= 0) {
        this.clock = 0;
        // Let a shot in the air finish.
        if (!this.ball.shot) this.endPeriod();
      }
    }

    // Controlled player input.
    if (live && this.controlled && this.opts.userControlled) {
      if (this.autopilot === 'stall') this.applyStall(dt);
      else if (!this.autopilot) this.applyUserInput(dt, mods);
    }

    // AI.
    for (const a of this.athletes) {
      if (!a.onCourt) continue;
      a.cooldown = Math.max(0, a.cooldown - dt);
      a.stunned = Math.max(0, a.stunned - dt);
      if (a === this.controlled && live && this.autopilot !== 'ai') continue;
      this.aiThink(a, dt, mods, live);
    }

    // Movement & actions.
    for (const a of this.athletes) {
      if (!a.onCourt) continue;
      this.updateAction(a, dt, mods);
      this.moveAthlete(a, dt);
    }
    this.separate();

    // Characters.
    for (const a of this.athletes) {
      if (!a.onCourt) continue;
      this.animate(a, dt);
    }

    // Ball.
    this.updateBall(dt, mods, live);
    this.processBallEvents(mods);

    // Camera.
    const cam = this.opts.camera;
    if (cam.mode !== 'cinematic') cam.attackDir = this.attackDir(this.possession);
    cam.update(dt, this.ball.pos, this.time);

    this.arena.update(this.time);
    this.crowdLevel += (0.2 - this.crowdLevel) * dt * 0.5;
    audio.crowd(this.crowdLevel);
    if (Math.floor(this.time * 4) !== Math.floor((this.time - dt) * 4)) this.drawBoard();
  }

  private careerFraction() {
    // Fraction of the user's planned floor time that has been consumed.
    const c = this.opts.career!;
    const total = this.regulation * clamp(c.minutesShare, 0.15, 0.8);
    let played = 0;
    for (const m of this.momentPlan) played += clamp(this.elapsed - m.start, 0, m.end - m.start);
    return clamp(played / total, 0.02, 1);
  }

  private drawBoard() {
    const t0 = this.opts.teams[0];
    const t1 = this.opts.teams[1];
    const periodLabel = this.period <= 4 ? `Q${this.period}` : `OT${this.period - 4}`;
    this.arena.drawJumbotron(
      { abbr: t0.abbr, score: this.scores[0], color: t0.colors.primary },
      { abbr: t1.abbr, score: this.scores[1], color: t1.colors.primary },
      formatClock(this.clock),
      `${periodLabel}  ·  SHOT ${Math.max(0, Math.ceil(this.shotClock))}`,
    );
  }

  // ---------------------------------------------------------------------------
  // User input

  private applyUserInput(dt: number, mods: ReturnType<Director['mods']> | null) {
    const a = this.controlled!;
    const s = this.opts.input.state;
    const cam = this.opts.camera;
    const dir = cam.moveToWorld(s.move.x, s.move.y, this.tmp);
    const mag = Math.hypot(s.move.x, s.move.y);
    a.sprint = s.sprint;
    const busy = a.action.type !== 'none' && a.action.type !== 'catch' && a.action.type !== 'crossover';
    if (!busy) {
      const speed = this.maxSpeed(a) * mag;
      a.target.copy(a.pos).addScaledVector(dir, 2);
      const desired = this.tmp2.copy(dir).multiplyScalar(speed);
      a.vel.lerp(desired, Math.min(1, dt * 11));
      if (mag > 0.05) a.facing = Math.atan2(dir.x, dir.z);
      else if (this.holder === a) {
        const b = this.basket(a.team, this.tmp3);
        a.facing = Math.atan2(b.x - a.pos.x, b.z - a.pos.z);
      }
    }
    const hasBall = this.holder === a;
    if (hasBall) {
      // Shoot: hold & release.
      if (s.pressed.a && a.action.type === 'none') {
        const b = this.basket(a.team, this.tmp3);
        const d = Math.hypot(b.x - a.pos.x, b.z - a.pos.z);
        const toward = (b.x - a.pos.x) * Math.sin(a.facing) + (b.z - a.pos.z) * Math.cos(a.facing) > 0;
        if (d < 2.6 && toward) {
          const dunk = a.def.ratings.dunk >= 68 && (a.vel.length() > 2.5 || a.def.ratings.dunk > 85) && d < 2.4;
          this.startAction(a, dunk ? 'dunk' : 'layup');
        } else {
          this.startAction(a, 'shoot');
          this.shotMeter = { active: true, t: 0 };
        }
      }
      if (a.action.type === 'shoot' && !a.action.released && s.released.a) {
        a.action.released = true;
        a.action.releaseAt = a.action.t;
        this.shotMeter.active = false;
      }
      if (s.pressed.b && a.action.type === 'none') {
        const target = this.pickPassTarget(a, mag > 0.2 ? dir : null, mods);
        if (target) this.startPass(a, target);
      }
      if ((s.pressed.x || s.flick) && a.action.type === 'none' && a.cooldown <= 0) {
        const flick = s.flick ? cam.moveToWorld(s.flick.x, s.flick.y, this.tmp2).clone() : null;
        this.crossover(a, flick, mods);
      }
    } else if (a.team === this.possession) {
      // Off-ball offense: nothing special (could add cut/screen calls).
    } else {
      // Defense.
      if (s.pressed.a && a.action.type === 'none') this.startAction(a, 'block');
      if (s.pressed.x && a.action.type === 'none' && a.cooldown <= 0) this.startAction(a, 'steal');
      if (s.pressed.b) this.switchControlled();
    }
    if (this.shotMeter.active) this.shotMeter.t += dt;
  }

  get meter() {
    return this.shotMeter;
  }

  /** Adversarial test behaviour: never shoot, keep the ball away from defenders. */
  private applyStall(dt: number) {
    const a = this.controlled!;
    a.sprint = true;
    if (this.holder === a) {
      const { who } = this.nearestOpponent(a);
      const away = this.tmp.set(0, 0, 0);
      if (who) away.copy(a.pos).sub(who.pos).setY(0).normalize();
      // Stay in bounds: steer toward the centre when near the edge.
      if (Math.abs(a.pos.x) > HALF_L - 1.5) away.x = -Math.sign(a.pos.x);
      if (Math.abs(a.pos.z) > HALF_W - 1.5) away.z = -Math.sign(a.pos.z);
      a.vel.lerp(this.tmp2.copy(away).multiplyScalar(this.maxSpeed(a)), Math.min(1, dt * 11));
      if (away.lengthSq() > 0.01) a.facing = Math.atan2(away.x, away.z);
    } else {
      a.vel.multiplyScalar(0.9);
    }
  }

  // ---------------------------------------------------------------------------
  // AI

  private maxSpeed(a: Athlete) {
    const r = a.def.ratings.speed / 100;
    let s = WALK_SPEED * (0.8 + r * 0.35);
    if (a.sprint) s = SPRINT_SPEED * (0.8 + r * 0.35);
    if (this.holder === a) s *= 0.93;
    if (a.stunned > 0) s *= 0.15;
    return s;
  }

  private aiThink(a: Athlete, dt: number, mods: ReturnType<Director['mods']> | null, live: boolean) {
    const offense = a.team === this.possession;
    const myForce = mods && mods.force > 0 ? (mods.forceDir > 0 ? a.team === 0 : a.team === 1) : false; // force pushes in my favour
    const theirForce = mods && mods.force > 0 ? !myForce : false;
    a.sprint = false;
    if (!live) {
      if (this.phase === 'dead' && this.pendingInbound) {
        // Walk to the next set.
        this.possession = this.pendingInbound.team;
        this.homeSpot(a, true);
        if (a.team === this.pendingInbound.team && this.pendingInbound.reason !== 'score') {
          // Offense sets up near the inbound spot instead of the backcourt.
          const dir = this.attackDir(a.team);
          this.spotWorld(a.team, a.slot, a.target);
          a.target.x = lerp(a.target.x, this.pendingInbound.x, 0.5) - dir * 2;
        }
        a.sprint = false;
      } else if (this.phase === 'end') {
        a.target.copy(a.pos);
      }
      return;
    }
    // Loose ball: chase it if you are among the closest.
    if (this.ball.mode === 'loose') {
      const d = hdist(a.pos, this.ball.pos);
      const landing = this.tmp.copy(this.ball.pos).addScaledVector(this.ball.vel, 0.35);
      const chasers = this.athletes.filter((x) => x.onCourt && x.team === a.team).sort((x, y) => hdist(x.pos, landing) - hdist(y.pos, landing));
      const rank = chasers.indexOf(a);
      if (rank < (d < 6 ? 3 : 2)) {
        a.target.set(landing.x, 0, landing.z);
        a.sprint = true;
      } else {
        this.homeSpot(a);
      }
      return;
    }
    if (this.ball.mode === 'pass' && this.ball.pass) {
      const p = this.ball.pass;
      const receiver = this.athletes[this.athleteIndex(p.fromTeam as 0 | 1, p.toIndex)];
      if (a === receiver) {
        // Meet the ball.
        a.target.set(this.ball.pos.x + this.ball.vel.x * 0.2, 0, this.ball.pos.z + this.ball.vel.z * 0.2);
        return;
      }
      if (!offense && theirForce) {
        // Jump the passing lane.
        a.target.set(this.ball.pos.x + this.ball.vel.x * 0.25, 0, this.ball.pos.z + this.ball.vel.z * 0.25);
        a.sprint = true;
        return;
      }
    }
    if (offense) this.aiOffense(a, dt, mods, myForce, theirForce);
    else this.aiDefense(a, dt, mods, myForce, theirForce);
  }

  private athleteIndex(team: 0 | 1, slot: number) {
    return this.athletes.findIndex((x) => x.team === team && x.slot === slot && x.onCourt);
  }

  private aiOffense(a: Athlete, dt: number, mods: ReturnType<Director['mods']> | null, myForce: boolean, theirForce: boolean) {
    const basket = this.basket(a.team, this.tmp3);
    const isHandler = this.holder === a;
    if (!isHandler) {
      // Spot up, with occasional cuts. Career: when the director wants to feed the user, get open.
      a.cutTimer -= dt;
      if (a.cutTimer <= 0) {
        a.cutTimer = this.rng.float(2.5, 5.5);
        a.cutting = !a.cutting && this.rng.chance(a.isUser ? 0.6 : 0.3);
      }
      this.spotWorld(a.team, a.slot, a.target);
      if (a.cutting) {
        a.target.x = basket.x - this.attackDir(a.team) * this.rng.float(1.5, 2.5);
        a.target.z = a.target.z * 0.3;
        a.sprint = true;
      } else if (this.holder && hdist(this.holder.pos, a.target) < 2.2) {
        // Stay spaced from the ball handler.
        a.target.z += a.target.z > 0 ? 1.5 : -1.5;
      }
      // If the ball is being walked up, trail behind rather than teleport to spots.
      if (this.holder && Math.sign(basket.x - this.holder.pos.x) === Math.sign(basket.x) && Math.abs(this.holder.pos.x - basket.x) > 16) {
        a.target.x = this.holder.pos.x + this.attackDir(a.team) * (2 + a.slot);
        a.target.z = (a.slot - 2) * 2.6 * (a.team === 0 ? 1 : -1);
        a.sprint = Math.abs(this.holder.pos.x - basket.x) > 20;
      }
      return;
    }
    // Ball handler.
    if (a.action.type !== 'none' && a.action.type !== 'catch') return;
    const d = Math.hypot(basket.x - a.pos.x, basket.z - a.pos.z);
    const { who: defender, dist: openness } = this.nearestOpponent(a);
    const inFrontcourt = (basket.x - a.pos.x) * this.attackDir(a.team) < HALF_L + 2 && Math.abs(a.pos.x - basket.x) < HALF_L;
    const needScore = myForce; // our team must score now
    const mustStall = theirForce; // our team should not score (but can't just hold: shot clock + steals handle it)
    void mustStall;
    a.decisionTimer -= dt;
    if (a.driving) {
      a.target.set(basket.x - this.attackDir(a.team) * 0.6, 0, basket.z + (a.pos.z > 0 ? 0.5 : -0.5));
      a.sprint = true;
      if (d < 2.3) {
        const dunk = a.def.ratings.dunk >= 70 && this.rng.chance(0.65 + (needScore ? 0.3 : 0));
        this.startAction(a, dunk ? 'dunk' : 'layup');
        a.driving = false;
      } else if (defender && openness < 0.9 && this.rng.chance(dt * 1.5)) {
        // Blocked off: kick it out.
        const t = this.pickPassTarget(a, null, mods);
        if (t) {
          this.startPass(a, t);
          a.driving = false;
        }
      }
      return;
    }
    if (a.decisionTimer > 0) {
      // Keep moving to the current target while deciding; face the basket.
      if (hdist(a.pos, a.target) < 0.5) a.target.copy(a.pos);
      return;
    }
    a.decisionTimer = this.rng.float(0.3, 0.6);
    const r = a.def.ratings;
    const three = this.isThree(a.team, a.pos);
    const shotClockPressure = this.shotClock < 4.5;
    // 1. Easy finish.
    if (d < 2.4 && (openness > 0.9 || shotClockPressure || needScore)) {
      const dunk = r.dunk >= 70 && this.rng.chance(0.6);
      this.startAction(a, dunk ? 'dunk' : 'layup');
      return;
    }
    // 2. Shot clock.
    if (shotClockPressure && inFrontcourt) {
      this.startAction(a, 'shoot');
      return;
    }
    if (!inFrontcourt || Math.abs(a.pos.x - basket.x) > 11) {
      // Bring the ball up.
      a.target.set(basket.x - this.attackDir(a.team) * 7.5, 0, a.pos.z * 0.5);
      a.sprint = Math.abs(a.pos.x - basket.x) > 9;
      return;
    }
    const timeHeld = this.time - a.lastCatch;
    // 3. Open shot.
    const shotRating = three ? r.three : d < 4.5 ? r.inside : r.mid;
    const openFactor = clamp((openness - 0.7) / 1.5, 0, 1) + (needScore ? 0.35 : 0);
    const catchAndShoot = timeHeld < 1.0 && openness > 1.5 && d < 8.5;
    let shotDesire = (three ? 0.4 : 0.5) * (shotRating / 80) * openFactor + (this.opts.teams[a.team].style === 'threes' && three ? 0.15 : 0) + (catchAndShoot ? 0.3 : 0) + (this.shotClock < 10 ? 0.2 : 0) - (this.shotClock > 18 ? 0.12 : 0);
    if (three && shotRating < 60) shotDesire *= 0.3;
    if (timeHeld > 0.3 && d < 9.5 && this.rng.chance(clamp(shotDesire, 0, 0.9))) {
      this.startAction(a, 'shoot');
      return;
    }
    // 4. Drive.
    const lane = this.laneOpen(a, basket);
    if ((lane || openness > 1.1) && this.rng.chance((lane ? 0.35 : 0.12) + r.handle / 300 + (needScore ? 0.3 : 0)) && timeHeld > 0.25) {
      a.driving = true;
      return;
    }
    // 5. Pass.
    const target = this.pickPassTarget(a, null, mods);
    if (target && this.rng.chance(0.55 + (openness < 1.2 ? 0.3 : 0))) {
      this.startPass(a, target);
      return;
    }
    // 6. Probe: dribble to a new spot.
    const dir = this.attackDir(a.team);
    const spot = this.spotWorld(a.team, a.slot, this.tmp);
    a.target.set(spot.x + dir * this.rng.float(-1.5, 2.5), 0, spot.z + this.rng.float(-2.5, 2.5));
    if (openness < 1.0 && defender) {
      // Get away from the defender.
      const away = this.tmp2.copy(a.pos).sub(defender.pos).setY(0).normalize();
      a.target.copy(a.pos).addScaledVector(away, 2.5);
      if (a.cooldown <= 0 && this.rng.chance(0.4)) this.crossover(a, null, mods);
    }
  }

  private laneOpen(a: Athlete, basket: THREE.Vector3): boolean {
    const dx = basket.x - a.pos.x;
    const dz = basket.z - a.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    for (const o of this.opponents(a)) {
      const px = o.pos.x - a.pos.x;
      const pz = o.pos.z - a.pos.z;
      const t = (px * dx + pz * dz) / (len * len);
      if (t < 0.05 || t > 1) continue;
      const cx = a.pos.x + dx * t;
      const cz = a.pos.z + dz * t;
      if (Math.hypot(o.pos.x - cx, o.pos.z - cz) < 1.3) return false;
    }
    return true;
  }

  private aiDefense(a: Athlete, dt: number, mods: ReturnType<Director['mods']> | null, myForce: boolean, theirForce: boolean) {
    const man = this.matchup(a);
    if (!man) return;
    const basket = this.basket(man.team, this.tmp3);
    const ballHandler = this.holder;
    const guardingBall = ballHandler === man;
    const dx = basket.x - man.pos.x;
    const dz = basket.z - man.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    // Distance to play off the man: tight on the ball, sag when far from it.
    const ballDist = ballHandler ? hdist(man.pos, ballHandler.pos) : 5;
    let off = guardingBall ? 1.05 : clamp(1.0 + ballDist * 0.25, 1.0, 3.2);
    if (myForce) off = guardingBall ? 0.8 : 0.9; // lock down
    if (theirForce) off = guardingBall ? 1.6 : 3.5; // give space
    if (man.isUser && mods && this.opts.career) off *= clamp(1.4 - mods.feedUser, 0.6, 1.6);
    // Help defense: if the handler is driving and near, collapse.
    if (!guardingBall && ballHandler && ballHandler.driving && hdist(a.pos, ballHandler.pos) < 3.5 && !theirForce) {
      a.target.set(lerp(ballHandler.pos.x, basket.x, 0.5), 0, lerp(ballHandler.pos.z, basket.z, 0.5));
    } else {
      a.target.set(man.pos.x + (dx / len) * off, 0, man.pos.z + (dz / len) * off);
    }
    a.sprint = hdist(a.pos, a.target) > 4 || (guardingBall && (ballHandler!.sprint || myForce));
    // Transition: if the offense is far upcourt, get back first.
    if (ballHandler && Math.abs(ballHandler.pos.x - basket.x) > 15) {
      a.target.set(basket.x - this.attackDir(man.team) * (4 + a.slot * 1.3), 0, (a.slot - 2) * 2.2);
      a.sprint = true;
    }
    // Contest shots and attempt steals.
    if (guardingBall && ballHandler) {
      const d = hdist(a.pos, ballHandler.pos);
      if ((ballHandler.action.type === 'shoot' || ballHandler.action.type === 'layup') && ballHandler.action.t < 0.25 && d < 1.7 && a.action.type === 'none' && a.cooldown <= 0) {
        if (this.rng.chance(theirForce ? 0.15 : myForce ? 0.95 : 0.6)) this.startAction(a, 'block');
      } else if (d < (myForce ? 1.6 : 1.25) && a.action.type === 'none' && a.cooldown <= 0 && (ballHandler.action.type === 'none' || ballHandler.action.type === 'crossover')) {
        const rate = myForce ? 2.2 : theirForce ? 0.04 : 0.09 + a.def.ratings.steal / 1000;
        if (this.rng.chance(dt * rate)) this.startAction(a, 'steal');
      }
    } else if (ballHandler && (ballHandler.action.type === 'shoot' || ballHandler.action.type === 'layup' || ballHandler.action.type === 'dunk') && hdist(a.pos, ballHandler.pos) < 1.6 && a.action.type === 'none' && ballHandler.action.t < 0.2 && a.cooldown <= 0) {
      if (this.rng.chance(myForce ? 0.9 : 0.4)) this.startAction(a, 'block');
    }
  }

  private pickPassTarget(a: Athlete, stickDir: THREE.Vector3 | null, mods: ReturnType<Director['mods']> | null): Athlete | null {
    const basket = this.basket(a.team, this.tmp3);
    let best: Athlete | null = null;
    let bestScore = -Infinity;
    for (const m of this.teammates(a)) {
      const d = hdist(a.pos, m.pos);
      if (d < 1.0 || d > 20) continue;
      const { dist: open } = this.nearestOpponent(m);
      const toBasket = Math.hypot(basket.x - m.pos.x, basket.z - m.pos.z);
      let score = open * 0.6 - toBasket * 0.08 - d * 0.05 + this.rng.next() * 0.6;
      if (m.cutting) score += 0.8;
      if (stickDir) {
        const vx = (m.pos.x - a.pos.x) / d;
        const vz = (m.pos.z - a.pos.z) / d;
        const dot = vx * stickDir.x + vz * stickDir.z;
        score += dot * 4 - 1.5;
      }
      if (m.isUser && mods) score += (mods.feedUser - 0.5) * 8;
      // Avoid passing through a defender.
      for (const o of this.opponents(a)) {
        const t = ((o.pos.x - a.pos.x) * (m.pos.x - a.pos.x) + (o.pos.z - a.pos.z) * (m.pos.z - a.pos.z)) / (d * d);
        if (t > 0.1 && t < 0.9) {
          const cx = a.pos.x + (m.pos.x - a.pos.x) * t;
          const cz = a.pos.z + (m.pos.z - a.pos.z) * t;
          if (Math.hypot(o.pos.x - cx, o.pos.z - cz) < 0.9) score -= 2;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Actions

  startAction(a: Athlete, type: ActionType, target?: Athlete) {
    const durations: Record<ActionType, number> = { none: 0, shoot: 0.95, layup: 1.0, dunk: 1.1, pass: 0.42, block: 0.9, steal: 0.5, catch: 0.3, crossover: 0.3 };
    a.action = { type, t: 0, dur: durations[type], releaseAt: type === 'shoot' ? 0.46 : type === 'layup' ? 0.45 : type === 'dunk' ? 0.5 : 0.13, released: !(type === 'shoot' && a === this.controlled && this.opts.userControlled), quality: 0.7, target };
    if (type === 'shoot' || type === 'layup' || type === 'dunk') {
      const b = this.basket(a.team, this.tmp3);
      a.facing = Math.atan2(b.x - a.pos.x, b.z - a.pos.z);
      if (type === 'shoot') a.vel.multiplyScalar(0.2);
      else {
        // Leap toward the rim.
        const dx = b.x - a.pos.x;
        const dz = b.z - a.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        const reach = Math.max(0.2, len - 0.9);
        a.vel.set((dx / len) * reach / 0.55, 0, (dz / len) * reach / 0.55);
      }
      if (a !== this.controlled || !this.opts.userControlled) {
        // Bot timing quality: mostly good, sometimes slightly off.
        a.action.quality = clamp(0.7 + this.rng.gauss() * 0.15, 0.2, 1);
      }
    }
    if (type === 'pass' && target) {
      a.facing = Math.atan2(target.pos.x - a.pos.x, target.pos.z - a.pos.z);
      a.vel.multiplyScalar(0.3);
    }
    if (type === 'steal') {
      a.cooldown = 1.1;
      const h = this.holder;
      if (h) a.facing = Math.atan2(h.pos.x - a.pos.x, h.pos.z - a.pos.z);
    }
    if (type === 'block') {
      a.cooldown = 1.2;
      a.vel.multiplyScalar(0.3);
    }
    a.char.setState(type === 'crossover' ? 'dribble' : type === 'none' ? 'idle' : type);
  }

  private startPass(a: Athlete, target: Athlete) {
    this.startAction(a, 'pass', target);
  }

  private crossover(a: Athlete, flick: THREE.Vector3 | null, mods: ReturnType<Director['mods']> | null) {
    a.cooldown = 0.9;
    const side = flick ? flick : this.tmp2.set(Math.cos(a.facing) * (this.rng.chance(0.5) ? 1 : -1), 0, -Math.sin(a.facing) * (this.rng.chance(0.5) ? 1 : -1));
    a.vel.addScaledVector(side.setY(0).normalize(), 5.5);
    a.action = { type: 'crossover', t: 0, dur: 0.3, releaseAt: 0, released: true, quality: 0 };
    const { who, dist } = this.nearestOpponent(a);
    if (who && dist < 1.8) {
      const disruption = mods ? (a.team === 0 ? 1 / mods.oppSteal : 1 / mods.userSteal) : 1;
      if (this.rng.chance(clamp(0.45 * (a.def.ratings.handle / 80) * disruption, 0.05, 0.9))) {
        who.stunned = 0.7;
        if (a === this.controlled) this.events.push({ type: 'tip', team: a.team, text: 'ANKLES!' });
      }
    }
    audio.sneaker();
  }

  private updateAction(a: Athlete, dt: number, mods: ReturnType<Director['mods']> | null) {
    const act = a.action;
    if (act.type === 'none') return;
    act.t += dt;
    const isShot = act.type === 'shoot' || act.type === 'layup' || act.type === 'dunk';
    if (isShot && this.holder === a) {
      // User shots release when the button is let go (never earlier than the animation release point).
      const releaseTime = act.type === 'shoot' ? (act.released ? Math.max(0.42, act.releaseAt) : 0.9) : act.releaseAt;
      if (act.t >= releaseTime) {
        if (act.type === 'shoot' && a === this.controlled && this.opts.userControlled) {
          const r = act.released ? act.releaseAt : 0.9;
          act.quality = clamp(1 - Math.abs(r - 0.46) / 0.3, 0, 1);
          this.shotMeter.active = false;
        }
        this.releaseShot(a, act.type, act.quality, mods);
      }
    }
    if (act.type === 'pass' && this.holder === a && act.t >= act.releaseAt && act.target) {
      this.releasePass(a, act.target, mods);
    }
    if (act.type === 'steal' && act.t >= 0.15 && act.t - dt < 0.15) this.resolveSteal(a, mods);
    if (act.t >= act.dur) {
      act.type = 'none';
      if (isShot) a.vel.multiplyScalar(0.3);
    }
  }

  private shotProbability(a: Athlete, type: ActionType, quality: number, mods: ReturnType<Director['mods']> | null): { p: number; three: boolean; dist: number; contest: number } {
    const basket = this.basket(a.team, this.tmp3);
    const dist = Math.hypot(basket.x - a.pos.x, basket.z - a.pos.z);
    const three = type === 'shoot' && this.isThree(a.team, a.pos);
    const r = a.def.ratings;
    let base: number;
    let rating: number;
    if (type === 'dunk') {
      base = 0.88;
      rating = r.dunk;
    } else if (type === 'layup') {
      base = 0.68;
      rating = r.inside;
    } else if (three) {
      base = dist > 9 ? 0.26 : 0.4;
      rating = r.three;
    } else if (dist < 4.5) {
      base = 0.52;
      rating = r.inside;
    } else {
      base = 0.46;
      rating = r.mid;
    }
    let p = base * Math.pow(rating / 78, 1.3);
    // Contest.
    let contest = 0;
    for (const o of this.opponents(a)) {
      const d = hdist(o.pos, a.pos);
      const c = clamp(1 - d / 2.2, 0, 1) * (o.action.type === 'block' ? 1.4 : 0.8);
      contest = Math.max(contest, c);
    }
    p *= 1 - 0.55 * Math.min(1, contest);
    // Timing.
    p *= 0.5 + 0.75 * quality;
    if (quality > 0.9) p = Math.max(p, 0.92);
    // Moving shots.
    if (type === 'shoot') p *= 1 - 0.25 * clamp(a.vel.length() / SPRINT_SPEED, 0, 1);
    // Director.
    if (mods) {
      p *= a.team === 0 ? mods.userShot : mods.oppShot;
      if (a.isUser) p *= mods.userPlayerShot;
    }
    return { p: clamp(p, 0.02, 0.97), three, dist, contest };
  }

  private releaseShot(a: Athlete, type: ActionType, quality: number, mods: ReturnType<Director['mods']> | null) {
    const { p, three, dist, contest } = this.shotProbability(a, type, quality, mods);
    let willMake = this.rng.chance(p);
    // Blocks: a contesting defender mid-jump can swat it.
    let blocked = false;
    for (const o of this.opponents(a)) {
      if (o.action.type === 'block' && o.action.t > 0.08 && o.action.t < 0.6 && hdist(o.pos, a.pos) < 1.45) {
        const disruption = mods ? (o.team === 1 ? mods.oppSteal : mods.userSteal) : 1;
        let pb = 0.3 * (o.def.ratings.block / 80) * disruption * (type === 'dunk' ? 0.4 : 1);
        if (quality > 0.9) pb *= 0.3;
        if (this.rng.chance(clamp(pb, 0.02, 0.95))) {
          blocked = true;
          willMake = false;
          o.stats.blk++;
          this.events.push({ type: 'block', team: o.team, text: `${o.def.last.toUpperCase()} WITH THE BLOCK!`, athlete: o });
          this.crowdLevel = 0.8;
          audio.cheer(0.6);
          break;
        }
      }
    }
    const basket = this.basket(a.team, this.tmp3);
    const side = this.attackDir(a.team);
    a.stats.fga++;
    if (three) a.stats.tpa++;
    // Ball leaves the hands.
    this.holder = null;
    const hand = a.char.handWorld(this.tmp);
    this.ball.pos.set(hand.x, Math.max(hand.y, 1.6 + a.char.airHeight), hand.z);
    this.ball.lastTouchTeam = a.team;
    if (blocked) {
      this.ball.mode = 'loose';
      this.ball.shot = null;
      const away = this.tmp2.set(-side * this.rng.float(1, 3), 2.5, this.rng.float(-3, 3));
      this.ball.vel.copy(away);
      return;
    }
    this.ball.mode = 'shot';
    this.ball.shot = { side, willMake, shooterTeam: a.team, shooterIndex: a.slot, value: three ? 3 : 2, releasedAt: this.time, scored: false, touchedRim: false };
    const target = this.tmp2.set(basket.x, RIM_H + 0.02, 0);
    if (type === 'dunk') {
      // Slam: the ball is pushed down through the rim from above.
      this.ball.pos.set(basket.x - side * 0.1, RIM_H + 0.35, 0);
      this.ball.vel.set(0, willMake ? -4 : -1.5, 0);
      if (!willMake) this.ball.vel.set(-side * 2.5, 1.5, this.rng.float(-2, 2));
      this.events.push({ type: 'dunk', team: a.team, text: willMake ? 'THROWS IT DOWN!' : 'RIM REJECTS IT', athlete: a });
      if (willMake) {
        this.opts.camera.shake = 0.25;
        this.crowdLevel = 1;
      }
      return;
    }
    if (willMake) {
      target.x += this.rng.float(-0.04, 0.04);
      target.z += this.rng.float(-0.04, 0.04);
      if (type === 'layup' && this.rng.chance(0.5)) {
        // Off the glass.
        target.x = side * (RIM_X + 0.3);
        target.y = RIM_H + 0.45;
        target.z = (a.pos.z > 0 ? 0.25 : -0.25);
      }
    } else {
      // Misses: front rim, back rim, side rim, occasionally the glass or short.
      const kind = this.rng.next();
      const miss = kind < 0.35 ? 0.24 : kind < 0.7 ? 0.3 : kind < 0.9 ? 0.4 : 0.6;
      const angle = this.rng.float(0, Math.PI * 2);
      target.x += Math.cos(angle) * miss;
      target.z += Math.sin(angle) * miss;
      if (type === 'layup' && kind > 0.5) {
        target.x = side * (RIM_X + 0.3);
        target.y = RIM_H + 0.55;
        target.z = this.rng.float(-0.5, 0.5);
      }
    }
    const flight = type === 'shoot' ? clamp(0.8 + dist * 0.055, 0.85, 1.55) : 0.55;
    this.ball.launchTo(target, flight);
    this.ball.spin.set(0, 0, 0);
    if (a === this.controlled && this.opts.userControlled && type === 'shoot') {
      const label = quality > 0.9 ? 'GREEN' : quality > 0.65 ? 'GOOD' : quality > 0.4 ? 'SLIGHTLY OFF' : 'WAY OFF';
      this.shotFeedback = { text: label, at: this.time, color: quality > 0.9 ? '#38ff7a' : quality > 0.65 ? '#ffe066' : '#ff6b6b' };
      if (quality > 0.9) this.events.push({ type: 'green', team: 0, text: 'GREEN RELEASE' });
    }
    void contest;
  }

  private releasePass(a: Athlete, target: Athlete, mods: ReturnType<Director['mods']> | null) {
    this.holder = null;
    const hand = a.char.handWorld(this.tmp);
    this.ball.pos.set(hand.x, Math.max(1.2, hand.y), hand.z);
    const d = hdist(a.pos, target.pos);
    const flight = clamp(d / 13, 0.25, 1.1);
    const lead = this.tmp2.copy(target.pos).addScaledVector(target.vel, flight * 0.8);
    lead.y = 1.35;
    // Bad pass chance.
    const disruption = mods ? (a.team === 0 ? mods.oppSteal : mods.userSteal) : 1;
    const pBad = clamp(0.025 * (80 / a.def.ratings.pass) * disruption, 0.005, 0.6);
    if (this.rng.chance(pBad)) {
      lead.x += this.rng.float(-2.5, 2.5);
      lead.z += this.rng.float(-2.5, 2.5);
    }
    this.ball.launchTo(lead, flight);
    this.ball.mode = 'pass';
    this.ball.lastTouchTeam = a.team;
    this.ball.pass = { fromTeam: a.team, fromIndex: a.slot, toIndex: target.slot, launchedAt: this.time };
    this.lastPasser = a;
    this.lastPassTime = this.time;
    this.possession = a.team;
  }

  private resolveSteal(a: Athlete, mods: ReturnType<Director['mods']> | null) {
    const h = this.holder;
    if (!h || h.team === a.team) return;
    if (hdist(a.pos, h.pos) > (mods && mods.force > 0 ? 1.6 : 1.2)) return;
    if (h.action.type === 'shoot' || h.action.type === 'layup' || h.action.type === 'dunk') return;
    const disruption = mods ? (a.team === 1 ? mods.oppSteal : mods.userSteal) : 1;
    let p = 0.22 * (a.def.ratings.steal / 80) * (80 / h.def.ratings.handle) * disruption;
    if (h.action.type === 'crossover') p *= 0.3;
    if (this.rng.chance(clamp(p, 0.02, 0.97))) {
      a.stats.stl++;
      h.stats.to++;
      this.events.push({ type: 'steal', team: a.team, text: `${a.def.last.toUpperCase()} PICKS THE POCKET!`, athlete: a });
      h.char.setState('idle');
      this.giveBall(a);
      a.action.type = 'none';
      this.shotClock = 24;
      this.crowdLevel = 0.7;
      audio.cheer(0.5);
      this.pickControlled();
    }
  }

  private shotClockViolation() {
    const h = this.holder!;
    h.stats.to++;
    audio.whistle();
    this.events.push({ type: 'shotclock', team: h.team, text: 'SHOT CLOCK VIOLATION' });
    const other: 0 | 1 = h.team === 0 ? 1 : 0;
    this.startDead(1.2, { team: other, x: h.pos.x, z: Math.sign(h.pos.z || 1) * (HALF_W - 0.8), reason: 'turnover' });
  }

  // ---------------------------------------------------------------------------
  // Movement & animation

  private moveAthlete(a: Athlete, dt: number) {
    const act = a.action.type;
    const controlledLive = a === this.controlled && this.phase === 'live' && this.opts.userControlled && this.autopilot !== 'ai';
    const frozen = act === 'shoot' || act === 'block' || act === 'steal' || act === 'pass';
    if (!controlledLive && !frozen && act !== 'layup' && act !== 'dunk') {
      // Steer toward target.
      const dx = a.target.x - a.pos.x;
      const dz = a.target.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      const speed = this.maxSpeed(a) * (this.phase === 'live' ? 1 : 0.8);
      const arrive = clamp(d / 1.2, 0, 1);
      const desired = this.tmp.set(d > 0.05 ? (dx / d) * speed * arrive : 0, 0, d > 0.05 ? (dz / d) * speed * arrive : 0);
      a.vel.lerp(desired, Math.min(1, dt * 9));
      if (d > 0.3 && a.vel.lengthSq() > 0.2) a.facing = Math.atan2(a.vel.x, a.vel.z);
      else if (this.holder === a || a.team !== this.possession) {
        const look = this.holder === a ? this.basket(a.team, this.tmp2) : this.tmp2.copy(this.ball.pos);
        a.facing = Math.atan2(look.x - a.pos.x, look.z - a.pos.z);
      }
    } else if (frozen) {
      a.vel.multiplyScalar(1 - Math.min(1, dt * 12));
    } else if (act === 'layup' || act === 'dunk') {
      if (a.action.t > 0.55) a.vel.multiplyScalar(1 - Math.min(1, dt * 6));
    }
    a.pos.addScaledVector(a.vel, dt);
    a.pos.x = clamp(a.pos.x, -HALF_L - APRON, HALF_L + APRON);
    a.pos.z = clamp(a.pos.z, -HALF_W - APRON, HALF_W + APRON);
    a.pos.y = 0;
  }

  private separate() {
    const list = this.athletes.filter((a) => a.onCourt);
    const minD = PLAYER_RADIUS * 1.7;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < minD && d > 1e-4) {
          const push = (minD - d) / 2;
          const nx = dx / d;
          const nz = dz / d;
          a.pos.x -= nx * push;
          a.pos.z -= nz * push;
          b.pos.x += nx * push;
          b.pos.z += nz * push;
        }
      }
    }
  }

  private animate(a: Athlete, dt: number) {
    const c = a.char;
    const speed = a.vel.length();
    const speed01 = clamp(speed / SPRINT_SPEED, 0, 1);
    const act = a.action.type;
    if (act === 'none' || act === 'crossover') {
      if (this.phase === 'end') {
        // keep celebrate/dejected
      } else if (this.holder === a) c.setState('dribble');
      else if (a.team !== this.possession && this.phase === 'live' && speed < 2.2 && this.holder && hdist(a.pos, this.holder.pos) < 4) c.setState('defense');
      else if (speed > 0.6) c.setState('run');
      else c.setState('idle');
    }
    c.handedness = 1;
    c.root.position.set(a.pos.x, 0, a.pos.z);
    // Smooth facing.
    let diff = a.facing - c.root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    c.root.rotation.y += diff * Math.min(1, dt * 12);
    c.update(dt, speed01);
  }

  // ---------------------------------------------------------------------------
  // Ball

  private updateBall(dt: number, mods: ReturnType<Director['mods']> | null, live: boolean) {
    const b = this.ball;
    if (this.holder) {
      const a = this.holder;
      const act = a.action.type;
      const hand = a.char.handWorld(this.tmp);
      if (act === 'shoot' || act === 'layup' || act === 'dunk' || act === 'pass') {
        // Ball in the hands (two-hand set point).
        const fx = Math.sin(a.facing);
        const fz = Math.cos(a.facing);
        const u = a.action.t / Math.max(0.01, a.action.releaseAt);
        if (act === 'shoot') {
          const rise = clamp((u - 0.3) / 0.7, 0, 1);
          b.pos.set(a.pos.x + fx * (0.25 - rise * 0.1), 1.1 + rise * (0.9 + 0.4) + a.char.airHeight, a.pos.z + fz * (0.25 - rise * 0.1));
        } else if (act === 'pass') {
          b.pos.set(a.pos.x + fx * 0.35, 1.25, a.pos.z + fz * 0.35);
        } else {
          b.pos.set(hand.x, hand.y + 0.05, hand.z);
        }
      } else {
        // Dribble: ball bounces between the hand and the floor.
        const ph = (a.char.dribblePhase / (Math.PI * 2)) % 1;
        const bounce = Math.sin(ph * Math.PI);
        const top = Math.max(0.7, hand.y - 0.05);
        const fx = Math.sin(a.facing);
        const fz = Math.cos(a.facing);
        const moving = a.vel.length() > 0.5;
        const sx = Math.cos(a.facing) * 0.32;
        const sz = -Math.sin(a.facing) * 0.32;
        b.pos.set(a.pos.x + fx * (moving ? 0.45 : 0.3) + sx, top - (top - BALL_R) * bounce, a.pos.z + fz * (moving ? 0.45 : 0.3) + sz);
        if (ph < 0.52 && ph + dt * 10.5 / (Math.PI * 2) >= 0.5 && live) audio.bounce(0.5);
      }
      b.mode = 'dribble';
      b.vel.set(0, 0, 0);
      b.syncVisual();
      return;
    }
    b.step(dt, this.time);
    if (!live && this.phase !== 'end') return;
    // Catch / intercept / rebound.
    if (b.mode === 'pass' && b.pass) {
      const receiver = this.athletes[this.athleteIndex(b.pass.fromTeam as 0 | 1, b.pass.toIndex)];
      for (const o of this.athletes) {
        if (!o.onCourt || o.team === b.pass.fromTeam) continue;
        const d = hdist(o.pos, b.pos);
        if (d < 0.85 && b.pos.y < 2.3 && this.time - b.pass.launchedAt > 0.08) {
          const disruption = mods ? (o.team === 1 ? mods.oppSteal : mods.userSteal) : 1;
          const rate = 0.55 * (o.def.ratings.steal / 80) * disruption * (o.action.type === 'steal' ? 3 : 1);
          if (this.rng.chance(1 - Math.exp(-rate * dt))) {
            o.stats.stl++;
            if (this.lastPasser) this.lastPasser.stats.to++;
            this.events.push({ type: 'steal', team: o.team, text: `${o.def.last.toUpperCase()} JUMPS THE LANE!`, athlete: o });
            this.giveBall(o);
            this.shotClock = 24;
            this.crowdLevel = 0.7;
            audio.cheer(0.5);
            this.pickControlled();
            return;
          }
        }
      }
      if (receiver && hdist(receiver.pos, b.pos) < 1.0 && b.pos.y < 2.5 && this.time - b.pass.launchedAt > 0.1) {
        this.catchBall(receiver);
        return;
      }
      // Any teammate can also catch a stray pass.
      for (const m of this.onCourt(b.pass.fromTeam as 0 | 1)) {
        if (m !== receiver && m.slot !== b.pass.fromIndex && hdist(m.pos, b.pos) < 0.8 && b.pos.y < 2.3 && this.time - b.pass.launchedAt > 0.25) {
          this.catchBall(m);
          return;
        }
      }
      if (b.pos.y <= BALL_R + 0.02 && this.time - b.pass.launchedAt > 1.2) {
        b.mode = 'loose';
        b.pass = null;
      }
    }
    if (b.mode === 'shot' && b.shot) {
      // Becomes loose once it has hit the rim/board and is falling outside the cylinder, or lands.
      const rx = b.shot.side * RIM_X;
      const d = Math.hypot(b.pos.x - rx, b.pos.z);
      const falling = b.vel.y < 0;
      if (!b.shot.scored && ((b.shot.touchedRim && falling && (d > RIM_R + 0.1 || b.pos.y < RIM_H - 0.2)) || b.pos.y < 1.2 || this.time - b.shot.releasedAt > 3.2)) {
        this.registerMiss();
        return;
      }
      if (b.shot.scored && b.pos.y < RIM_H - 0.55) {
        this.registerScore();
        return;
      }
    }
    if (b.mode === 'loose') {
      // Out of bounds?
      if ((Math.abs(b.pos.x) > HALF_L + 0.2 || Math.abs(b.pos.z) > HALF_W + 0.2) && b.pos.y < 2.5 && this.phase === 'live') {
        this.outOfBounds();
        return;
      }
      // Grab.
      const list = this.athletes.filter((x) => x.onCourt && hdist(x.pos, b.pos) < 0.75 && b.pos.y < 2.35 + (x.action.type === 'block' ? 0.5 : 0));
      list.sort((x, y) => hdist(x.pos, b.pos) - hdist(y.pos, b.pos));
      for (const x of list) {
        let p = 0.55 * (x.def.ratings.reb / 80);
        if (mods) p *= x.team === 1 ? mods.oppReb : 1 / mods.oppReb;
        if (this.rng.chance(clamp(p, 0.05, 0.98)) || list.length === 1) {
          const wasShot = this.lastShotMissedAt > this.time - 4;
          if (wasShot) {
            x.stats.reb++;
            this.events.push({ type: 'rebound', team: x.team, text: `${x.def.last.toUpperCase()} REBOUND`, athlete: x });
          }
          const offensive = x.team === this.possession;
          this.giveBall(x);
          this.shotClock = wasShot && offensive ? 14 : 24;
          x.char.setState('catch');
          x.action = { type: 'catch', t: 0, dur: 0.3, releaseAt: 0, released: true, quality: 0 };
          this.pickControlled();
          return;
        }
      }
    }
  }

  private lastShotMissedAt = -10;

  private catchBall(m: Athlete) {
    this.giveBall(m);
    m.action = { type: 'catch', t: 0, dur: 0.3, releaseAt: 0, released: true, quality: 0 };
    m.char.setState('catch');
    this.lastPassTime = this.time;
    this.pickControlled();
  }

  private registerMiss() {
    const s = this.ball.shot!;
    this.ball.mode = 'loose';
    this.ball.shot = null;
    this.lastShotMissedAt = this.time;
    this.events.push({ type: 'miss', team: s.shooterTeam as 0 | 1, text: '' });
    if (this.clock <= 0) this.endPeriod();
  }

  private registerScore() {
    const s = this.ball.shot!;
    const team = s.shooterTeam as 0 | 1;
    const shooter = this.athletes[this.athleteIndex(team, s.shooterIndex)];
    this.scores[team] += s.value;
    if (shooter) {
      shooter.stats.pts += s.value;
      shooter.stats.fgm++;
      if (s.value === 3) shooter.stats.tpm++;
    }
    // Assist if a pass led directly to the bucket.
    if (this.lastPasser && this.lastPasser.team === team && this.lastPasser !== shooter && s.releasedAt - this.lastPassTime < 2.5) {
      this.lastPasser.stats.ast++;
      this.events.push({ type: 'assist', team, text: `${this.lastPasser.def.last.toUpperCase()} WITH THE DIME`, athlete: this.lastPasser });
    }
    const tag = s.value === 3 ? 'FROM DOWNTOWN!' : s.touchedRim ? 'GETS THE ROLL' : 'SWISH';
    this.events.push({ type: 'score', team, text: `${shooter ? shooter.def.last.toUpperCase() : ''} ${tag}`, points: s.value, athlete: shooter });
    this.crowdLevel = team === this.opts.homeIndex ? 0.9 : 0.5;
    audio.cheer(team === this.opts.homeIndex ? 0.9 : 0.4);
    if (!s.touchedRim) audio.swish();
    this.ball.shot = null;
    this.ball.mode = 'loose';
    if (this.clock <= 0) {
      this.endPeriod();
      return;
    }
    const other: 0 | 1 = team === 0 ? 1 : 0;
    this.startDead(1.2, { team: other, x: -this.attackDir(other) * (HALF_L - 1.2), z: this.rng.float(-1.5, 1.5), reason: 'score' });
  }

  private outOfBounds() {
    audio.whistle();
    const last = this.ball.lastTouchTeam;
    const team: 0 | 1 = last === 0 ? 1 : 0;
    this.events.push({ type: 'oob', team, text: 'OUT OF BOUNDS' });
    const x = clamp(this.ball.pos.x, -HALF_L + 1, HALF_L - 1);
    const z = Math.abs(this.ball.pos.z) > HALF_W ? Math.sign(this.ball.pos.z) * (HALF_W - 0.6) : clamp(this.ball.pos.z, -HALF_W + 1, HALF_W - 1);
    this.startDead(1.2, { team, x, z, reason: 'oob' });
  }

  private processBallEvents(mods: ReturnType<Director['mods']> | null) {
    void mods;
    for (const e of this.ball.events) {
      if (e.type === 'rim') audio.rim();
      else if (e.type === 'backboard') audio.backboard();
      else if (e.type === 'floor') audio.bounce(e.strength);
    }
    this.ball.events.length = 0;
  }

  /** Drain events for the HUD. */
  takeEvents(): MatchEvent[] {
    const e = this.events;
    for (const ev of e) this.counts[ev.type] = (this.counts[ev.type] ?? 0) + 1;
    this.events = [];
    return e;
  }

  get finished() {
    return this.phase === 'end' && this.phaseTimer <= 0;
  }
}

export function hdist(a: THREE.Vector3, b: THREE.Vector3) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function formatClock(s: number) {
  const sec = Math.max(0, s);
  if (sec < 60) return sec.toFixed(1);
  const m = Math.floor(sec / 60);
  const r = Math.floor(sec % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}
