import * as THREE from 'three';
import type { App } from '../app/app.ts';
import { h } from '../app/app.ts';
import type { PlayerDef, TeamDef } from '../data/teams.ts';
import { Arena } from '../engine/arena.ts';
import { Ball, type BallStyle } from '../engine/ball.ts';
import { Character } from '../engine/character.ts';
import { RIM_H } from '../engine/constants.ts';
import { audio } from '../engine/audio.ts';
import { Rng, clamp } from '../core/rng.ts';
import { store } from '../app/store.ts';
import type { Id } from './plan.ts';

export interface ContestBot {
  def: PlayerDef;
  team: TeamDef;
}

export interface ContestOptions {
  team: TeamDef;
  player: PlayerDef;
  userName: string;
  bots: ContestBot[];
  /** From the outcome ticket: the user's final place and which bots finish above them. */
  place: number;
  botsAbove: boolean[];
  strip: string;
  seed: string;
  onFinish: (r: ContestResult) => void;
}

export interface StandingRow {
  id: Id;
  name: string;
  team: TeamDef;
  r1: number;
  final: number | null;
}

export interface ContestResult {
  /** Final standings, best first. */
  rows: StandingRow[];
  place: number;
  unit: string;
  higherBetter: boolean;
  tiebreak: boolean;
}

/** Hold-and-release timing meter shared by the shooting contests. Returns quality 0..1 on release. */
export class ReleaseMeter {
  active = false;
  t = 0;
  constructor(private duration = 0.8, private sweet = 0.58, private window = 0.34) {}
  start() {
    this.active = true;
    this.t = 0;
  }
  update(dt: number) {
    if (this.active) this.t += dt;
  }
  get t01() {
    return this.t / this.duration;
  }
  release(): number {
    this.active = false;
    return clamp(1 - Math.abs(this.t01 - this.sweet) / this.window, 0, 1);
  }
  /** Fraction of the bar that is the green window (for the HUD). */
  get greenBand(): [number, number] {
    const g = this.window * 0.1;
    return [this.sweet - g, this.sweet + g];
  }
}

interface TrackedBall {
  ball: Ball;
  /** Called once when a shot resolves (made or missed). */
  onResolve: ((made: boolean) => void) | null;
  releasedAt: number;
  /** Remove after this game time (once the ball has rolled away). */
  expire: number;
}

/**
 * Shared staging for the All-Star contests: arena, characters, any number of
 * physics balls, a manually driven camera and the HUD (score, prompts,
 * timing meter, choice pickers, round standings cards and a skip control).
 */
export class ContestScene {
  readonly group = new THREE.Group();
  readonly arena: Arena;
  readonly hud: HTMLElement;
  readonly big: HTMLElement;
  readonly prompt: HTMLElement;
  readonly sub: HTMLElement;
  readonly strip: HTMLElement;
  readonly board: HTMLElement;
  readonly meter: HTMLElement;
  readonly meterFill: HTMLElement;
  readonly meterGreen: HTMLElement;
  readonly skipBtn: HTMLButtonElement;
  readonly rng: Rng;
  time = 0;
  chars: Character[] = [];
  private balls: TrackedBall[] = [];
  private skipFlag = false;
  private picker: HTMLElement | null = null;

  constructor(readonly app: App, team: TeamDef, strip: string, seed: string) {
    app.takeScene();
    this.rng = new Rng(seed);
    this.arena = new Arena({ homeTeam: team, mobile: app.mobile });
    this.group.add(this.arena.group);
    app.renderer.scene.add(this.group);
    app.camera.mode = 'manual';
    this.hud = h('div', { class: 'hud contest-hud' });
    this.hud.innerHTML = `
      <div class="hud-strip"></div>
      <div class="contest-big"></div>
      <div class="contest-prompt"></div>
      <div class="contest-sub"></div>
      <div class="contest-board"></div>
      <div class="hud-meter"><div class="hud-meter-fill"></div><div class="hud-meter-green"></div></div>
      <button class="contest-skip">SKIP ›</button>`;
    app.overlay.appendChild(this.hud);
    const q = (s: string) => this.hud.querySelector(s) as HTMLElement;
    this.strip = q('.hud-strip');
    this.big = q('.contest-big');
    this.prompt = q('.contest-prompt');
    this.sub = q('.contest-sub');
    this.board = q('.contest-board');
    this.meter = q('.hud-meter');
    this.meterFill = q('.hud-meter-fill');
    this.meterGreen = q('.hud-meter-green');
    this.skipBtn = q('.contest-skip') as HTMLButtonElement;
    this.skipBtn.style.display = 'none';
    this.skipBtn.onclick = () => (this.skipFlag = true);
    this.strip.textContent = strip;
    this.arena.drawJumbotron({ abbr: 'ALL', score: 0, color: team.colors.primary }, { abbr: 'STAR', score: 0, color: team.colors.secondary }, strip.split('·')[0].trim(), 'ALL-STAR SATURDAY');
    const touch = store.data.settings.touch;
    app.touch.setVisible(touch === 'on' || (touch === 'auto' && app.mobile));
    app.touch.setSwipe(false);
  }

  addCharacter(def: PlayerDef, team: TeamDef, pos: THREE.Vector3): Character {
    const c = new Character(def, team.kits.away, { lowDetail: this.app.mobile });
    c.root.position.copy(pos);
    this.group.add(c.root);
    this.chars.push(c);
    return c;
  }

  removeCharacter(c: Character) {
    this.group.remove(c.root);
    this.chars = this.chars.filter((x) => x !== c);
    c.dispose();
  }

  face(c: Character, target: THREE.Vector3) {
    c.root.rotation.y = Math.atan2(target.x - c.root.position.x, target.z - c.root.position.z);
  }

  /** A new ball in the scene (held until launched). */
  spawnBall(style: BallStyle = 'standard', at?: THREE.Vector3): Ball {
    const b = new Ball(style);
    b.mode = 'held';
    if (at) b.place(at.x, at.y, at.z);
    b.addTo(this.group);
    b.syncVisual();
    return b;
  }

  removeBall(b: Ball) {
    b.removeFrom(this.group);
    this.balls = this.balls.filter((t) => t.ball !== b);
  }

  /** Follow a launched shot and report the physics result once. */
  track(ball: Ball, onResolve: ((made: boolean) => void) | null) {
    this.balls.push({ ball, onResolve, releasedAt: this.time, expire: Infinity });
  }

  /** Put a held ball in a character's hand (or both hands, slightly in front). */
  holdIn(ball: Ball, c: Character, twoHands = false) {
    const p = c.handWorld(new THREE.Vector3());
    if (twoHands) {
      const yaw = c.root.rotation.y;
      p.x += Math.sin(yaw) * 0.08;
      p.z += Math.cos(yaw) * 0.08;
    }
    ball.mode = 'held';
    ball.place(p.x, p.y, p.z);
    ball.syncVisual();
  }

  get inFlight(): number {
    return this.balls.filter((t) => t.onResolve).length;
  }

  /** Step every free ball; resolve shots from what the physics did. */
  stepBalls(dt: number) {
    for (const t of [...this.balls]) {
      const b = t.ball;
      b.step(dt, this.time);
      for (const e of b.events) {
        if (e.type === 'rim') audio.rim();
        else if (e.type === 'backboard') audio.backboard();
        else if (e.type === 'floor') audio.bounce(e.strength * 0.7);
      }
      b.events.length = 0;
      const s = b.shot;
      if (t.onResolve && s) {
        let made: boolean | null = null;
        if (s.scored && b.pos.y < RIM_H - 0.45) made = true;
        else if (!s.scored && ((b.pos.y < 1.25 && b.vel.y < 0) || this.time - t.releasedAt > 4)) made = false;
        if (made !== null) {
          if (made && !s.touchedRim) audio.swish();
          const cb = t.onResolve;
          t.onResolve = null;
          b.shot = null;
          b.mode = 'loose';
          t.expire = this.time + 2.5;
          cb(made);
        }
      }
      if (!t.onResolve && this.time > t.expire) this.removeBall(b);
    }
  }

  /** Instantly finish every shot in the air with the real physics (for skipping). */
  settleAll() {
    for (const t of [...this.balls]) {
      if (!t.onResolve) continue;
      let guard = 0;
      // stepBalls clears onResolve when the shot resolves.
      while ((t.onResolve as ((m: boolean) => void) | null) !== null && guard++ < 600) {
        this.time += 1 / 120;
        this.stepBalls(1 / 120);
      }
    }
  }

  clearBalls() {
    for (const t of [...this.balls]) this.removeBall(t.ball);
  }

  cam(pos: THREE.Vector3, look: THREE.Vector3, rate = 3.5) {
    const c = this.app.camera;
    c.manualPos.copy(pos);
    c.manualLook.copy(look);
    c.manualRate = rate;
  }

  snapCamera() {
    this.app.camera.prime(this.app.camera.manualLook);
  }

  setMeter(t01: number | null, band?: [number, number]) {
    if (t01 === null) {
      this.meter.style.display = 'none';
      return;
    }
    this.meter.style.display = '';
    this.meter.style.left = '50%';
    this.meter.style.top = '56%';
    this.meter.style.transform = 'translate(80px, -45px)';
    this.meterFill.style.height = `${Math.min(1, t01) * 100}%`;
    if (band) {
      this.meterGreen.style.bottom = `${band[0] * 100}%`;
      this.meterGreen.style.height = `${(band[1] - band[0]) * 100}%`;
      this.meterFill.style.background = t01 >= band[0] && t01 <= band[1] ? '#38ff7a' : '#ffd166';
    }
  }

  /** Bot turns can be skipped (Cross / A / Enter or the SKIP button); the rest is simulated with the same physics. */
  showSkip(on: boolean) {
    this.skipBtn.style.display = on ? '' : 'none';
    if (!on) this.skipFlag = false;
  }

  takeSkip(): boolean {
    const s = this.app.input.state;
    if (this.skipBtn.style.display !== 'none' && !this.picker && (s.pressed.b || s.nav.confirm)) this.skipFlag = true;
    const v = this.skipFlag;
    this.skipFlag = false;
    return v;
  }

  /** A row of choices (navigable with a controller); resolves with the chosen index. */
  choose(title: string, options: string[], onPick: (i: number) => void, defaultIndex = 0) {
    this.closePicker();
    const box = h('div', { class: 'contest-picker' }, h('div', { class: 'contest-picker-title' }, title));
    options.forEach((label, i) => {
      const b = h('button', { class: `btn small${i === defaultIndex ? ' primary' : ''}`, ...(i === defaultIndex ? { 'data-nav-default': '' } : {}) }, label);
      b.onclick = () => {
        audio.click();
        this.closePicker();
        onPick(i);
      };
      box.append(b);
    });
    this.hud.append(box);
    this.picker = box;
  }

  closePicker() {
    this.picker?.remove();
    this.picker = null;
  }

  get picking() {
    return !!this.picker;
  }

  /** Standings card between rounds. */
  card(title: string, rows: { name: string; team: TeamDef; value: string; tag?: string; you?: boolean }[], onDone: () => void) {
    this.closePicker();
    const box = h('div', { class: 'contest-picker contest-card' }, h('div', { class: 'contest-picker-title' }, title));
    const table = h('table', { class: 'table' });
    rows.forEach((r, i) => table.append(h('tr', { class: r.you ? 'you' : '' }, h('td', {}, `${i + 1}`), h('td', { style: 'text-align:left' }, `${r.name} · ${r.team.abbr}`), h('td', {}, r.value), h('td', {}, r.tag ?? ''))));
    box.append(table);
    const go = h('button', { class: 'btn primary', 'data-nav-default': '' }, 'CONTINUE');
    go.onclick = () => {
      audio.click();
      this.closePicker();
      onDone();
    };
    box.append(go);
    this.hud.append(box);
    this.picker = box;
  }

  update(dt: number) {
    this.time += dt;
    this.arena.update(this.time);
    this.app.camera.update(dt, this.app.camera.manualLook, this.time);
  }

  destroy() {
    this.closePicker();
    this.hud.remove();
    this.app.touch.setVisible(false);
    this.clearBalls();
    this.app.renderer.scene.remove(this.group);
    for (const c of this.chars) c.dispose();
  }
}

/** Judges' cards (5 judges, 6-10 each) that add up to a dunk score. */
export function judgeCards(total: number, rnd: () => number): number[] {
  const t = Math.round(clamp(total, 30, 50));
  const cards = [6, 6, 6, 6, 6];
  let left = t - 30;
  let guard = 0;
  while (left > 0 && guard++ < 200) {
    const i = Math.floor(rnd() * 5);
    if (cards[i] < 10) {
      cards[i]++;
      left--;
    }
  }
  return cards;
}

export function fmt(v: number, unit: string) {
  return unit === 's' ? `${v.toFixed(1)}s` : `${Math.round(v)}`;
}
