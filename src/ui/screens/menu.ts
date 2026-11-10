import { App, h, type Screen } from '../../app/app.ts';
import { casino, fmtCredits } from '../../app/casino.ts';
import { store } from '../../app/store.ts';
import { makeCareerPlayer } from '../../data/teams.ts';
import { audio } from '../../engine/audio.ts';
import { quickGameScreen } from './quick.ts';
import { careerScreen } from './career.ts';
import { playoffsScreen } from './playoffs.ts';
import { allStarScreen } from './allstar.ts';
import { settingsScreen } from './settings.ts';
import { balanceEl, brand, settingsSummary } from '../common.ts';
import { menuArt, type MenuArtKey } from '../menuArt.ts';

/** Main menu: the brand over the highlight reel, and a row of big mode tiles. */
export function menuScreen(app: App): Screen {
  const el = h('div', { class: 'screen menu-layout fade-in' });
  const bal = balanceEl();
  const career = store.data.career;
  const header = h('div', { class: 'frame-head' }, h('div', { class: 'kicker grow' }, 'NEW SEASON · 2027 ROSTERS · LIVE'), bal);
  const hero = h('div', { class: 'menu-hero' }, brand('hero'), h('div', { class: 'tag' }, 'Every possession. Every bucket. Every bet.'));
  const playoffLabel = store.data.playoffs && !store.data.playoffs.finished ? 'CONTINUE RUN' : 'BRACKET · CHAMPIONSHIP';
  const tile = (label: string, sub: string, key: MenuArtKey, fn: () => void, first = false, number?: string) => {
    const art = menuArt(key, { number });
    const b = h('button', { class: `btn menu-tile mt-${key}`, style: `--acc:${art.acc}`, ...(first ? { 'data-nav-default': '' } : {}) });
    const bgEl = h('div', { class: 'art-bg' });
    bgEl.innerHTML = art.bg;
    const artEl = h('div', { class: 'art' });
    artEl.innerHTML = art.art;
    b.append(bgEl, artEl, h('div', { class: 'label' }, label), h('div', { class: 'sub' }, sub));
    b.onclick = () => {
      audio.unlock();
      audio.click();
      fn();
    };
    return b;
  };
  const careerNumber = career ? String(makeCareerPlayer(career.first ?? '', career.last ?? '', career.pos).number) : '27';
  const tiles = h(
    'div',
    { class: 'menu-buttons' },
    tile('QUICK GAME', 'MONEYLINE 1:1 – 2.5:1', 'quick', () => app.show(quickGameScreen(app)), true),
    tile('MY CAREER', career ? `CONTINUE · ${career.playerName.toUpperCase()}` : 'ROOKIE TO LEGEND', 'career', () => app.show(careerScreen(app)), false, careerNumber),
    tile('PLAYOFFS', playoffLabel, 'playoffs', () => app.show(playoffsScreen(app))),
    tile('ALL-STAR', '3PT · DUNK · SKILLS', 'allstar', () => app.show(allStarScreen(app))),
    tile('SETTINGS', settingsSummary(), 'settings', () => app.show(settingsScreen(app))),
  );
  const foot = h(
    'div',
    { class: 'menu-foot' },
    h('span', {}, `RTP ${(casino.rtp * 100).toFixed(1)}% · ${app.input.state.gamepadConnected ? 'CONTROLLER CONNECTED' : 'KEYBOARD · TOUCH · CONTROLLER'}`),
    h('span', {}, '18+ · DEMO CREDITS ONLY'),
  );
  el.append(header, h('div', { class: 'frame-body' }, hero, tiles), foot);
  return {
    el,
    keepReel: true,
    update() {
      bal.lastChild!.textContent = `${fmtCredits(casino.balance)} CR`;
    },
  };
}
