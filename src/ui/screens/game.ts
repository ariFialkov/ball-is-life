import { App, h, type Screen } from '../../app/app.ts';
import { store } from '../../app/store.ts';
import { Match, type MatchOptions } from '../../match/match.ts';
import { Hud } from '../../match/hud.ts';
import { audio } from '../../engine/audio.ts';

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

  // Career: start on the bench and fast-forward to the first moment.
  if (opts.matchOptions.career) {
    match.subUserOut();
    startSim('WARMING UP');
    match.fastForwardToNextMoment();
    (simOverlay!.querySelector('.scoreline') as HTMLElement).textContent = `${match.scores[0]} – ${match.scores[1]}`;
    pendingBanner = `${opts.matchOptions.career.player.last.toUpperCase()} CHECKS IN`;
  }

  const destroy = () => {
    hud.destroy();
    app.touch.setVisible(false);
    dialog?.remove();
    simOverlay?.remove();
    match.dispose();
  };

  return {
    el,
    update(dt) {
      if (app.input.state.pressed.pause) {
        if (paused) closeDialog();
        else openPause();
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
        else if (withBall) app.touch.setLabels({ a: 'SHOOT', b: 'PASS', x: 'SPRINT', y: 'LOB' });
        else if (match.possession === 0) app.touch.setLabels({ a: '', b: 'CALL', x: 'SPRINT', y: '' });
        else app.touch.setLabels({ a: 'STEAL', b: 'SWITCH', x: 'SPRINT', y: 'BLOCK' });
        app.touch.setSwipe(withBall);
      }
      for (let i = 0; i < app.timeScale; i++) match.update(Math.min(dt, 1 / 30));
      const events = match.takeEvents();
      hud.update(dt, match, events);
      // Career: when a moment ends, sim ahead to the next one.
      if (opts.matchOptions.career && match.momentOver && match.phase === 'live' && !match.ball.shot) {
        const more = match.fastForwardToNextMoment();
        startSim(more ? 'BACK ON THE BENCH' : 'FINAL STRETCH');
        if (more) pendingBanner = `${opts.matchOptions.career.player.last.toUpperCase()} CHECKS BACK IN`;
        if (!more) {
          // No more moments: the rest of the game is simulated.
          simTimer = 2.2;
        }
      }
      if (match.finished && !finished) {
        finished = true;
        const result: GameResult = { scores: [match.scores[0], match.scores[1]], userWon: match.scores[0] > match.scores[1], match };
        audio.cheer(0.5);
        destroy();
        opts.onFinish(result);
      }
    },
    destroy() {
      if (!finished) destroy();
    },
  };
}
