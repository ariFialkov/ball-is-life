/**
 * Unified input: keyboard + mouse, touch (virtual joystick + buttons) and
 * gamepad (PS5 / Xbox via the standard Gamepad API mapping).
 *
 * Button semantics follow the NBA 2K convention and depend on possession:
 *   Offense: A = shoot (hold/release), B = pass, X = dribble move, Y = sprint(hold)
 *   Defense: A = block/rebound, B = switch player, X = steal, Y = sprint(hold)
 */
export type Action = 'a' | 'b' | 'x' | 'y' | 'sprint' | 'pause' | 'confirm' | 'back';

export interface InputState {
  /** Movement vector in screen-space (x right, y up), magnitude <= 1. */
  move: { x: number; y: number };
  sprint: boolean;
  held: Record<Action, boolean>;
  pressed: Record<Action, boolean>;
  released: Record<Action, boolean>;
  /** Right-stick flick direction for dribble moves (gamepad) */
  flick: { x: number; y: number } | null;
  gamepadConnected: boolean;
  gamepadType: 'ps' | 'xbox' | 'generic' | null;
  usingTouch: boolean;
}

const KEYMAP: Record<string, Action | 'left' | 'right' | 'up' | 'down'> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'a',
  KeyJ: 'a',
  KeyE: 'b',
  KeyK: 'b',
  KeyQ: 'x',
  KeyL: 'x',
  KeyR: 'y',
  KeyI: 'y',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Escape: 'pause',
  KeyP: 'pause',
  Enter: 'confirm',
  Backspace: 'back',
};

const ACTIONS: Action[] = ['a', 'b', 'x', 'y', 'sprint', 'pause', 'confirm', 'back'];

export class Input {
  state: InputState = {
    move: { x: 0, y: 0 },
    sprint: false,
    held: emptyActions(),
    pressed: emptyActions(),
    released: emptyActions(),
    flick: null,
    gamepadConnected: false,
    gamepadType: null,
    usingTouch: false,
  };
  private keys = new Set<string>();
  private prevHeld = emptyActions();
  private touchMove = { x: 0, y: 0 };
  private touchHeld = emptyActions();
  private padPrevButtons: boolean[] = [];
  private rightStickPrev = { x: 0, y: 0 };
  private flickCooldown = 0;
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (KEYMAP[e.code]) {
        this.keys.add(e.code);
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
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

  /** Must be called once per frame before reading state. */
  poll(dt: number) {
    const s = this.state;
    const held = emptyActions();
    let mx = 0;
    let my = 0;
    // Keyboard.
    for (const code of this.keys) {
      const a = KEYMAP[code];
      if (a === 'left') mx -= 1;
      else if (a === 'right') mx += 1;
      else if (a === 'up') my += 1;
      else if (a === 'down') my -= 1;
      else if (a) held[a] = true;
    }
    // Touch.
    if (Math.abs(this.touchMove.x) + Math.abs(this.touchMove.y) > 0.01) {
      mx = this.touchMove.x;
      my = this.touchMove.y;
    }
    for (const a of ACTIONS) if (this.touchHeld[a]) held[a] = true;
    // Gamepad.
    s.flick = null;
    this.flickCooldown = Math.max(0, this.flickCooldown - dt);
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) pad = p;
    if (pad) {
      s.gamepadConnected = true;
      const id = pad.id.toLowerCase();
      s.gamepadType = /054c|dualsense|dualshock|playstation|wireless controller/.test(id) ? 'ps' : /xbox|045e|xinput/.test(id) ? 'xbox' : 'generic';
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const dead = 0.18;
      const mag = Math.hypot(ax, ay);
      if (mag > dead) {
        const scaled = Math.min(1, (mag - dead) / (1 - dead));
        mx = (ax / mag) * scaled;
        my = (-ay / mag) * scaled;
      }
      // D-pad.
      if (pad.buttons[12]?.pressed) my = 1;
      if (pad.buttons[13]?.pressed) my = -1;
      if (pad.buttons[14]?.pressed) mx = -1;
      if (pad.buttons[15]?.pressed) mx = 1;
      const b = (i: number) => !!pad!.buttons[i]?.pressed;
      // Standard mapping: 0 = Cross/A, 1 = Circle/B, 2 = Square/X, 3 = Triangle/Y
      // 2K layout: Square shoot, Cross pass, Circle dribble move / post, Triangle block/skip pass
      if (b(2)) held.a = true; // Square / X -> shoot
      if (b(0)) held.b = true; // Cross / A -> pass / switch
      if (b(1)) held.x = true; // Circle / B -> dribble move / steal
      if (b(3)) held.y = true; // Triangle / Y -> block / pump fake
      if (b(7) || b(5)) held.sprint = true; // RT / RB sprint
      if (b(9)) held.pause = true;
      if (b(0)) held.confirm = true;
      if (b(1)) held.back = true;
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      const rmag = Math.hypot(rx, ry);
      const prevMag = Math.hypot(this.rightStickPrev.x, this.rightStickPrev.y);
      if (rmag > 0.7 && prevMag < 0.4 && this.flickCooldown <= 0) {
        s.flick = { x: rx / rmag, y: -ry / rmag };
        this.flickCooldown = 0.35;
      }
      this.rightStickPrev = { x: rx, y: ry };
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    s.move.x = this.enabled ? mx : 0;
    s.move.y = this.enabled ? my : 0;
    for (const a of ACTIONS) {
      const h = this.enabled && held[a];
      s.held[a] = h;
      s.pressed[a] = h && !this.prevHeld[a];
      s.released[a] = !h && this.prevHeld[a];
      this.prevHeld[a] = h;
    }
    s.sprint = s.held.sprint;
  }

  consume(action: Action) {
    this.state.pressed[action] = false;
  }
}

function emptyActions(): Record<Action, boolean> {
  return { a: false, b: false, x: false, y: false, sprint: false, pause: false, confirm: false, back: false };
}

/** Builds the on-screen touch controls and wires them to an Input. */
export class TouchControls {
  readonly el: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private labels: Record<'a' | 'b' | 'x' | 'y', HTMLElement> = {} as any;

  constructor(private input: Input, root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'touch-controls';
    this.el.innerHTML = `
      <div class="tc-stick"><div class="tc-knob"></div></div>
      <div class="tc-buttons">
        <button class="tc-btn tc-y" data-a="y">MOVE</button>
        <button class="tc-btn tc-x" data-a="x">SPRINT</button>
        <button class="tc-btn tc-b" data-a="b">PASS</button>
        <button class="tc-btn tc-a" data-a="a">SHOOT</button>
      </div>`;
    root.appendChild(this.el);
    this.stick = this.el.querySelector('.tc-stick')!;
    this.knob = this.el.querySelector('.tc-knob')!;
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
      const mag = Math.hypot(nx, ny);
      const dead = 0.12;
      if (mag < dead) input.setTouchMove(0, 0);
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
    for (const btn of Array.from(this.el.querySelectorAll<HTMLButtonElement>('.tc-btn'))) {
      const a = btn.dataset.a as 'a' | 'b' | 'x' | 'y';
      this.labels[a] = btn;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        btn.classList.add('down');
        input.setTouchButton(a, true);
        if (a === 'x') input.setTouchButton('sprint', true);
      };
      const up = () => {
        btn.classList.remove('down');
        input.setTouchButton(a, false);
        if (a === 'x') input.setTouchButton('sprint', false);
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  setLabels(l: { a: string; b: string; x: string; y: string }) {
    for (const k of ['a', 'b', 'x', 'y'] as const) if (this.labels[k].textContent !== l[k]) this.labels[k].textContent = l[k];
  }

  setVisible(v: boolean) {
    this.el.style.display = v ? '' : 'none';
  }

  destroy() {
    this.el.remove();
  }
}
