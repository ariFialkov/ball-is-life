import * as THREE from 'three';
import type { App, Screen } from '../app/app.ts';
import { h } from '../app/app.ts';
import type { PlayerDef, TeamDef } from '../data/teams.ts';
import { ContestScene, ReleaseMeter } from './base.ts';
import type { ContestResult } from './three.ts';
import { RIM_X } from '../engine/constants.ts';
import { audio } from '../engine/audio.ts';
import { clamp } from '../core/rng.ts';

interface Opts {
  team: TeamDef;
  player: PlayerDef;
  bots: { def: PlayerDef; team: TeamDef }[];
  botsAbove: boolean[];
  strip: string;
  seed: string;
  onFinish: (r: ContestResult) => void;
}

/**
 * Skills challenge: dribble the slalom, hit the passing target, finish the
 * layup, then knock down a three. Fastest time wins.
 */
export function skillsContest(app: App, o: Opts): Screen {
  const scene = new ContestScene(app, o.team, o.strip, o.seed);
  const user = scene.addCharacter(o.player, o.team, 0, 0);
  const side = scene.side;
  const gates = [
    new THREE.Vector3(side * -9, 0, 2.2),
    new THREE.Vector3(side * -5, 0, -2.2),
    new THREE.Vector3(side * -1, 0, 2.2),
  ];
  const passSpot = new THREE.Vector3(side * 3, 0, -3.5);
  const passTarget = new THREE.Vector3(side * 10.5, 1.4, -5.5);
  const threeSpot = new THREE.Vector3(side * (RIM_X - 7.6), 0, 0);
  const startPos = new THREE.Vector3(side * -12.5, 0, 0);
  user.root.position.copy(startPos);
  user.root.rotation.y = Math.atan2(side, 0);
  user.setState('idleBall');
  scene.holdBall(user);
  // Markers.
  const markerMat = new THREE.MeshStandardMaterial({ color: o.team.colors.primary, emissive: new THREE.Color(o.team.colors.primary), emissiveIntensity: 0.5 });
  const cones: THREE.Mesh[] = [];
  for (const g of gates) {
    for (const dz of [-1.1, 1.1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 10), markerMat);
      cone.position.set(g.x, 0.25, g.z + dz);
      scene.group.add(cone);
      cones.push(cone);
    }
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x38ff7a, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  const passRing = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 24), ringMat);
  passRing.position.copy(passTarget);
  passRing.rotation.y = Math.PI / 2;
  scene.group.add(passRing);
  const spotRing = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 24), ringMat.clone());
  spotRing.rotation.x = -Math.PI / 2;
  spotRing.position.set(passSpot.x, 0.02, passSpot.z);
  scene.group.add(spotRing);
  const threeRing = spotRing.clone();
  threeRing.position.set(threeSpot.x, 0.02, threeSpot.z);
  scene.group.add(threeRing);

  type Stage = 'ready' | 'slalom' | 'pass' | 'passFlight' | 'layup' | 'layupFlight' | 'three' | 'threeFlight' | 'montage' | 'done';
  let stage: Stage = 'ready';
  let gate = 0;
  let timer = 0;
  let sweep = 0;
  let penalty = 0;
  const meter = new ReleaseMeter();
  const vel = new THREE.Vector3();
  const botTimes: number[] = [];
  let montageT = 0;
  let montageIdx = 0;
  scene.big.textContent = '0.0';
  scene.prompt.textContent = 'DRIBBLE THROUGH THE GATES · MOVE TO START';
  scene.sub.textContent = 'STAGE 1 / 4 · SLALOM';
  app.touch.setLabels({ a: 'SHOOT', b: 'PASS', x: 'SPRINT', y: '' });
  spotRing.visible = false;
  threeRing.visible = false;
  passRing.visible = false;

  const move = (dt: number, speedMax: number) => {
    const s = app.input.state;
    const dir = app.camera.moveToWorld(s.move.x, s.move.y, new THREE.Vector3());
    const mag = Math.min(1, Math.hypot(s.move.x, s.move.y));
    const speed = speedMax * mag * (s.sprint ? 1.25 : 1);
    vel.lerp(dir.multiplyScalar(speed), Math.min(1, dt * 10));
    user.root.position.addScaledVector(vel, dt);
    user.root.position.x = clamp(user.root.position.x, -14, 14);
    user.root.position.z = clamp(user.root.position.z, -7.5, 7.5);
    if (mag > 0.05) user.root.rotation.y = Math.atan2(dir.x, dir.z);
    user.setState(vel.length() > 0.5 ? 'dribble' : 'idleBall');
    user.update(dt, clamp(vel.length() / 6.5, 0, 1));
    scene.holdBall(user);
    return mag;
  };
  const finishUser = () => {
    const final = timer + penalty;
    scene.removeCharacter(user);
    for (let i = 0; i < o.bots.length; i++) {
      const above = o.botsAbove[i];
      let tt = above ? final - scene.rng.float(0.8, 6) : final + scene.rng.float(1.5, 9);
      tt = Math.max(14, tt);
      if (above && tt >= final) tt = final; // ties go to the user
      botTimes.push(Math.round(tt * 10) / 10);
    }
    stage = 'montage';
    montageIdx = 0;
    montageT = 0;
    scene.prompt.textContent = `${o.bots[0].def.name.toUpperCase()} RUNS THE COURSE`;
  };

  return {
    el: h('div'),
    update(dt) {
      scene.update(dt);
      const s = app.input.state;
      if (stage !== 'ready' && stage !== 'montage' && stage !== 'done') {
        timer += dt;
        scene.big.textContent = (timer + penalty).toFixed(1);
      }
      switch (stage) {
        case 'ready': {
          const mag = move(dt, 6.2);
          if (mag > 0.1) {
            stage = 'slalom';
            scene.prompt.textContent = 'THROUGH THE GATES';
          }
          break;
        }
        case 'slalom': {
          move(dt, 6.2);
          const g = gates[gate];
          cones[gate * 2].material = cones[gate * 2 + 1].material = new THREE.MeshStandardMaterial({ color: 0x38ff7a, emissive: 0x38ff7a, emissiveIntensity: 0.8 });
          if (Math.abs(user.root.position.x - g.x) < 0.5 && Math.abs(user.root.position.z - g.z) < 1.1) {
            gate++;
            audio.click();
            if (gate >= gates.length) {
              stage = 'pass';
              spotRing.visible = true;
              passRing.visible = true;
              scene.prompt.textContent = 'GET TO THE SPOT, THEN PRESS PASS IN THE GREEN';
              scene.sub.textContent = 'STAGE 2 / 4 · PASSING';
            }
          }
          break;
        }
        case 'pass': {
          move(dt, 6.2);
          const onSpot = Math.hypot(user.root.position.x - passSpot.x, user.root.position.z - passSpot.z) < 1.0;
          if (onSpot) {
            sweep += dt;
            const t01 = (Math.sin(sweep * 4.5) + 1) / 2;
            scene.setMeter(t01);
            if (s.pressed.b) {
              const q = 1 - Math.abs(t01 - 0.565) / 0.12;
              scene.setMeter(null);
              user.setState('pass');
              const ok = q > 0;
              scene.ball.mode = 'pass';
              const from = user.root.position;
              scene.ball.place(from.x, 1.3, from.z);
              const tgt = passTarget.clone();
              if (!ok) tgt.z += scene.rng.float(-1.5, 1.5) + (scene.rng.chance(0.5) ? 1.2 : -1.2);
              scene.ball.launchTo(tgt, 0.6);
              stage = 'passFlight';
              sweep = 0;
              (stage as Stage) === 'passFlight' && (scene.prompt.textContent = ok ? 'ON TARGET!' : 'OFF TARGET · +2s');
              if (!ok) penalty += 2;
            }
          } else scene.setMeter(null);
          break;
        }
        case 'passFlight': {
          user.update(dt, 0);
          scene.ball.step(dt, scene.time);
          sweep += dt;
          const hit = scene.ball.pos.distanceTo(passTarget) < 0.65;
          if (hit || sweep > 1.2) {
            if (hit) {
              audio.cheer(0.4);
              stage = 'layup';
              scene.prompt.textContent = 'DRIVE AND PRESS SHOOT AT THE RIM';
              scene.sub.textContent = 'STAGE 3 / 4 · LAYUP';
              passRing.visible = false;
              spotRing.visible = false;
            } else {
              stage = 'pass';
              scene.prompt.textContent = 'TRY AGAIN · PRESS PASS IN THE GREEN';
            }
            scene.ball.mode = 'held';
            user.setState('idleBall');
            scene.holdBall(user);
          }
          break;
        }
        case 'layup': {
          move(dt, 6.2);
          const r = scene.rim();
          const d = Math.hypot(user.root.position.x - r.x, user.root.position.z - r.z);
          if (s.pressed.a && d < 2.8) {
            user.setState('layup');
            scene.faceRim(user);
            vel.set((r.x - user.root.position.x) / 0.6, 0, (r.z - user.root.position.z) / 0.6);
            stage = 'layupFlight';
            sweep = 0;
          }
          break;
        }
        case 'layupFlight': {
          sweep += dt;
          if (sweep < 0.5) {
            user.root.position.addScaledVector(vel, dt);
            scene.holdBall(user);
          } else if (scene.ball.mode === 'held') {
            scene.launchShot(user, scene.rng.chance(0.92), 2);
            // short flight for a layup
            const r = scene.rim();
            scene.ball.launchTo(new THREE.Vector3(r.x, r.y + 0.1, 0), 0.5);
          }
          user.update(dt, 0);
          const res = scene.ball.mode === 'shot' ? scene.stepBall(dt) : null;
          if (res) {
            if (res === 'score') {
              audio.cheer(0.4);
              stage = 'three';
              threeRing.visible = true;
              scene.prompt.textContent = 'GET TO THE TOP OF THE KEY · HOLD SHOOT, RELEASE IN THE GREEN';
              scene.sub.textContent = 'STAGE 4 / 4 · THREE-POINTER';
            } else {
              stage = 'layup';
              penalty += 1;
              scene.prompt.textContent = 'MISSED · TRY AGAIN';
            }
            scene.ball.mode = 'held';
            user.setState('idleBall');
            scene.holdBall(user);
          }
          break;
        }
        case 'three': {
          const onSpot = Math.hypot(user.root.position.x - threeSpot.x, user.root.position.z - threeSpot.z) < 1.0;
          if (!meter.active) move(dt, 6.2);
          meter.update(dt);
          if (onSpot && s.pressed.a && !meter.active) {
            meter.start();
            user.setState('shoot');
            scene.faceRim(user);
          }
          if (meter.active) {
            scene.setMeter(meter.t01);
            user.update(dt, 0);
            scene.holdBall(user);
            if (s.released.a || meter.t01 > 1.1) {
              const q = meter.release();
              scene.setMeter(null);
              const willMake = scene.rng.chance(0.12 + 0.8 * Math.pow(q, 1.6));
              scene.launchShot(user, willMake, 3);
              stage = 'threeFlight';
              scene.prompt.textContent = q > 0.9 ? 'GREEN!' : q > 0.65 ? 'GOOD RELEASE' : 'OFF';
            }
          }
          break;
        }
        case 'threeFlight': {
          user.update(dt, 0);
          const res = scene.stepBall(dt);
          if (res) {
            if (res === 'score') {
              audio.cheer(0.8);
              scene.prompt.textContent = `FINISHED IN ${(timer + penalty).toFixed(1)}s`;
              stage = 'done';
              setTimeout(() => finishUser(), 1500);
            } else {
              stage = 'three';
              penalty += 1;
              scene.prompt.textContent = 'MISSED · +1s · AGAIN';
              scene.ball.mode = 'held';
              user.setState('idleBall');
              scene.holdBall(user);
            }
          }
          break;
        }
        case 'montage': {
          montageT += dt;
          const b = o.bots[montageIdx];
          const target = botTimes[montageIdx];
          scene.big.textContent = Math.min(target, montageT * (target / 2.2)).toFixed(1);
          scene.sub.textContent = `${b.team.abbr} · ${target.toFixed(1)}s`;
          if (montageT > 2.8) {
            montageIdx++;
            montageT = 0;
            if (montageIdx >= o.bots.length) {
              stage = 'done';
              scene.prompt.textContent = 'FINAL STANDINGS';
              setTimeout(() => {
                scene.destroy();
                o.onFinish({ userScore: Math.round((timer + penalty) * 10) / 10, botScores: botTimes, unit: 's' });
              }, 1000);
            } else scene.prompt.textContent = `${o.bots[montageIdx].def.name.toUpperCase()} RUNS THE COURSE`;
          }
          break;
        }
        case 'done':
          break;
      }
    },
    destroy() {
      scene.destroy();
    },
  };
}
