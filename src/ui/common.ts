import { h } from '../app/app.ts';
import { casino, fmtCredits } from '../app/casino.ts';
import { store } from '../app/store.ts';
import type { TeamDef } from '../data/teams.ts';
import { teamLogoDataUrl } from '../data/logos.ts';
import { audio } from '../engine/audio.ts';

export function topbar(title: string, onBack: (() => void) | null, extra?: HTMLElement): HTMLElement {
  const left = h('div', { class: 'row' });
  if (onBack) {
    const b = h('button', { class: 'btn small ghost' }, '‹ BACK');
    b.onclick = () => {
      audio.click();
      onBack();
    };
    left.append(b);
  }
  left.append(h('h2', { class: 'title big' }, title));
  const bal = h('div', { class: 'balance' }, h('small', {}, 'BALANCE'), `${fmtCredits(casino.balance)} CR`);
  const right = h('div', { class: 'row' }, bal);
  if (extra) right.append(extra);
  return h('div', { class: 'topbar' }, left, right);
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
