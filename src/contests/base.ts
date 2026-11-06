import * as THREE from 'three';
import type { App } from '../app/app.ts';
import { h } from '../app/app.ts';
import type { PlayerDef, TeamDef } from '../data/teams.ts';
import { Arena } from '../engine/arena.ts';
import { Ball } from '../engine/ball.ts';
import { Character } from '../engine/character.ts';
import { BALL_R, RIM_H, RIM_X } from '../engine/constants.ts';
import { audio } from '../engine/audio.ts';
import { Rng } from '../core/rng.ts';
import { clamp } from '../core/rng.ts';

/** Shared staging for the All-Star contests: arena, one or more characters, a ball and a HUD. */
export class ContestScene {
  readonly group = new THREE.Group();
  readonly arena: Arena;
  readonly ball = new Ball();
  readonly hud: HTMLElement;
  readonly big: HTMLElement;
  readonly prompt: HTMLElement;
  readonly sub: HTMLElement;
  readonly strip: HTMLElement;
  readonly meter: HTMLElement;
  readonly meterFill: HTMLElement;
  readonly board: HTMLElement;
  readonly rng: Rng;
  time = 0;
  private tmp = new THREE.Vector3();
  readonly side: 1 | -1 = 1;
  chars: Character[] = [];

  constructor(readonly app: App, team: TeamDef, strip: string, seed: string) {
    app.takeScene();
    this.rng = new Rng(seed);
    this.arena = new Arena({ homeTeam: team, mobile: app.mobile });
    this.group.add(this.arena.group);
    this.ball.addTo(this.group as unknown as THREE.Scene);
    app.renderer.scene.add(this.group);
    app.camera.mode = 'contest';
    app.camera.attackDir = this.side;
    app.camera.prime(new THREE.Vector3(this.side * (RIM_X - 7.5), 0, 0));
    this.hud = h('div', { class: 'hud' });
    this.hud.innerHTML = `
      <div class="hud-strip"></div>
      <div class="contest-board"></div>
      <div class="contest-big"></div>
      <div class="contest-prompt"></div>
      <div class="contest-sub"></div>
      <div class="hud-meter"><div class="hud-meter-fill"></div><div class="hud-meter-green"></div></div>`;
    app.overlay.appendChild(this.hud);
    const q = (s: string) => this.hud.querySelector(s) as HTMLElement;
    this.strip = q('.hud-strip');
    this.big = q('.contest-big');
    this.prompt = q('.contest-prompt');
    this.sub = q('.contest-sub');
    this.meter = q('.hud-meter');
    this.meterFill = q('.hud-meter-fill');
    this.board = q('.contest-board');
    this.strip.textContent = strip;
    this.arena.drawJumbotron({ abbr: 'ALL', score: 0, color: team.colors.primary }, { abbr: 'STAR', score: 0, color: team.colors.secondary }, strip.split('·')[0].trim(), 'ALL-STAR WEEKEND');
    const showTouch = app.mobile || (localStorage.getItem('ball-is-life:v1') ?? '').includes('"touch":"on"');
    app.touch.setVisible(showTouch);
    app.touch.setSwipe(false);
  }

  addCharacter(def: PlayerDef, team: TeamDef, x: number, z: number): Character {
    const c = new Character(def, team.kits.away, { lowDetail: this.app.mobile });
    c.root.position.set(x, 0, z);
    this.group.add(c.root);
    this.chars.push(c);
    return c;
  }

  removeCharacter(c: Character) {
    this.group.remove(c.root);
    this.chars = this.chars.filter((x) => x !== c);
    c.dispose();
  }

  rim(out = this.tmp) {
    return out.set(this.side * RIM_X, RIM_H, 0);
  }

  faceRim(c: Character) {
    const r = this.rim();
    c.root.rotation.y = Math.atan2(r.x - c.root.position.x, r.z - c.root.position.z);
  }

  /** Put the ball in the character's hands. */
  holdBall(c: Character) {
    const hand = c.handWorld(this.tmp);
    this.ball.mode = 'held';
    this.ball.place(hand.x, hand.y, hand.z);
    this.ball.syncVisual();
  }

  /** Launch a jump shot from the character toward the rim with scripted make/miss. */
  launchShot(c: Character, willMake: boolean, value: 2 | 3 = 3) {
    const r = this.rim();
    const from = c.root.position;
    const dist = Math.hypot(r.x - from.x, r.z - from.z);
    const fx = Math.sin(c.root.rotation.y);
    const fz = Math.cos(c.root.rotation.y);
    this.ball.place(from.x + fx * 0.2, 2.0 + c.airHeight, from.z + fz * 0.2);
    const target = new THREE.Vector3(r.x, RIM_H + 0.02, 0);
    if (willMake) {
      target.x += this.rng.float(-0.03, 0.03);
      target.z += this.rng.float(-0.03, 0.03);
    } else {
      const miss = this.rng.float(0.24, 0.42);
      const ang = this.rng.float(0, Math.PI * 2);
      target.x += Math.cos(ang) * miss;
      target.z += Math.sin(ang) * miss;
    }
    this.ball.mode = 'shot';
    this.ball.shot = { side: this.side, willMake, shooterTeam: 0, shooterIndex: 0, value, releasedAt: this.time, scored: false, touchedRim: false };
    this.ball.launchTo(target, clamp(0.8 + dist * 0.055, 0.85, 1.5));
  }

  /** Step physics and return 'score' | 'miss' | null once the shot resolves. */
  stepBall(dt: number): 'score' | 'miss' | null {
    this.ball.step(dt, this.time);
    let result: 'score' | 'miss' | null = null;
    for (const e of this.ball.events) {
      if (e.type === 'rim') audio.rim();
      else if (e.type === 'backboard') audio.backboard();
      else if (e.type === 'floor') audio.bounce(e.strength);
    }
    this.ball.events.length = 0;
    const s = this.ball.shot;
    if (s) {
      if (s.scored && this.ball.pos.y < RIM_H - 0.5) {
        result = 'score';
        this.ball.shot = null;
        this.ball.mode = 'loose';
        if (!s.touchedRim) audio.swish();
      } else if (!s.scored && (this.ball.pos.y < BALL_R + 0.3 || this.time - s.releasedAt > 3)) {
        result = 'miss';
        this.ball.shot = null;
        this.ball.mode = 'loose';
      }
    }
    return result;
  }

  setMeter(t01: number | null) {
    if (t01 === null) {
      this.meter.style.display = 'none';
      return;
    }
    this.meter.style.display = '';
    this.meter.style.left = '50%';
    this.meter.style.top = '58%';
    this.meter.style.transform = 'translate(70px, -45px)';
    this.meterFill.style.height = `${Math.min(1, t01) * 100}%`;
    this.meterFill.style.background = t01 > 0.5 && t01 < 0.63 ? '#38ff7a' : '#ffd166';
  }

  update(dt: number) {
    this.time += dt;
    this.arena.update(this.time);
    this.app.camera.update(dt, this.ball.mode === 'shot' ? this.ball.pos : this.chars[0]?.root.position ?? this.ball.pos, this.time);
  }

  destroy() {
    this.hud.remove();
    this.app.touch.setVisible(false);
    this.app.renderer.scene.remove(this.group);
    for (const c of this.chars) c.dispose();
  }
}

/** Hold-and-release timing meter shared by the shooting contests. Returns quality 0..1 on release. */
export class ReleaseMeter {
  active = false;
  t = 0;
  constructor(private duration = 0.8, private sweet = 0.58, private window = 0.3) {}
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
}

export const STAR_NAMES = ['Zion Whitfield', 'Kai Larsson', 'Amen Okafor', 'Luka Delgado', 'Trey Fontaine', 'Desmond Vega'];
