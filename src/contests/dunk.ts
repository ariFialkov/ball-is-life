import * as THREE from 'three';
import type { App, Screen } from '../app/app.ts';
import { h } from '../app/app.ts';
import type { PlayerDef, TeamDef } from '../data/teams.ts';
import { ContestScene } from './base.ts';
import type { ContestResult } from './three.ts';
import { RIM_H, RIM_X } from '../engine/constants.ts';
import { audio } from '../engine/audio.ts';
import { clamp } from '../core/rng.ts';
import type { Character } from '../engine/character.ts';

interface Opts {
  team: TeamDef;
  player: PlayerDef;
  bots: { def: PlayerDef; team: TeamDef }[];
  botsAbove: boolean[];
  strip: string;
  seed: string;
  onFinish: (r: ContestResult) => void;
}

export const DUNKS = [
  { name: 'Tomahawk', diff: 1 },
  { name: 'Reverse', diff: 2 },
  { name: 'Windmill', diff: 3 },
  { name: '360', diff: 4 },
  { name: 'Between the Legs', diff: 5 },
];

const ATTEMPTS = 2;

/** Dunk contest: pick a dunk, nail the takeoff and the slam timing, impress five judges. */
export function dunkContest(app: App, o: Opts): Screen {
  const scene = new ContestScene(app, o.team, o.strip, o.seed);
  const user = scene.addCharacter(o.player, o.team, 0, 0);
  let attempt = 0;
  let total = 0;
  let state: 'pick' | 'approach' | 'air' | 'result' | 'montage' | 'done' = 'pick';
  let dunk = DUNKS[0];
  let t = 0;
  let takeoffAcc = -1;
  let slamAcc = -1;
  let pressedTakeoff = false;
  let pressedSlam = false;
  const start = new THREE.Vector3(scene.side * (RIM_X - 9), 0, 1.2);
  const takeoff = new THREE.Vector3(scene.side * (RIM_X - 2.2), 0, 0.3);
  const approachDur = 1.5;
  const picker = h('div', { class: 'dunk-picker' });
  const botScores: number[] = [];
  let montage: { i: number; char: Character; t: number; phase: 'run' | 'air' | 'score' } | null = null;
  const ring = h('div', { class: 'timing-ring' }, h('div', { class: 'timing-inner' }), h('div', { class: 'timing-outer' }));
  scene.hud.append(picker, ring);
  ring.style.display = 'none';

  const showPicker = () => {
    picker.innerHTML = '';
    picker.style.display = '';
    for (const d of DUNKS) {
      const b = h('button', { class: 'btn small' }, `${d.name} · ★${d.diff}`);
      b.onclick = () => {
        audio.click();
        dunk = d;
        beginApproach();
      };
      picker.append(b);
    }
    scene.prompt.textContent = `DUNK ${attempt + 1} OF ${ATTEMPTS} · PICK YOUR DUNK`;
    scene.sub.textContent = 'Harder dunks score higher but need tighter timing';
    user.root.position.copy(start);
    scene.faceRim(user);
    user.setState('idleBall');
  };
  const beginApproach = () => {
    picker.style.display = 'none';
    state = 'approach';
    t = 0;
    takeoffAcc = -1;
    slamAcc = -1;
    pressedTakeoff = false;
    pressedSlam = false;
    user.setState('dribble');
    scene.prompt.textContent = 'PRESS SHOOT AS THE RING CLOSES · TAKEOFF';
    scene.sub.textContent = dunk.name.toUpperCase();
    ring.style.display = '';
    app.touch.setLabels({ a: 'JUMP', b: '', x: '', y: '' });
  };
  const judge = (exec: number, missed: boolean) => {
    const scores: number[] = [];
    for (let j = 0; j < 5; j++) {
      let s = missed ? 5 + scene.rng.float(0, 1.5) : 5.4 + dunk.diff * 0.42 + exec * 3.3 + scene.rng.float(-0.3, 0.3);
      s = clamp(Math.round(s), 5, 10);
      scores.push(s);
    }
    return scores;
  };
  const window = () => 0.34 - dunk.diff * 0.03;
  showPicker();

  const finishUser = () => {
    scene.removeCharacter(user);
    for (let i = 0; i < o.bots.length; i++) {
      const above = o.botsAbove[i];
      let s = above ? total + scene.rng.int(2, 8) : total - scene.rng.int(2, 9);
      s = clamp(s, 50, 100);
      if (above && s <= total) s = total;
      botScores.push(s);
    }
    startMontage(0);
  };
  const startMontage = (i: number) => {
    if (i >= o.bots.length) {
      state = 'done';
      scene.prompt.textContent = 'FINAL STANDINGS';
      setTimeout(() => {
        scene.destroy();
        o.onFinish({ userScore: total, botScores, unit: 'PTS' });
      }, 1200);
      return;
    }
    state = 'montage';
    const b = o.bots[i];
    const c = scene.addCharacter(b.def, b.team, start.x, start.z);
    scene.faceRim(c);
    c.setState('dribble');
    scene.holdBall(c);
    montage = { i, char: c, t: 0, phase: 'run' };
    scene.prompt.textContent = `${b.def.name.toUpperCase()} · ${b.team.abbr}`;
    scene.sub.textContent = scene.rng.pick(DUNKS).name.toUpperCase();
    scene.big.textContent = '';
  };

  return {
    el: h('div'),
    update(dt) {
      scene.update(dt);
      const s = app.input.state;
      switch (state) {
        case 'pick':
          user.update(dt, 0);
          scene.holdBall(user);
          break;
        case 'approach': {
          t += dt;
          const u = Math.min(1, t / approachDur);
          user.root.position.lerpVectors(start, takeoff, u);
          user.update(dt, 0.9);
          scene.holdBall(user);
          // Ring closes toward the inner circle; ideal press at u = 1.
          const scale = 1 + (1 - u) * 2.2;
          (ring.querySelector('.timing-outer') as HTMLElement).style.transform = `translate(-50%,-50%) scale(${scale})`;
          if (s.pressed.a && !pressedTakeoff) {
            pressedTakeoff = true;
            takeoffAcc = clamp(1 - Math.abs(u - 1) / window(), 0, 1);
            scene.prompt.textContent = takeoffAcc > 0.85 ? 'PERFECT TAKEOFF' : takeoffAcc > 0.5 ? 'GOOD' : 'EARLY';
          }
          if (u >= 1 || (pressedTakeoff && u > 0.75)) {
            if (!pressedTakeoff) takeoffAcc = 0;
            state = 'air';
            t = 0;
            user.setState('dunk');
            audio.sneaker();
            scene.prompt.textContent = 'PRESS SHOOT AT THE TOP · SLAM';
            app.touch.setLabels({ a: 'SLAM', b: '', x: '', y: '' });
          }
          break;
        }
        case 'air': {
          t += dt;
          const dur = 1.1;
          const u = Math.min(1, t / dur);
          // drift toward the rim during flight
          const r = scene.rim();
          user.root.position.x += (r.x - scene.side * 0.4 - user.root.position.x) * dt * 2.5;
          user.root.position.z += (0 - user.root.position.z) * dt * 2.5;
          if (dunk.name === '360') user.root.rotation.y += dt * (Math.PI * 2) / dur;
          user.update(dt, 0);
          const apex = 0.45;
          const scale = 1 + Math.abs(u - apex) * 3.5;
          (ring.querySelector('.timing-outer') as HTMLElement).style.transform = `translate(-50%,-50%) scale(${scale})`;
          if (s.pressed.a && !pressedSlam && u < 0.8) {
            pressedSlam = true;
            slamAcc = clamp(1 - Math.abs(u - apex) / window(), 0, 1);
          }
          if (u < apex + 0.05) scene.holdBall(user);
          if (u >= apex + 0.05 && scene.ball.mode === 'held') {
            if (!pressedSlam) slamAcc = 0;
            const exec = takeoffAcc * 0.5 + slamAcc * 0.5;
            const missed = exec < 0.3;
            // Ball through the rim (or off it).
            scene.ball.place(r.x - scene.side * 0.05, RIM_H + 0.3, 0);
            scene.ball.mode = 'shot';
            scene.ball.shot = { side: scene.side, willMake: !missed, shooterTeam: 0, shooterIndex: 0, value: 2, releasedAt: scene.time, scored: false, touchedRim: false };
            scene.ball.vel.set(missed ? -scene.side * 2.5 : 0, missed ? 1.5 : -4, missed ? scene.rng.float(-2, 2) : 0);
            const scores = judge(exec, missed);
            const sum = scores.reduce((a, b) => a + b, 0);
            total += sum;
            scene.big.textContent = scores.join(' · ');
            scene.prompt.textContent = missed ? 'MISSED THE DUNK' : exec > 0.85 ? 'POSTERIZED!' : exec > 0.6 ? 'CLEAN FINISH' : 'A LITTLE SLOPPY';
            scene.sub.textContent = `${sum} / 50 · TOTAL ${total}`;
            if (!missed) {
              audio.cheer(exec);
              app.camera.shake = 0.3;
            } else audio.rim();
            ring.style.display = 'none';
            state = 'result';
            t = 0;
          }
          break;
        }
        case 'result': {
          t += dt;
          user.update(dt, 0);
          scene.stepBall(dt);
          if (t > 2.6) {
            attempt++;
            if (attempt >= ATTEMPTS) finishUser();
            else {
              state = 'pick';
              scene.ball.mode = 'held';
              showPicker();
            }
          }
          break;
        }
        case 'montage': {
          if (!montage) break;
          const m = montage;
          m.t += dt;
          const c = m.char;
          if (m.phase === 'run') {
            const u = Math.min(1, m.t / 1.2);
            c.root.position.lerpVectors(start, takeoff, u);
            c.update(dt, 0.9);
            scene.holdBall(c);
            if (u >= 1) {
              m.phase = 'air';
              m.t = 0;
              c.setState('dunk');
            }
          } else if (m.phase === 'air') {
            const r = scene.rim();
            c.root.position.x += (r.x - scene.side * 0.4 - c.root.position.x) * dt * 2.5;
            c.root.position.z += -c.root.position.z * dt * 2.5;
            c.update(dt, 0);
            if (m.t < 0.5) scene.holdBall(c);
            else if (scene.ball.mode === 'held') {
              scene.ball.place(r.x - scene.side * 0.05, RIM_H + 0.3, 0);
              scene.ball.mode = 'shot';
              scene.ball.shot = { side: scene.side, willMake: true, shooterTeam: 0, shooterIndex: 0, value: 2, releasedAt: scene.time, scored: false, touchedRim: false };
              scene.ball.vel.set(0, -4, 0);
              audio.cheer(0.7);
            }
            scene.stepBall(dt);
            if (m.t > 1.3) {
              m.phase = 'score';
              m.t = 0;
              const target = botScores[m.i];
              const first = clamp(Math.round(target / 2) + scene.rng.int(-3, 3), 25, 50);
              scene.big.textContent = `${first} + ${target - first} = ${target}`;
              scene.sub.textContent = `TOTAL ${target}`;
            }
          } else {
            scene.stepBall(dt);
            c.update(dt, 0);
            if (m.t > 2.2) {
              scene.removeCharacter(c);
              montage = null;
              scene.ball.mode = 'held';
              startMontage(m.i + 1);
            }
          }
          break;
        }
      }
    },
    destroy() {
      scene.destroy();
    },
  };
}
