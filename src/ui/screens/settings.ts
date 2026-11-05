import { App, h, type Screen } from '../../app/app.ts';
import { casino, fmtCredits } from '../../app/casino.ts';
import { store } from '../../app/store.ts';
import { audio } from '../../engine/audio.ts';
import { hashHex } from '../../core/rng.ts';
import { demoFundsButton, topbar } from '../common.ts';
import { menuScreen } from './menu.ts';

export function settingsScreen(app: App): Screen {
  const el = h('div', { class: 'screen fade-in' });
  const s = store.data.settings;
  const toggle = <T extends string | number>(label: string, options: { v: T; l: string }[], get: () => T, set: (v: T) => void) => {
    const row = h('div', { class: 'toggle' });
    const render = () => {
      row.innerHTML = '';
      for (const o of options) {
        const b = h('button', { class: `btn small${get() === o.v ? ' active' : ''}` }, o.l);
        b.onclick = () => {
          audio.click();
          set(o.v);
          store.save();
          render();
        };
        row.append(b);
      }
    };
    render();
    return h('div', { class: 'row between' }, h('div', {}, label), row);
  };
  const gameplay = h(
    'div',
    { class: 'panel' },
    h('h3', {}, 'GAMEPLAY'),
    toggle('Quarter length', [{ v: 60, l: '1 MIN' }, { v: 120, l: '2 MIN' }, { v: 180, l: '3 MIN' }], () => s.quarterLength, (v) => (s.quarterLength = v)),
    toggle('Camera', [{ v: '2k', l: '2K CAM' }, { v: 'broadcast', l: 'BROADCAST' }], () => s.camera, (v) => (s.camera = v)),
    toggle('Sound', [{ v: 1, l: 'ON' }, { v: 0, l: 'OFF' }], () => (s.sound ? 1 : 0), (v) => { s.sound = v === 1; audio.setEnabled(s.sound); }),
    toggle('Touch controls', [{ v: 'auto', l: 'AUTO' }, { v: 'on', l: 'ON' }, { v: 'off', l: 'OFF' }], () => s.touch, (v) => (s.touch = v)),
  );

  const controls = h(
    'div',
    { class: 'panel' },
    h('h3', {}, 'CONTROLS (2K LAYOUT)'),
    h(
      'div',
      { class: 'controls-help' },
      h('div', {}, h('h4', {}, 'Keyboard'), dl([['WASD / Arrows', 'Move'], ['Shift', 'Sprint'], ['Space / J', 'Shoot (hold, release at the green) · Block'], ['E / K', 'Pass · Switch defender'], ['Q / L', 'Crossover · Steal'], ['Esc / P', 'Pause']])),
      h('div', {}, h('h4', {}, 'PlayStation'), dl([['Left stick', 'Move'], ['R2', 'Sprint'], ['Square', 'Shoot · Block'], ['Cross', 'Pass · Switch'], ['Circle', 'Dribble move · Steal'], ['Right stick', 'Pro-stick flick: crossover'], ['Options', 'Pause']])),
      h('div', {}, h('h4', {}, 'Xbox'), dl([['Left stick', 'Move'], ['RT', 'Sprint'], ['X', 'Shoot · Block'], ['A', 'Pass · Switch'], ['B', 'Dribble move · Steal'], ['Right stick', 'Flick: crossover'], ['Menu', 'Pause']])),
      h('div', {}, h('h4', {}, 'Touch'), dl([['Left stick', 'Move'], ['SHOOT', 'Hold & release · Block on D'], ['PASS', 'Pass · Switch on D'], ['SPRINT', 'Sprint'], ['MOVE', 'Crossover · Steal on D']])),
    ),
    h('div', { class: 'muted', style: 'font-size:12px;margin-top:8px' }, 'Shooting: hold to start the jumper and release when the meter reaches the green band. A green release is the best shot you can take; contests, movement and distance still matter. Near the rim, shoot triggers a layup or dunk automatically.'),
  );

  // Operator panel.
  const cfg = casino.config;
  const rtpLabel = h('div', { class: 'odds' }, `${(cfg.rtp * 100).toFixed(1)}%`);
  const rtpSlider = h('input', { type: 'range', min: '80', max: '99', step: '0.5', value: String(cfg.rtp * 100) }) as HTMLInputElement;
  rtpSlider.oninput = () => {
    rtpLabel.textContent = `${Number(rtpSlider.value).toFixed(1)}%`;
  };
  rtpSlider.onchange = () => {
    casino.setOperator({ rtp: Number(rtpSlider.value) / 100 });
  };
  const seedInput = h('input', { type: 'text', value: cfg.serverSeed }) as HTMLInputElement;
  seedInput.onchange = () => casino.setOperator({ serverSeed: seedInput.value || cfg.serverSeed });
  const minBet = h('input', { type: 'text', value: String(cfg.minBet), inputmode: 'numeric' }) as HTMLInputElement;
  const maxBet = h('input', { type: 'text', value: String(cfg.maxBet), inputmode: 'numeric' }) as HTMLInputElement;
  minBet.onchange = () => casino.setOperator({ minBet: Math.max(1, Number(minBet.value) || 1) });
  maxBet.onchange = () => casino.setOperator({ maxBet: Math.max(Number(minBet.value) || 1, Number(maxBet.value) || 100) });
  const totals = store.data.totals;
  const actual = totals.wagered > 0 ? ((totals.returned / totals.wagered) * 100).toFixed(1) + '%' : '—';
  const resetBtn = h('button', { class: 'btn small ghost' }, 'RESET ALL DATA');
  resetBtn.onclick = () => {
    if (confirm('Reset balance, settings, career and ledger?')) {
      store.reset();
      location.reload();
    }
  };
  const operator = h(
    'div',
    { class: 'panel' },
    h('h3', {}, 'OPERATOR · RTP CONFIGURATION'),
    h('div', { class: 'muted', style: 'font-size:13px' }, 'Every round is resolved by the deterministic outcome engine before tip-off. The bots are then steered to reproduce that result on the court. All six modes pay exactly this return-to-player in expectation.'),
    h('div', { class: 'row' }, rtpLabel, h('div', { class: 'grow' }, rtpSlider)),
    h('div', { class: 'kv' }, h('b', {}, 'Server seed'), seedInput, h('b', {}, 'Min bet'), minBet, h('b', {}, 'Max bet'), maxBet),
    h('div', { class: 'kv' }, h('b', {}, 'Rounds'), h('span', {}, String(totals.rounds)), h('b', {}, 'Wagered'), h('span', {}, fmtCredits(totals.wagered)), h('b', {}, 'Returned'), h('span', {}, fmtCredits(totals.returned)), h('b', {}, 'Observed RTP'), h('span', {}, actual)),
    h('div', { class: 'row' }, demoFundsButton(() => app.show(settingsScreen(app))), resetBtn),
  );

  // Ledger with provably-fair verification.
  const ledger = h('div', { class: 'panel' }, h('h3', {}, 'ROUND LEDGER · PROVABLY FAIR'));
  if (store.data.ledger.length === 0) ledger.append(h('div', { class: 'muted' }, 'No rounds yet.'));
  for (const e of store.data.ledger.slice(0, 25)) {
    const ok = hashHex(e.revealSeed) === e.fairnessHash;
    ledger.append(
      h(
        'div',
        { class: 'ledger-entry' },
        h('div', {}, `${e.mode.toUpperCase()} · ${e.summary}`),
        h('div', { class: e.payout > 0 ? 'win' : 'lose' }, `${e.payout > 0 ? '+' : ''}${fmtCredits(e.payout - e.bet)} (${e.multiplier.toFixed(2)}x on ${fmtCredits(e.bet)})`),
        h('div', { class: 'hash' }, `${ok ? '✔ verified' : '✘ mismatch'} · hash ${e.fairnessHash.slice(0, 20)}… · seed ${e.revealSeed}`),
      ),
    );
  }
  el.append(topbar('SETTINGS', () => app.show(menuScreen(app))), gameplay, controls, operator, ledger);
  return { el, keepReel: true };
}

function dl(items: [string, string][]): HTMLElement {
  const d = h('dl');
  for (const [k, v] of items) d.append(h('dt', {}, k), h('dd', {}, v));
  return d;
}
