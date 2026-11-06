import type { Input } from '../engine/input.ts';
import { isTyping } from '../engine/input.ts';
import { audio } from '../engine/audio.ts';

const FOCUSABLE = 'button:not([disabled]), .team-card:not(.disabled), input:not([type=hidden]), select, [data-nav]';

type Dir = 'up' | 'down' | 'left' | 'right';

/**
 * Controller / keyboard navigation for every menu and selection screen.
 *
 * Focus moves spatially (to the nearest element in the pressed direction), so
 * screens need no per-screen wiring: buttons, team cards, toggles, sliders and
 * text fields are all reachable. Cross / A / Enter selects, Circle / B / Escape
 * presses the screen's back button (anything marked `data-nav-back`). The focus
 * ring only shows once a controller or the keyboard is used, so mouse and touch
 * users never see it.
 */
export class MenuNav {
  private current: HTMLElement | null = null;
  private lastRect: DOMRect | null = null;
  private scopeEl: Element | null = null;
  private scopeKey: Element | null = null;
  private active = false;
  private hint: HTMLElement;

  constructor(private input: Input) {
    this.hint = document.createElement('div');
    this.hint.className = 'nav-hint';
    document.body.appendChild(this.hint);
    window.addEventListener('mousemove', () => this.deactivate(), { passive: true });
    window.addEventListener('pointerdown', () => this.deactivate(), { passive: true, capture: true });
  }

  private deactivate() {
    if (!this.active) return;
    this.active = false;
    this.paint(null);
  }

  /** Run once per frame, after Input.poll and before the screen updates. */
  update() {
    const s = this.input.state;
    const n = s.nav;
    const scope = this.scope();
    const items = scope ? this.items(scope) : [];
    if (!items.length) {
      this.paint(null);
      this.hint.classList.remove('show');
      return;
    }
    // A new screen or dialog: start from its default element.
    const key = scope === document.getElementById('ui') ? scope!.firstElementChild : scope;
    if (key !== this.scopeKey) {
      this.scopeKey = key;
      this.scopeEl = scope;
      this.current = null;
      this.lastRect = null;
    }
    const any = n.up || n.down || n.left || n.right || n.confirm || n.back;
    const viaNav = s.lastDevice === 'gamepad' || s.lastDevice === 'keyboard';
    let justActivated = false;
    if (any && viaNav && !this.active) {
      this.active = true;
      justActivated = true;
    }
    if (!this.active) {
      this.hint.classList.remove('show');
      return;
    }
    if (!this.current || !this.current.isConnected || !items.includes(this.current)) {
      // The focused element was re-rendered or hidden: take the one now in its place.
      this.current = this.lastRect ? nearestTo(items, this.lastRect) : this.defaultItem(items);
    }
    if (any) this.input.consumeAll();
    if (!justActivated || n.back) {
      const el = this.current;
      const range = el instanceof HTMLInputElement && el.type === 'range' ? el : null;
      if (range && (n.left || n.right)) this.stepRange(range, n.right ? 1 : -1);
      else if (n.up) this.move('up', items);
      else if (n.down) this.move('down', items);
      else if (n.left) this.move('left', items);
      else if (n.right) this.move('right', items);
      if (n.confirm && !justActivated) this.activate(this.current);
      if (n.back) this.back(scope!);
    }
    this.paint(this.current);
    this.showHint();
  }

  private scope(): Element | null {
    const dialogs = document.querySelectorAll<HTMLElement>('.dialog');
    if (dialogs.length) return dialogs[dialogs.length - 1];
    const picker = document.querySelector<HTMLElement>('.dunk-picker');
    if (picker && visible(picker)) return picker;
    return document.getElementById('ui');
  }

  private items(scope: Element): HTMLElement[] {
    return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => visible(el) && !el.closest('.touch-controls') && !el.closest('[data-nav-skip]'));
  }

  private defaultItem(items: HTMLElement[]): HTMLElement {
    const pick = (sel: string) => items.find((el) => el.matches(sel));
    return pick('[data-nav-default]') ?? pick('.team-card.selected') ?? pick('.btn.menu') ?? pick('.btn.primary') ?? items[0];
  }

  private move(dir: Dir, items: HTMLElement[]) {
    const from = this.current;
    if (!from) return;
    if (from === document.activeElement && from instanceof HTMLInputElement) from.blur();
    const r = from.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === from) continue;
      const o = el.getBoundingClientRect();
      const ox = o.left + o.width / 2;
      const oy = o.top + o.height / 2;
      const dx = ox - cx;
      const dy = oy - cy;
      // Primary axis distance must point the right way; overlap on the cross axis is preferred.
      let primary: number;
      let cross: number;
      if (dir === 'left' || dir === 'right') {
        primary = dir === 'right' ? o.left - r.right : r.left - o.right;
        if ((dir === 'right' ? dx : -dx) <= 4) continue;
        const overlap = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
        cross = overlap > 0 ? 0 : Math.abs(dy);
      } else {
        primary = dir === 'down' ? o.top - r.bottom : r.top - o.bottom;
        if ((dir === 'down' ? dy : -dy) <= 4) continue;
        const overlap = Math.min(r.right, o.right) - Math.max(r.left, o.left);
        cross = overlap > 0 ? Math.abs(dx) * 0.15 : Math.abs(dx);
      }
      const score = Math.max(0, primary) + cross * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    // Grids wrap: right at the end of a row goes to the start of the next, left to the end of the previous.
    if (!best && (dir === 'left' || dir === 'right')) {
      for (const el of items) {
        if (el === from) continue;
        const o = el.getBoundingClientRect();
        const oy = o.top + o.height / 2;
        const ox = o.left + o.width / 2;
        const rowGap = dir === 'right' ? oy - cy : cy - oy;
        if (rowGap <= r.height / 2) continue;
        const score = rowGap * 10 + (dir === 'right' ? ox : -ox);
        if (score < bestScore) {
          bestScore = score;
          best = el;
        }
      }
    }
    if (best) {
      this.current = best;
      audio.click();
    }
  }

  private stepRange(el: HTMLInputElement, sign: number) {
    const step = Number(el.step) || 1;
    const v = Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + sign * step));
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private activate(el: HTMLElement | null) {
    if (!el) return;
    audio.click();
    if (el instanceof HTMLInputElement && el.type === 'range') return;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
      if (document.activeElement === el) el.blur();
      else el.focus();
      return;
    }
    el.click();
  }

  private back(scope: Element) {
    if (isTyping()) {
      (document.activeElement as HTMLElement).blur();
      return;
    }
    const b = Array.from(scope.querySelectorAll<HTMLElement>('[data-nav-back]')).find(visible);
    if (b) {
      audio.click();
      b.click();
    }
  }

  private paint(el: HTMLElement | null) {
    for (const old of Array.from(document.querySelectorAll('.nav-focus'))) if (old !== el) old.classList.remove('nav-focus');
    if (!el) return;
    if (!el.classList.contains('nav-focus')) {
      el.classList.add('nav-focus');
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
    this.lastRect = el.getBoundingClientRect();
  }

  private showHint() {
    const s = this.input.state;
    const pad = s.lastDevice === 'gamepad' ? s.gamepadType : null;
    const sel = pad === 'ps' ? '✕' : pad ? 'A' : 'ENTER';
    const back = pad === 'ps' ? '○' : pad ? 'B' : 'ESC';
    const html = `<b>${sel}</b> SELECT &nbsp; <b>${back}</b> BACK`;
    if (this.hint.innerHTML !== html) this.hint.innerHTML = html;
    this.hint.classList.add('show');
  }
}

function visible(el: HTMLElement): boolean {
  if (!el.isConnected || el.getClientRects().length === 0) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.pointerEvents !== 'none';
}

function nearestTo(items: HTMLElement[], r: DOMRect): HTMLElement {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let best = items[0];
  let bd = Infinity;
  for (const el of items) {
    const o = el.getBoundingClientRect();
    const d = Math.hypot(o.left + o.width / 2 - cx, o.top + o.height / 2 - cy);
    if (d < bd) {
      bd = d;
      best = el;
    }
  }
  return best;
}
