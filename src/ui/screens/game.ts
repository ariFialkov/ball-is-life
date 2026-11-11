import { App, h, type Screen } from '../../app/app.ts';
import { store } from '../../app/store.ts';
import { Match, type MatchOptions } from '../../match/match.ts';
import { Hud } from '../../match/hud.ts';
import { audio } from '../../engine/audio.ts';
import { ReplayRecorder, type Clip } from '../../match/replay.ts';
import * as THREE from 'three';
import { coopDevices } from '../coop.ts';

export interface GameResult {
  scores: [number, number];
  userWon: boolean;
  match: Match;
}

export interface GameScreenOptions {
  matchOptions: Omit<MatchOptions, 'scene' | 'camera' | 'input' | 'mobile' | 'userControlled'>;
  strip: string;
  onFinish: (result: GameResult) => void;
  onQuit: () => void;
}

/** Plays a full match with HUD, pause menu and (career) moment fast-forwards. */
export function gameScreen(app: App, opts: GameScreenOptions): Screen {
  app.takeScene();
  const el = h('div', { class: 'game-root' });
  // Local co-op: each player reads only their own devices (menus and pause keep reading everything).
  app.input.coop = opts.matchOptions.coop ? coopDevices(app.input, store.data.settings.coopSwap) : null;
  const match = new Match({
    ...opts.matchOptions,
    userControlled: true,
    scene: app.renderer.scene,
    camera: app.camera,
    input: app.input,
    mobile: app.mobile,
  });
  match.debug = app.debug;
  match.autopilot = app.autopilot;
  (window as any).__match = match;
  app.camera.mode = store.data.settings.camera;
  app.camera.attackDir = match.attackDir(match.possession);
  app.camera.prime(match.ball.pos);
  const hud = new Hud(app.overlay, match, app.renderer.camera, app.input, { strip: opts.strip });
  const touchSetting = store.data.settings.touch;
  const showTouch = touchSetting === 'on' || (touchSetting === 'auto' && app.mobile);
  app.touch.setVisible(showTouch);
  let paused = false;
  let dialog: HTMLElement | null = null;
  let finished = false;
  let simOverlay: HTMLElement | null = null;
  let simTimer = 0;
  let pendingBanner: string | null = null;
  let injurySimmed = false;

  const closeDialog = () => {
    dialog?.remove();
    dialog = null;
    paused = false;
    match.paused = false;
  };
  const openPause = () => {
    if (paused || finished) return;
    paused = true;
    match.paused = true;
    const resume = h('button', { class: 'btn primary', 'data-nav-back': '', 'data-nav-default': '' }, 'RESUME');
    resume.onclick = () => closeDialog();
    const cam = h('button', { class: 'btn' }, `CAMERA: ${app.camera.mode.toUpperCase()}`);
    cam.onclick = () => {
      app.camera.mode = app.camera.mode === '2k' ? 'broadcast' : '2k';
      store.data.settings.camera = app.camera.mode as '2k' | 'broadcast';
      store.save();
      cam.textContent = `CAMERA: ${app.camera.mode.toUpperCase()}`;
    };
    const quit = h('button', { class: 'btn ghost' }, 'FORFEIT & QUIT');
    quit.onclick = () => {
      closeDialog();
      destroy();
      opts.onQuit();
    };
    dialog = h('div', { class: 'dialog' }, h('div', { class: 'panel' }, h('h3', {}, 'PAUSED'), h('div', { class: 'muted' }, opts.strip), resume, cam, quit, h('div', { class: 'notice' }, 'Forfeiting settles the bet as a loss.')));
    app.overlay.appendChild(dialog);
  };
  hud.onPause = openPause;

  const startSim = (text: string) => {
    simOverlay = h('div', { class: 'sim-overlay' }, h('div', { class: 'big' }, text), h('div', { class: 'scoreline' }, `${match.scores[0]} – ${match.scores[1]}`), h('div', { class: 'muted' }, 'SIMULATING...'));
    app.overlay.appendChild(simOverlay);
    simTimer = 1.6;
  };

  // Broadcast presentation (the open, replays, play of the game) for real play. Automated test
  // drivers (webdriver, autopilot, sped-up sims) skip it unless ?broadcast asks for it.
  const broadcast = new URLSearchParams(location.search).has('broadcast') || (!navigator.webdriver && !app.autopilot && app.timeScale === 1);
  const rec = new ReplayRecorder(match);
  type Highlight = { t: number; value: number; caption: string };
  let stage: 'open' | 'play' | 'replay' = 'play';
  let stageT = 0;
  let replay: { clip: Clip; t: number; focus: THREE.Vector3; angle: number; restore: Float32Array; after: 'play' | 'finish' } | null = null;
  let lastReplayAt = -99;
  let finishWait = false;
  let pending: Highlight | null = null;
  let bestPending: Highlight | null = null;
  let best: { clip: Clip; value: number; caption: string } | null = null;
  const tmpV = new THREE.Vector3();

  const beginPlay = () => {
    stage = 'play';
    hud.showOpen(match, false);
    app.touch.setVisible(showTouch);
    app.camera.mode = store.data.settings.camera;
    app.camera.attackDir = match.attackDir(match.possession);
    app.camera.prime(match.ball.pos);
    // Career: start on the bench and fast-forward to the first moment.
    if (opts.matchOptions.career) {
      match.subUserOut();
      startSim('WARMING UP');
      match.fastForwardToNextMoment();
      (simOverlay!.querySelector('.scoreline') as HTMLElement).textContent = `${match.scores[0]} – ${match.scores[1]}`;
      pendingBanner = `${opts.matchOptions.career.player.last.toUpperCase()} CHECKS IN`;
    }
  };
  if (broadcast) {
    stage = 'open';
    hud.showOpen(match, true);
    app.touch.setVisible(false);
    app.camera.mode = 'manual';
    app.camera.manualRate = 2.2;
    app.camera.manualPos.set(10, 7, 16);
    app.camera.manualLook.set(0, 1.4, 0);
    app.camera.snap();
  } else beginPlay();

  const anyPress = () => {
    const p = app.input.state.pressed;
    return p.a || p.b || p.x || p.y || p.confirm || p.back || p.sprint;
  };

  /** Play back a clip with a slow, orbiting low camera and the letterbox. */
  const startReplay = (clip: Clip, caption: string, after: 'play' | 'finish') => {
    stage = 'replay';
    const mid = clip.frames[Math.floor(clip.frames.length * 0.7)];
    const focus = rec.ballIn(mid, new THREE.Vector3());
    replay = { clip, t: 0, focus, angle: Math.atan2(focus.z || 0.01, -Math.sign(focus.x || 1) * 3), restore: rec.snapshot(), after };
    hud.showReplay(true, caption);
    app.touch.setVisible(false);
    app.camera.mode = 'manual';
    app.camera.manualRate = 6;
    lastReplayAt = rec.time;
  };
  const endReplay = () => {
    if (!replay) return;
    rec.apply(replay.restore);
    const after = replay.after;
    replay = null;
    hud.showReplay(false);
    app.touch.setVisible(showTouch);
    stage = 'play';
    app.camera.mode = store.data.settings.camera;
    app.camera.prime(match.ball.pos);
    if (after === 'finish') finishGame();
  };
  const finishGame = () => {
    const result: GameResult = { scores: [match.scores[0], match.scores[1]], userWon: match.scores[0] > match.scores[1], match };
    audio.cheer(0.5);
    destroy();
    opts.onFinish(result);
  };

  const destroy = () => {
    app.input.coop = null;
    hud.destroy();
    app.touch.setVisible(false);
    dialog?.remove();
    simOverlay?.remove();
    match.dispose();
  };

  return {
    el,
    update(dt, t) {
      if (app.input.state.pressed.pause && stage === 'play') {
        if (paused) closeDialog();
        else openPause();
      }
      // The open: a slow orbit of the arena under the matchup card.
      if (stage === 'open') {
        stageT += dt;
        const a = 0.35 + stageT * 0.28;
        app.camera.manualPos.set(Math.sin(a) * 15, 6.4 - stageT * 0.6, Math.cos(a) * 13);
        app.camera.manualLook.set(0, 1.4, 0);
        app.camera.update(dt, app.camera.manualLook, t);
        for (const x of match.athletes) if (x.onCourt) x.char.update(dt, 0);
        if (stageT > 4.6 || (stageT > 0.4 && anyPress())) beginPlay();
        return;
      }
      // Replays: frames from the recording, slowed down, with a low orbiting camera.
      if (stage === 'replay' && replay) {
        replay.t += dt * 0.5;
        const c = replay.clip;
        const at = c.times[0] + replay.t;
        let k = c.times.findIndex((x) => x >= at);
        if (k < 0) k = c.times.length - 1;
        const f = c.frames[k];
        rec.apply(f);
        const ball = rec.ballIn(f, tmpV);
        replay.focus.lerp(ball, Math.min(1, dt * 2.5));
        const ang = replay.angle + replay.t * 0.45;
        app.camera.manualPos.set(replay.focus.x + Math.cos(ang) * 5.6, 1.5 + Math.max(0, ball.y - 2) * 0.4, replay.focus.z + Math.sin(ang) * 5.6);
        app.camera.manualLook.set(replay.focus.x, THREE.MathUtils.clamp(replay.focus.y, 1.1, 3.2), replay.focus.z);
        app.camera.update(dt, app.camera.manualLook, t);
        if (at >= c.times[c.times.length - 1] || (replay.t > 0.3 && anyPress())) endReplay();
        return;
      }
      if (simOverlay) {
        simTimer -= dt;
        if (simTimer <= 0) {
          simOverlay.remove();
          simOverlay = null;
          if (pendingBanner) {
            hud.banner(pendingBanner, 2.2);
            pendingBanner = null;
          }
          hud.update(0, match, []);
        }
        return;
      }
      if (paused) return;
      // Context-sensitive touch buttons (2K layout: shoot/steal, pass/switch, lob/block, sprint).
      if (showTouch) {
        const ib = match.inbound;
        const inbounding = !!ib && match.phase !== 'live' && ib.manual && match.controlled === ib.inbounder;
        const withBall = match.phase === 'live' && !!match.holder && match.holder === match.controlled;
        if (inbounding) app.touch.setLabels({ a: '', b: 'INBOUND', x: 'SPRINT', y: 'LOB' });
        else if (withBall) app.touch.setLabels({ a: 'SHOOT', b: 'PASS', x: 'SPRINT', y: 'LOB', pick: 'SCREEN' });
        else if (match.possession === 0) app.touch.setLabels({ a: '', b: 'CALL', x: 'SPRINT', y: 'JUMP', pick: 'SCREEN' });
        else app.touch.setLabels({ a: 'STEAL', b: 'SWITCH', x: 'SPRINT', y: 'BLOCK' });
        app.touch.setSwipe(withBall);
      }
      for (let i = 0; i < app.timeScale; i++) match.update(Math.min(dt, 1 / 30));
      const events = match.takeEvents();
      hud.update(dt, match, events);
      if (broadcast) {
        rec.capture(dt);
        // Highlights: made dunks, threes and blocks (clutch time and our team count for more).
        for (const e of events) {
          const who = e.athlete ? `${e.athlete.def.name.toUpperCase()}` : '';
          let value = 0;
          let caption = '';
          if (e.type === 'dunk' && e.text === 'THROWS IT DOWN!') [value, caption] = [3, `${who} THROWS IT DOWN`];
          else if (e.type === 'score' && e.points === 3) [value, caption] = [2, `${who} FROM DOWNTOWN`];
          else if (e.type === 'block') [value, caption] = [2.5, `${who} SENDS IT BACK`];
          if (!value) continue;
          if (match.period >= 4) value += 1;
          if (e.team === 0) value += 0.5;
          // Live replays only for the big ones (any dunk or block, our threes, clutch threes).
          const live = value >= 2.5;
          const hl = { t: rec.time, value, caption };
          if (live && (!pending || value >= pending.value)) pending = hl;
          if (!bestPending || value >= bestPending.value) bestPending = hl;
        }
        if (bestPending && rec.time >= bestPending.t + 1.0) {
          const clip = rec.clip(bestPending.t - 2.2, bestPending.t + 1.0);
          if (clip && (!best || bestPending.value >= best.value)) best = { clip, value: bestPending.value, caption: bestPending.caption };
          bestPending = null;
        }
        // Replay the highlight in the next dead ball (not too often).
        if (pending && (rec.time - pending.t > 3.2 || match.phase === 'period')) pending = null;
        if (pending && rec.time - pending.t > 1.0 && (match.phase === 'dead' || match.phase === 'inbound') && !hud.graphicShowing && !simOverlay && rec.time - lastReplayAt > 40 && !match.finished) {
          const clip = rec.clip(pending.t - 2.2, pending.t + 0.9);
          const cap = pending.caption;
          pending = null;
          if (clip) {
            startReplay(clip, cap, 'play');
            return;
          }
        }
      }
      // Career: an injury ends the player's night; the rest of the game is simulated.
      if (opts.matchOptions.career && match.userInjured && !injurySimmed && match.phase !== 'end') {
        injurySimmed = true;
        match.fastForwardToNextMoment();
        startSim('INJURY');
        simTimer = 2.6;
      }
      // Career: when a moment ends, sim ahead to the next one.
      if (opts.matchOptions.career && match.momentOver && match.phase === 'live' && !match.ball.shot) {
        const more = match.fastForwardToNextMoment();
        startSim(more ? 'BACK ON THE BENCH' : 'FINAL STRETCH');
        if (more) pendingBanner = `${opts.matchOptions.career.player.last.toUpperCase()} CHECKS BACK IN`;
        if (!more) {
          // No more moments: the rest of the game is simulated.
          simTimer = 2.2;
        }
      } else if (opts.matchOptions.career && !match.userOnCourt && !simOverlay && (match.phase === 'live' || match.phase === 'inbound') && !match.ball.shot) {
        // Safety net: never make the player watch live play from the bench.
        const more = match.fastForwardToNextMoment();
        startSim(more ? 'BACK ON THE BENCH' : 'FINAL STRETCH');
        if (more) pendingBanner = `${opts.matchOptions.career.player.last.toUpperCase()} CHECKS BACK IN`;
        else simTimer = 2.2;
      }
      if (match.finished && !finished) {
        finished = true;
        finishWait = true;
      }
      // Let the FINAL graphic show, then the play of the game, then the results.
      if (finishWait && (!broadcast || !hud.graphicShowing)) {
        finishWait = false;
        if (broadcast && best) startReplay(best.clip, `PLAY OF THE GAME · ${best.caption}`, 'finish');
        else finishGame();
      }
    },
    destroy() {
      if (!finished) destroy();
    },
  };
}
