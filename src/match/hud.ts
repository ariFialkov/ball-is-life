import * as THREE from 'three';
import type { Match, MatchEvent } from './match.ts';
import { formatClock } from './match.ts';
import type { Input } from '../engine/input.ts';

export interface HudContext {
  /** Text shown in the top strip (odds, round, contract...). */
  strip: string;
  careerLine?: string;
}

/** DOM overlay for in-game information (score bug, clocks, meter, toasts, control hints). */
export class Hud {
  readonly el: HTMLElement;
  private score0: HTMLElement;
  private score1: HTMLElement;
  private clockEl: HTMLElement;
  private periodEl: HTMLElement;
  private shotEl: HTMLElement;
  private toastEl: HTMLElement;
  private meterEl: HTMLElement;
  private meterFill: HTMLElement;
  private feedbackEl: HTMLElement;
  private hintEl: HTMLElement;
  private stripEl: HTMLElement;
  private bannerEl: HTMLElement;
  private careerEl: HTMLElement;
  private debugEl: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private toastTimer = 0;
  private bannerTimer = 0;
  private tmp = new THREE.Vector3();
  onPause: (() => void) | null = null;

  constructor(root: HTMLElement, match: Match, private camera: THREE.PerspectiveCamera, private input: Input, ctx: HudContext) {
    const t0 = match.opts.teams[0];
    const t1 = match.opts.teams[1];
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-strip"></div>
      <div class="hud-bug">
        <div class="hud-team" style="--c:${t0.colors.primary};--c2:${t0.colors.secondary}"><span class="abbr">${t0.abbr}</span><span class="score s0">0</span></div>
        <div class="hud-clock"><span class="clock">12:00</span><span class="period">Q1</span><span class="shot">24</span></div>
        <div class="hud-team away" style="--c:${t1.colors.primary};--c2:${t1.colors.secondary}"><span class="score s1">0</span><span class="abbr">${t1.abbr}</span></div>
      </div>
      <button class="hud-pause" aria-label="Pause">II</button>
      <div class="hud-career"></div>
      <div class="hud-toast"></div>
      <div class="hud-banner"></div>
      <div class="hud-meter"><div class="hud-meter-fill"></div><div class="hud-meter-green"></div></div>
      <div class="hud-feedback"></div>
      <div class="hud-hint"></div>
      <div class="hud-debug"></div>`;
    root.appendChild(this.el);
    const q = (s: string) => this.el.querySelector(s) as HTMLElement;
    this.score0 = q('.s0');
    this.score1 = q('.s1');
    this.clockEl = q('.clock');
    this.periodEl = q('.period');
    this.shotEl = q('.shot');
    this.toastEl = q('.hud-toast');
    this.meterEl = q('.hud-meter');
    this.meterFill = q('.hud-meter-fill');
    this.feedbackEl = q('.hud-feedback');
    this.hintEl = q('.hud-hint');
    this.stripEl = q('.hud-strip');
    this.bannerEl = q('.hud-banner');
    this.careerEl = q('.hud-career');
    this.debugEl = q('.hud-debug');
    this.pauseBtn = q('.hud-pause') as HTMLButtonElement;
    this.pauseBtn.addEventListener('click', () => this.onPause?.());
    this.stripEl.textContent = ctx.strip;
    this.debugEl.style.display = match.debug ? '' : 'none';
    this.update(0, match, []);
  }

  setStrip(text: string) {
    this.stripEl.textContent = text;
  }

  banner(text: string, seconds = 2.5) {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.add('show');
    this.bannerTimer = seconds;
  }

  toast(text: string, color = '#fff') {
    if (!text) return;
    this.toastEl.textContent = text;
    this.toastEl.style.color = color;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
    this.toastTimer = 2.2;
  }

  update(dt: number, match: Match, events: MatchEvent[]) {
    this.score0.textContent = String(match.scores[0]);
    this.score1.textContent = String(match.scores[1]);
    this.clockEl.textContent = formatClock(match.clock);
    this.periodEl.textContent = match.period <= 4 ? `Q${match.period}` : `OT${match.period - 4}`;
    this.shotEl.textContent = String(Math.max(0, Math.ceil(match.shotClock)));
    this.shotEl.classList.toggle('warn', match.shotClock < 5 && match.phase === 'live');
    for (const e of events) {
      const t0 = match.opts.teams[0];
      const t1 = match.opts.teams[1];
      const color = e.team === 0 ? t0.colors.primary : t1.colors.primary;
      if (e.type === 'score' || e.type === 'steal' || e.type === 'block' || e.type === 'dunk' || e.type === 'assist' || e.type === 'shotclock' || e.type === 'oob' || e.type === 'tip' || e.type === 'sub' || e.type === 'turnover') {
        if (e.text) this.toast(e.text, e.type === 'score' || e.type === 'dunk' || e.type === 'steal' || e.type === 'block' ? color : '#fff');
      }
      if (e.type === 'period') this.banner(e.text, 2.8);
      if (e.type === 'end') this.banner(`FINAL  ${match.scores[0]} - ${match.scores[1]}`, 4);
      if (e.type === 'green') this.toast('GREEN!', '#38ff7a');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('show');
    }
    // Shot meter projected next to the shooter.
    const m = match.meter;
    const c = match.controlled;
    if (m.active && c) {
      this.meterEl.style.display = '';
      const p = this.tmp.set(c.pos.x, 2.3, c.pos.z).project(this.camera);
      const x = (p.x * 0.5 + 0.5) * window.innerWidth + 40;
      const y = (-p.y * 0.5 + 0.5) * window.innerHeight - 60;
      this.meterEl.style.transform = `translate(${x}px, ${y}px)`;
      const fill = Math.min(1, m.t / 0.8);
      this.meterFill.style.height = `${fill * 100}%`;
      this.meterFill.style.background = fill > 0.5 && fill < 0.63 ? '#38ff7a' : '#ffd166';
    } else {
      this.meterEl.style.display = 'none';
    }
    const fb = match.shotFeedback;
    if (fb && match.time - fb.at < 1.2) {
      this.feedbackEl.textContent = fb.text;
      this.feedbackEl.style.color = fb.color;
      this.feedbackEl.style.opacity = String(1 - (match.time - fb.at) / 1.2);
    } else this.feedbackEl.style.opacity = '0';
    // Control hints.
    const s = this.input.state;
    const ib = match.inbound;
    const inbounding = !!ib && match.phase !== 'live' && ib.manual && match.controlled === ib.inbounder;
    const withBall = match.phase === 'live' && !!match.holder && match.holder === match.controlled;
    const offense = match.possession === 0;
    const pad = s.lastDevice === 'gamepad' ? s.gamepadType : null;
    const names = pad === 'ps'
      ? { a: '□', b: '✕', x: '○', y: '△', sprint: 'R2', skill: 'R-STICK', pick: 'L1' }
      : pad
        ? { a: 'X', b: 'A', x: 'B', y: 'Y', sprint: 'RT', skill: 'R-STICK', pick: 'LB' }
        : s.usingTouch
          ? null
          : { a: 'SPACE', b: 'E', x: 'Q', y: 'R', sprint: 'SHIFT', skill: 'ARROWS', pick: 'F' };
    let hint = '';
    if (names && match.opts.userControlled && match.controlled) {
      if (inbounding) hint = `<b>${names.b}</b> Inbound pass · <b>${names.x}</b> Bounce · <b>${names.y}</b> Lob · aim with the stick`;
      else if (withBall) hint = `<b>${names.a}</b> Shoot · <b>${names.b}</b> Pass · <b>${names.x}</b> Bounce · <b>${names.y}</b> Lob · <b>${names.skill}</b> Moves · <b>${names.pick}</b> Call screen · <b>${names.sprint}</b> Sprint`;
      else if (offense) hint = `<b>${names.b}</b> Call for the ball · <b>${names.pick}</b> Set screen (stand still) · <b>${names.y}</b> Rebound · <b>${names.sprint}</b> Sprint`;
      else hint = `<b>${names.a}</b> Steal · <b>${names.y}</b> Block · <b>${names.b}</b> Switch · <b>${names.sprint}</b> Sprint`;
    }
    if (this.hintEl.innerHTML !== hint) this.hintEl.innerHTML = hint;
    // Career panel.
    if (match.opts.career && match.userAthlete) {
      const u = match.userAthlete;
      const st = u.stats;
      const mom = match.nextMoment;
      this.careerEl.style.display = '';
      this.careerEl.innerHTML = `<b>${u.def.first.toUpperCase()} ${u.def.last.toUpperCase()}</b> ${st.pts} PTS · ${st.reb} REB · ${st.ast} AST · ${st.stl} STL · ${st.blk} BLK · ${st.fgm}/${st.fga} FG${match.userOnCourt ? '' : mom ? ' · <i>on the bench</i>' : ''}`;
    } else this.careerEl.style.display = 'none';
    if (match.debug && match.director?.lastMods) {
      const d = match.director.lastMods;
      this.debugEl.textContent = `t=${match.t01.toFixed(2)} margin=${match.margin} target=${d.targetMargin.toFixed(1)} err=${d.error.toFixed(1)} user×${d.userShot.toFixed(2)} opp×${d.oppShot.toFixed(2)} force=${d.force.toFixed(2)}${d.forceDir} feed=${d.feedUser.toFixed(2)} ${match.phase}`;
    }
  }

  destroy() {
    this.el.remove();
  }
}
