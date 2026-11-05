import type { App, Screen } from '../app/app.ts';
import { h } from '../app/app.ts';
import type { PlayerDef, TeamDef } from '../data/teams.ts';
import { ContestScene, ReleaseMeter } from './base.ts';
import type { Character } from '../engine/character.ts';
import { RIM_X, THREE_R } from '../engine/constants.ts';
import { audio } from '../engine/audio.ts';
import { clamp } from '../core/rng.ts';

export interface ContestResult {
  userScore: number;
  botScores: number[];
  /** display unit */
  unit: string;
}

interface Opts {
  team: TeamDef;
  player: PlayerDef;
  bots: { def: PlayerDef; team: TeamDef }[];
  botsAbove: boolean[];
  strip: string;
  seed: string;
  onFinish: (r: ContestResult) => void;
}

const RACK_ANGLES = [-72, -36, 0, 36, 72];
const BALLS_PER_RACK = 5;
const TIME_LIMIT = 60;

/** Three-point contest: five racks, 25 balls, 60 seconds, money balls worth 2. */
export function threePointContest(app: App, o: Opts): Screen {
  const scene = new ContestScene(app, o.team, o.strip, o.seed);
  const user = scene.addCharacter(o.player, o.team, 0, 0);
  const meter = new ReleaseMeter();
  let rack = 0;
  let ball = 0;
  let score = 0;
  let timer = TIME_LIMIT;
  let state: 'ready' | 'shooting' | 'flight' | 'moving' | 'done' | 'montage' = 'ready';
  let moveT = 0;
  const rackPos = (i: number) => {
    const a = (RACK_ANGLES[i] * Math.PI) / 180;
    const r = THREE_R + 0.35;
    return { x: scene.side * (RIM_X - Math.cos(a) * r), z: Math.sin(a) * r };
  };
  const placeAt = (i: number) => {
    const p = rackPos(i);
    user.root.position.set(p.x, 0, p.z);
    scene.faceRim(user);
  };
  placeAt(0);
  user.setState('idleBall');
  scene.holdBall(user);
  scene.big.textContent = '0';
  scene.prompt.textContent = 'HOLD SHOOT, RELEASE IN THE GREEN';
  scene.sub.textContent = `RACK 1 · BALL 1 · ${TIME_LIMIT}s`;
  app.touch.setLabels({ a: 'SHOOT', b: '', x: '', y: '' });
  let montage: { bot: number; shot: number; char: Character; scores: number[]; makes: boolean[]; shown: number } | null = null;
  const botScores: number[] = [];

  const finishUser = () => {
    state = 'montage';
    scene.removeCharacter(user);
    // Bot scores relative to the user's, per the ticket.
    for (let i = 0; i < o.bots.length; i++) {
      const above = o.botsAbove[i];
      let s = above ? score + scene.rng.int(1, 4) : score - scene.rng.int(1, 5);
      s = clamp(s, 0, 30);
      if (above && s <= score) s = score; // cannot beat a perfect round: a tie goes to the user
      botScores.push(s);
    }
    startBotMontage(0);
  };
  const startBotMontage = (i: number) => {
    if (i >= o.bots.length) {
      state = 'done';
      scene.prompt.textContent = 'FINAL STANDINGS';
      setTimeout(() => {
        scene.destroy();
        o.onFinish({ userScore: score, botScores, unit: 'PTS' });
      }, 1200);
      return;
    }
    const b = o.bots[i];
    const char = scene.addCharacter(b.def, b.team, 0, 0);
    // Ten visible shots, scaled makes to reach the bot's final score.
    const makes: boolean[] = [];
    const target = botScores[i];
    const nMakes = Math.round((target / 30) * 10);
    for (let k = 0; k < 10; k++) makes.push(k < nMakes);
    scene.rng.shuffle(makes);
    montage = { bot: i, shot: 0, char, scores: [], makes, shown: 0 };
    scene.big.textContent = '0';
    scene.prompt.textContent = `${b.def.name.toUpperCase()} · ${b.team.abbr}`;
    scene.sub.textContent = 'HIGHLIGHTS';
    char.setState('idleBall');
    const p = rackPos(0);
    char.root.position.set(p.x, 0, p.z);
    scene.faceRim(char);
    scene.holdBall(char);
    montageTimer = 0.6;
  };
  let montageTimer = 0;

  return {
    el: h('div'),
    update(dt) {
      scene.update(dt);
      const s = app.input.state;
      if (state === 'ready' || state === 'shooting' || state === 'flight' || state === 'moving') {
        if (state !== 'ready') timer -= dt;
        if (timer <= 0 && state !== 'flight') {
          audio.buzzer();
          timer = 0;
          scene.sub.textContent = 'TIME!';
          finishUser();
          return;
        }
      }
      switch (state) {
        case 'ready':
        case 'shooting': {
          meter.update(dt);
          if (s.pressed.a && !meter.active) {
            if (state === 'ready') state = 'shooting';
            meter.start();
            user.setState('shoot');
            audio.click();
          }
          scene.setMeter(meter.active ? meter.t01 : null);
          if (meter.active && (s.released.a || meter.t01 > 1.1)) {
            const q = meter.release();
            scene.setMeter(null);
            const p = 0.12 + 0.8 * Math.pow(q, 1.6);
            const willMake = scene.rng.chance(p);
            scene.launchShot(user, willMake, 3);
            state = 'flight';
            scene.prompt.textContent = q > 0.9 ? 'GREEN!' : q > 0.65 ? 'GOOD RELEASE' : q > 0.4 ? 'SLIGHTLY OFF' : 'WAY OFF';
            scene.prompt.style.color = q > 0.9 ? '#38ff7a' : q > 0.65 ? '#ffd166' : '#ff6b6b';
          }
          if (meter.active) {
            // keep the ball in the hands while loading
            scene.holdBall(user);
          } else scene.holdBall(user);
          user.update(dt, 0);
          break;
        }
        case 'flight': {
          user.update(dt, 0);
          const r = scene.stepBall(dt);
          if (r) {
            const money = ball === BALLS_PER_RACK - 1;
            if (r === 'score') {
              score += money ? 2 : 1;
              scene.big.textContent = String(score);
              audio.cheer(money ? 0.8 : 0.4);
            }
            ball++;
            if (ball >= BALLS_PER_RACK) {
              ball = 0;
              rack++;
              if (rack >= RACK_ANGLES.length) {
                finishUser();
                return;
              }
              state = 'moving';
              moveT = 0;
            } else state = 'shooting';
            user.setState('idleBall');
            scene.prompt.textContent = money && state !== 'moving' ? 'MONEY BALL · 2 PTS' : 'HOLD SHOOT, RELEASE IN THE GREEN';
            scene.prompt.style.color = money && state !== 'moving' ? '#ffd166' : '';
            scene.sub.textContent = `RACK ${rack + 1} · BALL ${ball + 1} · ${Math.ceil(timer)}s`;
          }
          break;
        }
        case 'moving': {
          moveT += dt;
          const from = rackPos(rack - 1);
          const to = rackPos(rack);
          const u = Math.min(1, moveT / 0.9);
          user.root.position.set(from.x + (to.x - from.x) * u, 0, from.z + (to.z - from.z) * u);
          user.root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
          user.setState('dribble');
          user.update(dt, 0.7);
          scene.holdBall(user);
          if (u >= 1) {
            placeAt(rack);
            user.setState('idleBall');
            state = 'shooting';
            scene.prompt.textContent = 'HOLD SHOOT, RELEASE IN THE GREEN';
            scene.prompt.style.color = '';
          }
          break;
        }
        case 'montage': {
          if (!montage) break;
          const m = montage;
          const c = m.char;
          montageTimer -= dt;
          const r = scene.stepBall(dt);
          c.update(dt, 0);
          if (scene.ball.mode !== 'shot') scene.holdBall(c);
          if (r) {
            if (r === 'score') m.shown += 1;
            m.shot++;
            const target = botScores[m.bot];
            scene.big.textContent = String(Math.min(target, Math.round((m.shot / 10) * target)));
            c.setState('idleBall');
            const p = rackPos(Math.min(4, Math.floor(m.shot / 2)));
            c.root.position.set(p.x, 0, p.z);
            scene.faceRim(c);
            montageTimer = 0.45;
            if (m.shot >= 10) {
              scene.big.textContent = String(target);
              montageTimer = 1.2;
              m.shot = 99;
            }
          }
          if (montageTimer <= 0 && scene.ball.mode !== 'shot') {
            if (m.shot >= 99) {
              scene.removeCharacter(c);
              montage = null;
              startBotMontage(m.bot + 1);
            } else {
              c.setState('shoot');
              montageTimer = 0.4;
              setTimeout(() => {
                if (montage === m) scene.launchShot(c, m.makes[m.shot] ?? false, 3);
              }, 380);
            }
          }
          break;
        }
      }
      scene.sub.textContent = state === 'montage' || state === 'done' ? scene.sub.textContent : `RACK ${rack + 1} · BALL ${ball + 1} · ${Math.ceil(timer)}s`;
    },
    destroy() {
      scene.destroy();
    },
  };
}
