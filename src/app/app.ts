import * as THREE from 'three';
import { Renderer } from '../engine/renderer.ts';
import { Input, TouchControls } from '../engine/input.ts';
import { CameraRig } from '../engine/camera.ts';
import { Match } from '../match/match.ts';
import { TEAMS, type TeamDef } from '../data/teams.ts';
import { Arena } from '../engine/arena.ts';
import { Character } from '../engine/character.ts';
import { store } from './store.ts';
import { audio } from '../engine/audio.ts';
import { Rng } from '../core/rng.ts';
import { MenuNav } from '../ui/nav.ts';

export interface Screen {
  el: HTMLElement;
  update?(dt: number, t: number): void;
  destroy?(): void;
  /** Whether the 3D reel keeps playing in the background. */
  keepReel?: boolean;
}

/** Idle roster showcase shown on the team-select screens. */
class Showcase {
  readonly group = new THREE.Group();
  private chars: Character[] = [];
  private arena: Arena | null = null;
  private team: TeamDef | null = null;
  /** Landscape layouts push the roster to the right so the UI grid stays readable. */
  get offsetX() {
    return window.innerWidth > window.innerHeight ? 3.2 : 0;
  }

  constructor(private scene: THREE.Scene, private mobile: boolean) {}

  setTeam(team: TeamDef) {
    if (this.team === team) return;
    this.clear();
    this.team = team;
    this.arena = new Arena({ homeTeam: team, mobile: this.mobile });
    this.group.add(this.arena.group);
    const rng = new Rng(`showcase:${team.id}`);
    team.roster.slice(0, 5).forEach((p, i) => {
      const c = new Character(p, team.kits.away, { lowDetail: this.mobile });
      c.root.position.set((i - 2) * 1.45 + this.offsetX, 0, Math.abs(i - 2) * -0.6);
      c.root.rotation.y = (i - 2) * -0.18;
      c.setState(i === 2 ? 'idleBall' : rng.chance(0.5) ? 'idle' : 'defense');
      c.stateTime = rng.float(0, 3);
      this.chars.push(c);
      this.group.add(c.root);
    });
    this.scene.add(this.group);
  }

  update(dt: number, t: number) {
    for (const [i, c] of this.chars.entries()) {
      // Rotate idle variations occasionally.
      if (Math.floor(t / 4 + i) !== Math.floor((t - dt) / 4 + i)) {
        const states = ['idle', 'idleBall', 'defense', 'celebrate', 'dribble'] as const;
        c.setState(states[(Math.floor(t / 4) + i) % states.length]);
      }
      c.update(dt, c.state === 'dribble' ? 0.15 : 0);
    }
    this.arena?.update(t);
  }

  clear() {
    this.scene.remove(this.group);
    this.group.clear();
    for (const c of this.chars) c.dispose();
    this.chars = [];
    this.arena = null;
    this.team = null;
  }
}

export class App {
  readonly renderer: Renderer;
  readonly input = new Input();
  readonly camera: CameraRig;
  readonly touch: TouchControls;
  readonly ui: HTMLElement;
  readonly overlay: HTMLElement;
  readonly reelOverlay: HTMLElement;
  readonly nav: MenuNav;
  current: Screen | null = null;
  private reel: Match | null = null;
  private showcase: Showcase;
  private mode: 'reel' | 'showcase' | 'game' | 'none' = 'none';
  readonly debug = new URLSearchParams(location.search).has('debug');
  /** Test hooks: ?speed=N runs N sim steps per frame, ?autopilot=ai|stall drives the controlled player. */
  readonly timeScale = Math.max(1, Math.min(40, Number(new URLSearchParams(location.search).get('speed') ?? 1) || 1));
  readonly autopilot = (new URLSearchParams(location.search).get('autopilot') as 'ai' | 'stall' | null) ?? null;

  constructor() {
    const canvas = document.getElementById('gl') as HTMLCanvasElement;
    this.renderer = new Renderer(canvas);
    this.camera = new CameraRig(this.renderer.camera);
    this.ui = document.getElementById('ui')!;
    this.overlay = document.getElementById('overlay')!;
    this.reelOverlay = document.getElementById('reel-overlay')!;
    this.touch = new TouchControls(this.input, this.overlay);
    this.touch.setVisible(false);
    this.nav = new MenuNav(this.input);
    this.showcase = new Showcase(this.renderer.scene, this.renderer.mobile);
    audio.setEnabled(store.data.settings.sound);
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    this.renderer.onFrame = (dt, t) => this.frame(dt, t);
    this.renderer.start();
  }

  get mobile() {
    return this.renderer.mobile;
  }

  show(screen: Screen) {
    if (this.current) {
      this.current.destroy?.();
      this.current.el.remove();
    }
    this.current = screen;
    this.ui.appendChild(screen.el);
    this.ui.scrollTop = 0;
    if (screen.keepReel) this.startReel();
  }

  /** Background highlight reel: two random teams, all bots, cinematic camera, CSS film filter. */
  startReel() {
    if (this.mode === 'reel') return;
    this.stopScene();
    const rng = new Rng(`reel:${Date.now()}`);
    const a = rng.pick(TEAMS);
    let b = rng.pick(TEAMS);
    while (b === a) b = rng.pick(TEAMS);
    this.reel = new Match({
      teams: [a, b],
      script: null,
      quarterLength: 600,
      userControlled: false,
      homeIndex: 0,
      scene: this.renderer.scene,
      camera: this.camera,
      input: this.input,
      mobile: this.mobile,
      reel: true,
      seed: `reel:${Date.now()}`,
    });
    this.camera.mode = 'cinematic';
    this.camera.attackDir = 1;
    this.camera.snap();
    this.reelOverlay.classList.add('show');
    this.mode = 'reel';
  }

  showTeam(team: TeamDef) {
    if (this.mode !== 'showcase') {
      this.stopScene();
      this.mode = 'showcase';
      this.camera.mode = 'showcase';
    }
    this.showcase.setTeam(team);
    this.reelOverlay.classList.remove('show');
  }

  /** Hand the scene over to a game screen (which manages its own Match). */
  takeScene() {
    this.stopScene();
    this.mode = 'game';
    this.reelOverlay.classList.remove('show');
  }

  private stopScene() {
    if (this.reel) {
      this.reel.dispose();
      this.reel = null;
    }
    this.showcase.clear();
    this.reelOverlay.classList.remove('show');
    this.mode = 'none';
  }

  private frame(dt: number, t: number) {
    this.input.poll(dt);
    this.nav.update();
    if (this.mode === 'reel' && this.reel) {
      this.reel.update(dt);
      this.reel.takeEvents();
      if (this.reel.finished || this.reel.period > 2) {
        this.stopScene();
        this.startReel();
      }
    } else if (this.mode === 'showcase') {
      this.showcase.update(dt, t);
      this.camera.update(dt, new THREE.Vector3(this.showcase.offsetX, 0, 0), t);
    }
    this.current?.update?.(dt, t);
  }
}

export function h(tag: string, attrs: Record<string, string> = {}, ...children: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) (el as any)[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}
