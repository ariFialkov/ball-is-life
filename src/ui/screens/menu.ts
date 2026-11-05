import { App, h, type Screen } from '../../app/app.ts';
import { casino, fmtCredits } from '../../app/casino.ts';
import { store } from '../../app/store.ts';
import { audio } from '../../engine/audio.ts';
import { quickGameScreen } from './quick.ts';
import { careerScreen } from './career.ts';
import { playoffsScreen } from './playoffs.ts';
import { allStarScreen } from './allstar.ts';
import { settingsScreen } from './settings.ts';
import { settingsSummary } from '../common.ts';

export function menuScreen(app: App): Screen {
  const el = h('div', { class: 'screen menu-layout fade-in' });
  const bal = h('div', { class: 'balance' }, h('small', {}, 'BALANCE'), `${fmtCredits(casino.balance)} CR`);
  const header = h('div', { class: 'row between' }, h('div', { class: 'subtitle' }, 'LEGENDS EDITION · SEASON 26'), bal);
  const title = h('h1', { class: 'title huge' }, 'BALL IS', h('br'), 'LIFE');
  const careerLabel = store.data.career ? `CONTINUE · ${store.data.career.playerName.toUpperCase()}` : 'ROOKIE TO LEGEND';
  const playoffLabel = store.data.playoffs && !store.data.playoffs.finished ? 'CONTINUE RUN' : 'BRACKET · CHAMPIONSHIP';
  const btn = (label: string, sub: string, fn: () => void) => {
    const b = h('button', { class: 'btn menu' }, h('span', {}, label), h('small', {}, sub));
    b.onclick = () => {
      audio.unlock();
      audio.click();
      fn();
    };
    return b;
  };
  const buttons = h(
    'div',
    { class: 'menu-buttons' },
    btn('QUICK GAME', 'MONEYLINE 1:1 – 2.5:1', () => app.show(quickGameScreen(app))),
    btn('MY CAREER', careerLabel, () => app.show(careerScreen(app))),
    btn('PLAYOFFS', playoffLabel, () => app.show(playoffsScreen(app))),
    btn('ALL-STAR', '3PT · DUNK · SKILLS', () => app.show(allStarScreen(app))),
    btn('SETTINGS', settingsSummary(), () => app.show(settingsScreen(app))),
  );
  const foot = h('div', { class: 'row muted', style: 'font-size:12px' }, `RTP ${(casino.rtp * 100).toFixed(1)}% · ${app.input.state.gamepadConnected ? 'CONTROLLER CONNECTED' : 'KEYBOARD / TOUCH / CONTROLLER'} · 18+ DEMO CREDITS ONLY`);
  el.append(header, title, buttons, foot);
  return {
    el,
    keepReel: true,
    update() {
      bal.lastChild!.textContent = `${fmtCredits(casino.balance)} CR`;
    },
  };
}
