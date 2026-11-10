import { h } from '../app/app.ts';
import { casino, fmtCredits } from '../app/casino.ts';
import { store } from '../app/store.ts';
import type { TeamDef } from '../data/teams.ts';
import { teamLogoDataUrl } from '../data/logos.ts';
import { audio } from '../engine/audio.ts';

/** The BALL IS LIFE 27 wordmark. */
export function brand(kind: 'hero' | 'mini' = 'mini'): HTMLElement {
  return h('div', { class: `brand ${kind}`, 'aria-label': 'Ball Is Life 27' }, h('div', { class: 'brand-word' }, h('span', {}, 'BALL IS'), h('span', {}, 'LIFE')), h('div', { class: 'brand-num' }, '27'));
}

export function balanceEl(): HTMLElement {
  return h('div', { class: 'balance' }, h('small', {}, 'BALANCE'), `${fmtCredits(casino.balance)} CR`);
}

/** The header every screen shares: back, kicker + title, the brand, the balance. */
export function topbar(title: string, onBack: (() => void) | null, extra?: HTMLElement, kicker?: string): HTMLElement {
  const head = h('div', { class: 'frame-head' });
  if (onBack) {
    const b = h('button', { class: 'btn back', 'data-nav-back': '' }, '‹ BACK');
    b.onclick = () => {
      audio.click();
      onBack();
    };
    head.append(b);
  }
  const titleBox = h('div', { class: 'grow' });
  if (kicker) titleBox.append(h('div', { class: 'kicker' }, kicker));
  titleBox.append(h('h2', { class: 'title big' }, title));
  head.append(titleBox);
  if (extra) head.append(extra);
  head.append(brand('mini'), balanceEl());
  return head;
}

/**
 * A screen laid out to fit the viewport: header, body (stacked, or split with an open stage on
 * the right for the 3D scene), and an action bar. Nothing scrolls at the page level.
 */
export function frame(o: { title: string; kicker?: string; onBack: (() => void) | null; split?: boolean; extra?: HTMLElement }) {
  const el = h('div', { class: 'screen fade-in' });
  const head = topbar(o.title, o.onBack, o.extra, o.kicker);
  const body = h('div', { class: `frame-body${o.split ? ' split' : ''}` });
  const left = h('div', { class: 'col' });
  const right = h('div', { class: 'col stage' });
  if (o.split) body.append(left, right);
  const foot = h('div', { class: 'frame-foot' });
  el.append(head, body, foot);
  return { el, head, body: o.split ? left : body, stage: right, foot };
}

/** A small fairness line for an action bar. */
export function fineHash(hash: string): HTMLElement {
  return h('div', { class: 'fine', title: hash }, `FAIRNESS HASH ${hash}`);
}

export function teamCard(team: TeamDef, selected = false): HTMLElement {
  const card = h('div', { class: `team-card${selected ? ' selected' : ''}`, style: `--c:${team.colors.primary}` });
  card.append(
    h('img', { src: teamLogoDataUrl(team, 128), alt: team.name }),
    h('div', { class: 'city' }, team.city),
    h('div', { class: 'name' }, team.name),
    h('div', { class: 'ovr' }, `${team.ovr} OVR`),
    h('div', { class: 'chip' }, team.style),
  );
  card.setAttribute('title', `${team.city} ${team.name} · ${team.ovr} OVR · ${team.style}`);
  return card;
}

export interface BetPanelOptions {
  label?: string;
  onChange?: (bet: number) => void;
}

export function betPanel(opts: BetPanelOptions = {}): { el: HTMLElement; get bet(): number; setEnabled(v: boolean): void } {
  const cfg = casino.config;
  const presets = [1, 5, 10, 25, 50, 100, 250].filter((v) => v >= cfg.minBet && v <= cfg.maxBet);
  let bet = presets.includes(10) ? 10 : presets[0] ?? cfg.minBet;
  const amounts = h('div', { class: 'bet-amounts' });
  const label = h('div', { class: 'muted' }, `${opts.label ?? 'STAKE'} · min ${cfg.minBet} · max ${cfg.maxBet}`);
  const render = () => {
    amounts.innerHTML = '';
    for (const v of presets) {
      const b = h('button', { class: `btn small${v === bet ? ' active' : ''}` }, String(v));
      b.onclick = () => {
        audio.click();
        bet = v;
        render();
        opts.onChange?.(bet);
      };
      if (v > casino.balance) (b as HTMLButtonElement).disabled = true;
      amounts.append(b);
    }
    const max = h('button', { class: 'btn small' }, 'MAX');
    max.onclick = () => {
      bet = Math.max(cfg.minBet, Math.min(cfg.maxBet, Math.floor(casino.balance)));
      render();
      opts.onChange?.(bet);
    };
    amounts.append(max);
  };
  render();
  const el = h('div', { class: 'bet-panel' }, label, amounts);
  return {
    el,
    get bet() {
      return bet;
    },
    setEnabled(v: boolean) {
      el.style.opacity = v ? '1' : '0.5';
      el.style.pointerEvents = v ? '' : 'none';
    },
  };
}

export function fairnessBlock(hash: string): HTMLElement {
  return h('div', { class: 'muted', style: 'font-size:11px;font-family:ui-monospace,monospace;word-break:break-all' }, `FAIRNESS HASH ${hash}`);
}

export function logoImg(team: TeamDef, size = 64): HTMLElement {
  return h('img', { src: teamLogoDataUrl(team, 128), width: String(size), height: String(size), alt: team.name });
}

export function demoFundsButton(onDone: () => void): HTMLElement {
  const b = h('button', { class: 'btn small ghost' }, '+1000 DEMO');
  b.onclick = () => {
    casino.addDemoFunds(1000);
    audio.cash();
    onDone();
  };
  return b;
}

export function settingsSummary(): string {
  const s = store.data.settings;
  return `${s.quarterLength / 60} MIN QUARTERS · ${s.camera.toUpperCase()} CAM · RTP ${(casino.rtp * 100).toFixed(1)}%`;
}

/** Line-art for the main-menu tiles. */
export const ART = {
  trophy: `<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"><path d="M30 14h40v18c0 16-9 28-20 28S30 48 30 32z" fill="rgba(255,210,63,0.9)" stroke="#fff"/><path d="M30 20H16c0 14 6 20 15 22M70 20h14c0 14-6 20-15 22"/><path d="M50 60v14M36 86h28l-4-12H40z" fill="rgba(255,210,63,0.9)"/></svg>`,
  star: `<svg viewBox="0 0 100 100"><path d="M50 6l12 30 32 2-25 20 9 32-28-18-28 18 9-32L6 38l32-2z" fill="rgba(255,255,255,0.95)" stroke="#00d9ff" stroke-width="4" stroke-linejoin="round"/></svg>`,
  gear: `<svg viewBox="0 0 100 100" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="7"><circle cx="50" cy="50" r="15"/><path d="M50 8v14M50 78v14M8 50h14M78 50h14M20 20l10 10M70 70l10 10M80 20L70 30M30 70L20 80"/></svg>`,
  jersey: (num: string, color: string) =>
    `<svg viewBox="0 0 100 100"><path d="M30 8l-22 12 8 22 10-4v54h48V38l10 4 8-22-22-12c-2 8-9 12-20 12S32 16 30 8z" fill="${color}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><text x="50" y="74" text-anchor="middle" font-family="Barlow Condensed, Impact, sans-serif" font-weight="900" font-size="38" fill="#fff">${num}</text></svg>`,
};
