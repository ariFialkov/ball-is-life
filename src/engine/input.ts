/**
 * Unified input: keyboard + mouse, touch (virtual joystick, buttons and a
 * swipe pad) and gamepad (PS5 / Xbox via the standard Gamepad API mapping).
 *
 * Virtual buttons are named after their position on a controller and follow
 * the NBA 2K defaults:
 *
 *   a = Square / X   (left face)    Offense: shoot          Defense: steal
 *   b = Cross / A    (bottom face)  Offense: pass           Defense: switch player
 *   x = Circle / B   (right face)   Offense: bounce pass
 *   y = Triangle / Y (top face)     Offense: lob pass       Defense: block / rebound
 *   sprint = R2 / RT
 *   pick = L1 / LB / F   With the ball: call a screen. Off the ball, standing still: set one.
 *
 * Dribble moves come from the "skill stick": the right stick on a controller,
 * the arrow keys on a keyboard, and a swipe on the right side of a touch screen.
 * All three produce the same `flick` event (a screen-space direction).
 *
 * Menus read `nav` (D-pad / left stick / arrow keys, Cross or A or Enter to
 * select, Circle or B or Escape to go back), with auto-repeat on directions.
 */
export type Action = 'a' | 'b' | 'x' | 'y' | 'sprint' | 'pick' | 'pause' | 'confirm' | 'back';
export type Device = 'keyboard' | 'mouse' | 'gamepad' | 'touch';

export interface NavState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
}

export interface InputState {
  /** Movement vector in screen-space (x right, y up), magnitude <= 1. */
  move: { x: number; y: number };
  sprint: boolean;
  held: Record<Action, boolean>;
  pressed: Record<Action, boolean>;
  released: Record<Action, boolean>;
  /** Skill-stick flick this frame (screen-space unit vector), from the right stick, arrow keys or a swipe. */
  flick: { x: number; y: number } | null;
  /** Menu navigation events this frame (directions auto-repeat while held). */
  nav: NavState;
  gamepadConnected: boolean;
  gamepadType: 'ps' | 'xbox' | 'generic' | null;
  usingTouch: boolean;
  lastDevice: Device;
}

type Dir = 'left' | 'right' | 'up' | 'down';

const KEYMAP: Record<string, Action | Dir> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'a',
  KeyJ: 'a',
  KeyE: 'b',
  KeyK: 'b',
  KeyQ: 'x',
  KeyL: 'x',
  KeyR: 'y',
  KeyI: 'y',
  KeyF: 'pick',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Escape: 'pause',
  KeyP: 'pause',
  Enter: 'confirm',
  Backspace: 'back',
};

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

const ACTIONS: Action[] = ['a', 'b', 'x', 'y', 'sprint', 'pick', 'pause', 'confirm', 'back'];

/** True while the user is typing into a text field (keyboard shortcuts stand down). */
export function isTyping(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(el.type);
}

export class Input {
  state: InputState = {
    move: { x: 0, y: 0 },
    sprint: false,
    held: emptyActions(),
    pressed: emptyActions(),
    released: emptyActions(),
    flick: null,
    nav: emptyNav(),
    gamepadConnected: false,
    gamepadType: null,
    usingTouch: false,
    lastDevice: 'mouse',
  };
  private keys = new Set<string>();
  /** Codes pressed since the last poll (edge events, so very short taps are not lost). */
  private keysDown = new Set<string>();
  private arrowOrder: string[] = [];
  private arrowFlickAt = 0;
  private prevHeld = emptyActions();
  private touchMove = { x: 0, y: 0 };
  private touchHeld = emptyActions();
  private touchFlick: { x: number; y: number } | null = null;
  private padPrev: boolean[] = [];
  private rightStickPrev = 0;
  private flickCooldown = 0;
  private navDirPrev: Dir | null = null;
  private navRepeat = 0;
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const typing = isTyping();
      if (typing && e.code !== 'Escape' && e.code !== 'Enter') return;
      this.state.lastDevice = 'keyboard';
      if (e.repeat) {
        if (e.code === 'Space' || e.code in ARROWS) e.preventDefault();
        return;
      }
      if (KEYMAP[e.code] || e.code in ARROWS) {
        this.keys.add(e.code);
        this.keysDown.add(e.code);
        if (e.code === 'Space' || e.code in ARROWS || e.code === 'Backspace') e.preventDefault();
      }
      if (e.code in ARROWS) {
        this.arrowOrder = this.arrowOrder.filter((c) => c !== e.code);
        this.arrowOrder.push(e.code);
        // Wait a beat so two arrows pressed together read as one diagonal flick.
        if (!this.arrowFlickAt) this.arrowFlickAt = performance.now() + 45;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code in ARROWS) this.arrowOrder = this.arrowOrder.filter((c) => c !== e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.arrowOrder = [];
    });
    window.addEventListener('mousemove', () => (this.state.lastDevice = 'mouse'), { passive: true });
    window.addEventListener(
      'pointerdown',
      (e) => {
        this.state.lastDevice = e.pointerType === 'touch' ? 'touch' : 'mouse';
      },
      { passive: true, capture: true },
    );
    window.addEventListener('gamepadconnected', () => (this.state.gamepadConnected = true));
    window.addEventListener('gamepaddisconnected', () => {
      this.state.gamepadConnected = false;
      this.state.gamepadType = null;
    });
  }

  /** Touch UI hooks. */
  setTouchMove(x: number, y: number) {
    this.touchMove.x = x;
    this.touchMove.y = y;
    this.state.usingTouch = true;
  }

  setTouchButton(action: Action, down: boolean) {
    this.touchHeld[action] = down;
    this.state.usingTouch = true;
  }

  setTouchFlick(x: number, y: number) {
    this.touchFlick = { x, y };
    this.state.usingTouch = true;
  }

  /** Must be called once per frame before reading state. */
  poll(dt: number) {
    const s = this.state;
    const held = emptyActions();
    const typing = isTyping();
    let mx = 0;
    let my = 0;
    // Keyboard.
    if (!typing) {
      for (const code of this.keys) {
        const a = KEYMAP[code];
        if (a === 'left') mx -= 1;
        else if (a === 'right') mx += 1;
        else if (a === 'up') my += 1;
        else if (a === 'down') my -= 1;
        else if (a) held[a] = true;
      }
    }
    // Touch.
    if (Math.abs(this.touchMove.x) + Math.abs(this.touchMove.y) > 0.01) {
      mx = this.touchMove.x;
      my = this.touchMove.y;
    }
    for (const a of ACTIONS) if (this.touchHeld[a]) held[a] = true;

    // Skill stick: arrow keys and swipes.
    s.flick = null;
    const now = performance.now();
    if (this.arrowFlickAt && now >= this.arrowFlickAt) {
      let fx = 0;
      let fy = 0;
      for (const c of this.arrowOrder) {
        fx += ARROWS[c][0];
        fy += ARROWS[c][1];
      }
      const len = Math.hypot(fx, fy);
      if (len > 0 && !typing) s.flick = { x: fx / len, y: fy / len };
      this.arrowFlickAt = 0;
    }
    if (this.touchFlick) {
      s.flick = this.touchFlick;
      this.touchFlick = null;
    }

    // Menu navigation sources.
    let navDir: Dir | null = null;
    const nav = emptyNav();
    if (!typing && this.arrowOrder.length) {
      const last = this.arrowOrder[this.arrowOrder.length - 1];
      navDir = last === 'ArrowUp' ? 'up' : last === 'ArrowDown' ? 'down' : last === 'ArrowLeft' ? 'left' : 'right';
    }
    if (this.keysDown.has('Enter')) nav.confirm = true;
    if (this.keysDown.has('Escape') || (!typing && this.keysDown.has('Backspace'))) nav.back = true;

    // Gamepad.
    this.flickCooldown = Math.max(0, this.flickCooldown - dt);
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) pad = p;
    if (pad) {
      s.gamepadConnected = true;
      const id = pad.id.toLowerCase();
      s.gamepadType = /054c|dualsense|dualshock|playstation|wireless controller/.test(id) ? 'ps' : /xbox|045e|xinput/.test(id) ? 'xbox' : 'generic';
      const b = (i: number) => !!pad!.buttons[i]?.pressed;
      const edge = (i: number) => b(i) && !this.padPrev[i];
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const dead = 0.18;
      const mag = Math.hypot(ax, ay);
      let padActive = false;
      if (mag > dead) {
        const scaled = Math.min(1, (mag - dead) / (1 - dead));
        mx = (ax / mag) * scaled;
        my = (-ay / mag) * scaled;
        padActive = true;
      }
      if (b(12)) my = 1;
      if (b(13)) my = -1;
      if (b(14)) mx = -1;
      if (b(15)) mx = 1;
      // 2K layout (standard mapping: 0 Cross/A, 1 Circle/B, 2 Square/X, 3 Triangle/Y).
      if (b(2)) held.a = true;
      if (b(0)) held.b = true;
      if (b(1)) held.x = true;
      if (b(3)) held.y = true;
      if (b(7) || (pad.buttons[7]?.value ?? 0) > 0.25) held.sprint = true;
      if (b(4)) held.pick = true; // L1 / LB: set or call a screen
      if (b(9)) held.pause = true;
      // Menu navigation: D-pad, left stick, Cross/A select, Circle/B back.
      if (b(12)) navDir = 'up';
      else if (b(13)) navDir = 'down';
      else if (b(14)) navDir = 'left';
      else if (b(15)) navDir = 'right';
      else if (Math.max(Math.abs(ax), Math.abs(ay)) > 0.6) navDir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : ay > 0 ? 'down' : 'up';
      if (edge(0)) nav.confirm = true;
      if (edge(1)) nav.back = true;
      // Skill stick flick: the right stick snapping out from rest.
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      const rmag = Math.hypot(rx, ry);
      if (rmag > 0.7 && this.rightStickPrev < 0.35 && this.flickCooldown <= 0) {
        s.flick = { x: rx / rmag, y: -ry / rmag };
        this.flickCooldown = 0.15;
      }
      this.rightStickPrev = rmag;
      for (let i = 0; i < pad.buttons.length; i++) {
        if (pad.buttons[i]?.pressed) padActive = true;
        this.padPrev[i] = !!pad.buttons[i]?.pressed;
      }
      if (rmag > 0.5) padActive = true;
      if (padActive) s.lastDevice = 'gamepad';
    }

    // Directional nav with auto-repeat.
    if (navDir) {
      if (navDir !== this.navDirPrev) {
        nav[navDir] = true;
        this.navRepeat = 0.38;
      } else {
        this.navRepeat -= dt;
        if (this.navRepeat <= 0) {
          nav[navDir] = true;
          this.navRepeat = 0.11;
        }
      }
    }
    this.navDirPrev = navDir;
    s.nav = nav;

    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    s.move.x = this.enabled ? mx : 0;
    s.move.y = this.enabled ? my : 0;
    for (const a of ACTIONS) {
      // Keyboard taps that start and end between two frames still count as a press.
      const tapped = !typing && [...this.keysDown].some((c) => KEYMAP[c] === a);
      const h = this.enabled && (held[a] || tapped);
      s.held[a] = this.enabled && held[a];
      s.pressed[a] = h && !this.prevHeld[a];
      s.released[a] = !s.held[a] && this.prevHeld[a];
      this.prevHeld[a] = s.held[a];
    }
    s.sprint = s.held.sprint;
    if (!this.enabled) s.flick = null;
    this.keysDown.clear();
  }

  consume(action: Action) {
    this.state.pressed[action] = false;
  }

  /** Swallow every button press this frame (used when a menu handled the input). */
  consumeAll() {
    for (const a of ACTIONS) this.state.pressed[a] = false;
    this.state.flick = null;
  }
}

function emptyActions(): Record<Action, boolean> {
  return { a: false, b: false, x: false, y: false, sprint: false, pick: false, pause: false, confirm: false, back: false };
}

function emptyNav(): NavState {
  return { up: false, down: false, left: false, right: false, confirm: false, back: false };
}

/** Builds the on-screen touch controls and wires them to an Input. */
export class TouchControls {
  readonly el: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private swipe: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private labels: Record<'a' | 'b' | 'x' | 'y' | 'pick', HTMLElement> = {} as any;

  constructor(private input: Input, root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'touch-controls';
    this.el.innerHTML = `
      <div class="tc-swipe"><span>SWIPE FOR DRIBBLE MOVES</span></div>
      <div class="tc-stick"><div class="tc-knob"></div></div>
      <div class="tc-buttons">
        <button class="tc-btn tc-y" data-a="y">LOB</button>
        <button class="tc-btn tc-x" data-a="x">SPRINT</button>
        <button class="tc-btn tc-b" data-a="b">PASS</button>
        <button class="tc-btn tc-a" data-a="a">SHOOT</button>
        <button class="tc-btn tc-pick" data-a="pick">SCREEN</button>
      </div>`;
    root.appendChild(this.el);
    this.stick = this.el.querySelector('.tc-stick')!;
    this.knob = this.el.querySelector('.tc-knob')!;
    this.swipe = this.el.querySelector('.tc-swipe')!;
    const radius = 54;
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / radius;
      const ny = -dy / radius;
      if (Math.hypot(nx, ny) < 0.12) input.setTouchMove(0, 0);
      else input.setTouchMove(nx, ny);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.knob.style.transform = 'translate(0,0)';
      input.setTouchMove(0, 0);
    };
    this.stick.addEventListener('pointerdown', (e) => {
      this.stickId = e.pointerId;
      const r = this.stick.getBoundingClientRect();
      this.stickOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.stick.setPointerCapture(e.pointerId);
      onMove(e);
    });
    this.stick.addEventListener('pointermove', onMove);
    this.stick.addEventListener('pointerup', end);
    this.stick.addEventListener('pointercancel', end);
    // Swipe pad: a quick swipe is a skill-stick flick in that direction.
    const swipes = new Map<number, { x: number; y: number; t: number; fired: boolean }>();
    this.swipe.addEventListener('pointerdown', (e) => {
      swipes.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), fired: false });
      this.swipe.setPointerCapture(e.pointerId);
    });
    const swipeMove = (e: PointerEvent) => {
      const st = swipes.get(e.pointerId);
      if (!st || st.fired) return;
      const dx = e.clientX - st.x;
      const dy = e.clientY - st.y;
      const len = Math.hypot(dx, dy);
      if (len > 36 && performance.now() - st.t < 450) {
        st.fired = true;
        input.setTouchFlick(dx / len, -dy / len);
        this.swipe.classList.add('used');
      }
    };
    this.swipe.addEventListener('pointermove', swipeMove);
    this.swipe.addEventListener('pointerup', (e) => {
      swipeMove(e);
      swipes.delete(e.pointerId);
    });
    this.swipe.addEventListener('pointercancel', (e) => swipes.delete(e.pointerId));
    for (const btn of Array.from(this.el.querySelectorAll<HTMLButtonElement>('.tc-btn'))) {
      const a = btn.dataset.a as 'a' | 'b' | 'x' | 'y' | 'pick';
      this.labels[a] = btn;
      // The right-hand top button is a sprint hold on touch.
      const action: Action = a === 'x' ? 'sprint' : a;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        btn.classList.add('down');
        input.setTouchButton(action, true);
      };
      const up = () => {
        btn.classList.remove('down');
        input.setTouchButton(action, false);
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  setLabels(l: { a: string; b: string; x: string; y: string; pick?: string }) {
    const all = { ...l, pick: l.pick ?? '' };
    for (const k of ['a', 'b', 'x', 'y', 'pick'] as const) {
      if (this.labels[k].textContent !== all[k]) this.labels[k].textContent = all[k];
      this.labels[k].style.visibility = all[k] ? '' : 'hidden';
    }
  }

  /** Show or hide the dribble-move swipe pad (only useful on offense). */
  setSwipe(on: boolean) {
    this.swipe.style.display = on ? '' : 'none';
  }

  setVisible(v: boolean) {
    this.el.style.display = v ? '' : 'none';
  }

  destroy() {
    this.el.remove();
  }
}
