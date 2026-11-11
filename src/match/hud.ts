import * as THREE from 'three';
import type { Match, MatchEvent } from './match.ts';
import { formatClock, shotWindow, SHOT_IDEAL } from './match.ts';
import { buttonNames, type Input } from '../engine/input.ts';
import { teamLogoDataUrl } from '../data/logos.ts';
import type { TeamDef } from '../data/teams.ts';

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
  /** One shot meter per user. */
  private meters: { el: HTMLElement; label: HTMLElement; state: string }[] = [];
  /** Co-op: the P1 / P2 tags over each player's athlete. */
  private tags: HTMLElement[] = [];
  private hintEl: HTMLElement;
  private stripEl: HTMLElement;
  private bannerEl: HTMLElement;
  private careerEl: HTMLElement;
  private debugEl: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private chyronEl: HTMLElement;
  private openEl: HTMLElement;
  private replayEl: HTMLElement;
  private poss0: HTMLElement;
  private poss1: HTMLElement;
  private toastTimer = 0;
  private bannerTimer = 0;
  private chyronTimer = 0;
  /** Scoring run tracking for the "on a run" chyron. */
  private run = { team: -1, pts: 0, shown: 0 };
  private tmp = new THREE.Vector3();
  onPause: (() => void) | null = null;

  constructor(root: HTMLElement, match: Match, private camera: THREE.PerspectiveCamera, private input: Input, ctx: HudContext) {
    const t0 = match.opts.teams[0];
    const t1 = match.opts.teams[1];
    this.el = document.createElement('div');
    this.el.className = 'hud';
    const logo = (t: TeamDef) => `<img src="${teamLogoDataUrl(t, 96)}" alt="">`;
    this.el.innerHTML = `
      <div class="hud-bug">
        <div class="bug-net"><span>BIL</span><b>27</b></div>
        <div class="hud-team" style="--c:${t0.colors.primary};--c2:${t0.colors.secondary}">${logo(t0)}<span class="abbr">${t0.abbr}</span><span class="score s0">0</span><i class="poss p0"></i></div>
        <div class="hud-clock"><span class="period">Q1</span><span class="clock">12:00</span><span class="shot">24</span></div>
        <div class="hud-team away" style="--c:${t1.colors.primary};--c2:${t1.colors.secondary}"><i class="poss p1"></i><span class="score s1">0</span><span class="abbr">${t1.abbr}</span>${logo(t1)}</div>
      </div>
      <div class="hud-strip"></div>
      <button class="hud-pause" aria-label="Pause">II</button>
      <div class="hud-career"></div>
      <div class="hud-toast"></div>
      <div class="hud-banner"></div>
      <div class="hud-chyron"></div>
      <div class="hud-open"></div>
      <div class="hud-replay"><div class="lb top"></div><div class="lb bot"></div><div class="replay-bug"><b>REPLAY</b><span></span></div></div>
      <div class="coop-tags"></div>
      <div class="shot-meters"></div>
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
    for (const u of match.users) {
      const m = document.createElement('div');
      m.className = `shot-meter p${u.id + 1}${match.coop ? ' coop' : ''}`;
      m.innerHTML = `<i class="sm-tag">P${u.id + 1}</i><div class="sm-bar"><div class="sm-good"></div><div class="sm-green"></div><div class="sm-fill"></div><div class="sm-tip"></div></div><div class="sm-label"></div>`;
      q('.shot-meters').append(m);
      this.meters.push({ el: m, label: m.querySelector('.sm-label') as HTMLElement, state: '' });
      if (match.coop) {
        const t = document.createElement('div');
        t.className = `coop-tag p${u.id + 1}`;
        t.innerHTML = `<b>P${u.id + 1}</b><i></i>`;
        q('.coop-tags').append(t);
        this.tags.push(t);
      }
    }
    this.hintEl = q('.hud-hint');
    this.stripEl = q('.hud-strip');
    this.bannerEl = q('.hud-banner');
    this.careerEl = q('.hud-career');
    this.debugEl = q('.hud-debug');
    this.pauseBtn = q('.hud-pause') as HTMLButtonElement;
    this.chyronEl = q('.hud-chyron');
    this.openEl = q('.hud-open');
    this.replayEl = q('.hud-replay');
    this.poss0 = q('.p0');
    this.poss1 = q('.p1');
    this.pauseBtn.addEventListener('click', () => this.onPause?.());
    this.stripEl.textContent = ctx.strip;
    this.debugEl.style.display = match.debug ? '' : 'none';
    this.update(0, match, []);
  }

  setStrip(text: string) {
    this.stripEl.textContent = text;
  }

  banner(text: string, seconds = 2.5) {
    this.bannerEl.innerHTML = '';
    this.bannerEl.append(slab(text));
    this.bannerEl.classList.add('show');
    this.bannerTimer = seconds;
  }

  /** A full-width broadcast graphic: label over the two teams' logos and the score (and halftime stats). */
  scoreGraphic(match: Match, label: string, seconds: number, stats = false) {
    const [t0, t1] = match.opts.teams;
    const side = (t: TeamDef, pts: number, r: boolean) => `<div class="g-side${r ? ' r' : ''}" style="--c:${t.colors.primary};--c2:${t.colors.secondary}"><img src="${teamLogoDataUrl(t, 128)}" alt=""><span class="g-ab">${t.abbr}</span><span class="g-pts">${pts}</span></div>`;
    let html = `<div class="g-label">${label}</div><div class="g-score">${side(t0, match.scores[0], false)}${side(t1, match.scores[1], true)}</div>`;
    if (stats) {
      const st = teamStats(match);
      const row = (k: string, a: string, b: string) => `<div class="g-row"><span>${a}</span><b>${k}</b><span>${b}</span></div>`;
      html += `<div class="g-stats">${row('FG%', st[0].fg, st[1].fg)}${row('3PT%', st[0].tp, st[1].tp)}${row('REB', st[0].reb, st[1].reb)}${row('AST', st[0].ast, st[1].ast)}${row('STL', st[0].stl, st[1].stl)}</div>`;
    }
    this.bannerEl.innerHTML = `<div class="g-card">${html}</div>`;
    this.bannerEl.classList.add('show');
    this.bannerTimer = seconds;
  }

  /** Lower third: team colour, logo, a name and a line. */
  chyron(team: TeamDef, title: string, line: string, seconds = 3.2) {
    this.chyronEl.innerHTML = `<div class="ch" style="--c:${team.colors.primary};--c2:${team.colors.secondary}"><img src="${teamLogoDataUrl(team, 96)}" alt=""><div class="ch-txt"><div class="ch-title">${title}</div><div class="ch-line">${line}</div></div></div>`;
    this.chyronEl.classList.remove('show');
    void this.chyronEl.offsetWidth;
    this.chyronEl.classList.add('show');
    this.chyronTimer = seconds;
  }

  /** The pre-game open: TONIGHT, the two teams, the arena. */
  /** A period / final graphic is on screen (replays wait for it). */
  get graphicShowing() {
    return this.bannerTimer > 0;
  }

  showOpen(match: Match, on: boolean) {
    this.el.classList.toggle('opening', on);
    if (!on) {
      this.openEl.classList.remove('show');
      return;
    }
    const [t0, t1] = match.opts.teams;
    const home = match.opts.teams[match.opts.homeIndex ?? 0];
    const team = (t: TeamDef) => `<div class="o-team" style="--c:${t.colors.primary};--c2:${t.colors.secondary}"><img src="${teamLogoDataUrl(t, 192)}" alt=""><div class="o-city">${t.city}</div><div class="o-name">${t.name}</div><div class="o-ovr">${t.ovr} OVR</div></div>`;
    this.openEl.innerHTML = `<div class="o-card"><div class="o-top"><span class="o-net">BALL IS LIFE <b>27</b></span><span class="o-kick">TONIGHT · LIVE</span></div><div class="o-teams">${team(t0)}<div class="o-vs">VS</div>${team(t1)}</div><div class="o-arena">${home.arena.name.toUpperCase()} · ${home.arena.city.toUpperCase()}</div><div class="o-skip">PRESS ANY BUTTON TO SKIP</div></div>`;
    this.openEl.classList.add('show');
  }

  /** Replay presentation: letterbox and the REPLAY bug with a caption. */
  showReplay(on: boolean, caption = '') {
    if (on) {
      this.bannerEl.classList.remove('show');
      this.bannerTimer = 0;
    }
    this.replayEl.classList.toggle('show', on);
    (this.replayEl.querySelector('.replay-bug span') as HTMLElement).textContent = caption;
    this.el.classList.toggle('replaying', on);
  }

  toast(text: string, color = '#fff') {
    if (!text) return;
    this.toastEl.innerHTML = '';
    this.toastEl.append(slab(text));
    this.toastEl.style.setProperty('--tc', color);
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
    const live = match.phase === 'live' || match.phase === 'inbound';
    this.poss0.classList.toggle('on', live && match.possession === 0);
    this.poss1.classList.toggle('on', live && match.possession === 1);
    for (const e of events) {
      const t0 = match.opts.teams[0];
      const t1 = match.opts.teams[1];
      const team = e.team === 0 ? t0 : t1;
      const color = team.colors.primary;
      if (e.type === 'score' || e.type === 'steal' || e.type === 'block' || e.type === 'dunk' || e.type === 'assist' || e.type === 'shotclock' || e.type === 'oob' || e.type === 'tip' || e.type === 'sub' || e.type === 'turnover') {
        if (e.text) this.toast(e.text, e.type === 'score' || e.type === 'dunk' || e.type === 'steal' || e.type === 'block' ? color : '#fff');
      }
      // Lower thirds: the scorer's line, scoring runs, defensive plays.
      if (e.type === 'score' && e.athlete) {
        const a = e.athlete;
        const st = a.stats;
        if (this.run.team === e.team) this.run.pts += e.points ?? 2;
        else this.run = { team: e.team, pts: e.points ?? 2, shown: 0 };
        if (this.run.pts >= 7 && this.run.pts - this.run.shown >= 4) {
          this.run.shown = this.run.pts;
          this.chyron(team, `${team.abbr} ON A ${this.run.pts}-0 RUN`, `${team.city.toUpperCase()} ${team.name.toUpperCase()} · ${match.scores[e.team]}-${match.scores[1 - e.team]}`);
        } else {
          this.chyron(team, `#${a.def.number} ${a.def.name.toUpperCase()}`, `${st.pts} PTS · ${st.fgm}/${st.fga} FG${st.tpa ? ` · ${st.tpm}/${st.tpa} 3PT` : ''}${st.ast ? ` · ${st.ast} AST` : ''}`);
        }
      }
      if ((e.type === 'steal' || e.type === 'block') && e.athlete) {
        const a = e.athlete;
        this.chyron(team, `#${a.def.number} ${a.def.name.toUpperCase()}`, `${a.stats.stl} STL · ${a.stats.blk} BLK · ${a.stats.reb} REB`, 2.6);
      }
      if (e.type === 'period') this.scoreGraphic(match, e.text, e.text === 'HALFTIME' ? 4.5 : 3, e.text === 'HALFTIME');
      if (e.type === 'end') this.scoreGraphic(match, 'FINAL', 3.5, true);
    }
    if (this.chyronTimer > 0) {
      this.chyronTimer -= dt;
      if (this.chyronTimer <= 0) this.chyronEl.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('show');
    }
    this.updateMeters(match);
    // Control hints.
    const s = this.input.state;
    const ib = match.inbound;
    const inbounding = !!ib && match.phase !== 'live' && ib.manual && match.controlled === ib.inbounder;
    const withBall = match.phase === 'live' && !!match.holder && match.holder === match.controlled;
    const offense = match.possession === 0;
    const names = buttonNames(s);
    let hint = '';
    if (match.coop) hint = this.coopHints(match);
    else if (names && match.opts.userControlled && match.controlled) {
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

  /** Screen position of a world point (null when it is behind the camera). */
  private screen(x: number, y: number, z: number): [number, number] | null {
    const p = this.tmp.set(x, y, z).project(this.camera);
    if (p.z > 1) return null;
    return [(p.x * 0.5 + 0.5) * window.innerWidth, (-p.y * 0.5 + 0.5) * window.innerHeight];
  }

  /**
   * The shot meter: a slim skewed bar beside the shooter that fills while the button is held. The
   * bright band is the green window (the same maths as the release), the faint band around it is a
   * good release. It freezes where the button was let go, then grades the shot: a green release
   * flashes the whole meter green, otherwise it reads GOOD, EARLY or LATE.
   */
  private updateMeters(match: Match) {
    const FULL = 0.6;
    const replaying = this.el.classList.contains('replaying') || this.el.classList.contains('opening');
    match.users.forEach((u, i) => {
      const mt = this.meters[i];
      const m = u.meter;
      const a = u.athlete;
      const show = !!a && !replaying && (m.active || (m.quality !== null && match.time - m.endedAt < 1.1));
      mt.el.classList.toggle('on', show);
      if (!show || !a) return;
      const at = this.screen(a.pos.x, 2.0, a.pos.z);
      if (at) mt.el.style.transform = `translate3d(${(at[0] + 34).toFixed(1)}px, ${(at[1] - 52).toFixed(1)}px, 0)`;
      const w = shotWindow(m.fade);
      const pct = (t: number) => `${(Math.min(1, Math.max(0, t / FULL)) * 100).toFixed(2)}%`;
      const st = mt.el.style;
      st.setProperty('--g0', pct(SHOT_IDEAL - 0.1 * w));
      st.setProperty('--g1', pct(SHOT_IDEAL + 0.1 * w));
      st.setProperty('--k0', pct(SHOT_IDEAL - 0.35 * w));
      st.setProperty('--k1', pct(SHOT_IDEAL + 0.35 * w));
      const r = m.release ?? (m.active ? m.t : 0.9);
      st.setProperty('--f', pct(r));
      let state: string;
      if (m.active) state = Math.abs(r - SHOT_IDEAL) < 0.1 * w ? 'live in-green' : 'live';
      else {
        const q = m.quality ?? 0;
        state = q > 0.9 ? 'done g-green' : q > 0.65 ? 'done g-good' : 'done g-off';
        mt.label.textContent = q > 0.9 ? 'GREEN' : q > 0.65 ? 'GOOD' : r < SHOT_IDEAL ? 'EARLY' : 'LATE';
      }
      if (state !== mt.state) {
        mt.el.classList.remove('live', 'in-green', 'done', 'g-green', 'g-good', 'g-off');
        mt.el.classList.add(...state.split(' '));
        if (state === 'live') mt.label.textContent = '';
        mt.state = state;
      }
    });
    // Co-op name tags over each person's player.
    match.users.forEach((u, i) => {
      const tag = this.tags[i];
      if (!tag) return;
      const a = u.athlete;
      const at = a && a.onCourt && !replaying ? this.screen(a.pos.x, a.def.height + 0.42, a.pos.z) : null;
      tag.style.opacity = at ? '1' : '0';
      if (at) tag.style.transform = `translate3d(${at[0].toFixed(1)}px, ${at[1].toFixed(1)}px, 0) translate(-50%, -100%)`;
    });
  }

  /** Co-op: a short context line per player, in their own device's button names. */
  private coopHints(match: Match): string {
    return match.users
      .map((u) => {
        const n = buttonNames(this.input.players[u.id]);
        const a = u.athlete;
        if (!n || !a) return '';
        const ib = match.inbound;
        let line: string;
        if (ib && match.phase !== 'live' && ib.manual && a === ib.inbounder) line = `<b>${n.b}</b> Inbound · <b>${n.y}</b> Lob`;
        else if (match.holder === a) line = `<b>${n.a}</b> Shoot · <b>${n.b}</b> Pass · <b>${n.y}</b> Lob · <b>${n.skill}</b> Moves`;
        else if (match.possession === 0) line = `<b>${n.b}</b> Call for it · <b>${n.pick}</b> Screen · <b>${n.sprint}</b> Sprint`;
        else line = `<b>${n.a}</b> Steal · <b>${n.y}</b> Block · <b>${n.b}</b> Switch`;
        return `<span class="ph"><i class="ptag p${u.id + 1}">P${u.id + 1}</i> ${line}</span>`;
      })
      .join('');
  }
}

/** A skewed broadcast slab around a line of text. */
function slab(text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'slab';
  const sp = document.createElement('span');
  sp.textContent = text;
  d.append(sp);
  return d;
}

function teamStats(match: Match) {
  return [0, 1].map((t) => {
    const s = match.athletes.filter((a) => a.team === t).reduce((x, a) => ({ fgm: x.fgm + a.stats.fgm, fga: x.fga + a.stats.fga, tpm: x.tpm + a.stats.tpm, tpa: x.tpa + a.stats.tpa, reb: x.reb + a.stats.reb, ast: x.ast + a.stats.ast, stl: x.stl + a.stats.stl }), { fgm: 0, fga: 0, tpm: 0, tpa: 0, reb: 0, ast: 0, stl: 0 });
    const pct = (m: number, a: number) => (a ? `${Math.round((m / a) * 100)}%` : '—');
    return { fg: pct(s.fgm, s.fga), tp: pct(s.tpm, s.tpa), reb: String(s.reb), ast: String(s.ast), stl: String(s.stl) };
  });
}
