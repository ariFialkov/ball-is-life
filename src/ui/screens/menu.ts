import { App, h, type Screen } from '../../app/app.ts';
import { casino, fmtCredits } from '../../app/casino.ts';
import { store } from '../../app/store.ts';
import { makeCareerPlayer, teamById } from '../../data/teams.ts';
import { teamLogoDataUrl } from '../../data/logos.ts';
import { audio } from '../../engine/audio.ts';
import { quickGameScreen } from './quick.ts';
import { careerScreen } from './career.ts';
import { playoffsScreen } from './playoffs.ts';
import { allStarScreen } from './allstar.ts';
import { settingsScreen } from './settings.ts';
import { ART, balanceEl, brand, settingsSummary } from '../common.ts';

/** Main menu: the brand over the highlight reel, and a row of big mode tiles. */
export function menuScreen(app: App): Screen {
  const el = h('div', { class: 'screen menu-layout fade-in' });
  const bal = balanceEl();
  const fav = teamById(store.data.favTeam);
  const career = store.data.career;
  const careerTeam = career ? teamById(career.teamId) : fav;
  const header = h('div', { class: 'frame-head' }, h('div', { class: 'kicker grow' }, 'NEW SEASON · 2027 ROSTERS · LIVE'), bal);
  const hero = h('div', { class: 'menu-hero' }, brand('hero'), h('div', { class: 'tag' }, 'Every possession. Every bucket. Every bet.'));
  const playoffLabel = store.data.playoffs && !store.data.playoffs.finished ? 'CONTINUE RUN' : 'BRACKET · CHAMPIONSHIP';
  const tile = (label: string, sub: string, art: string, c1: string, c2: string, fn: () => void, first = false) => {
    const b = h('button', { class: 'btn menu-tile', style: `--t1:${c1};--t2:${c2}`, ...(first ? { 'data-nav-default': '' } : {}) });
    const artEl = h('div', { class: 'art' });
    artEl.innerHTML = art;
    b.append(artEl, h('div', { class: 'label' }, label), h('div', { class: 'sub' }, sub));
    b.onclick = () => {
      audio.unlock();
      audio.click();
      fn();
    };
    return b;
  };
  const logo = (t: typeof fav) => `<img src="${teamLogoDataUrl(t, 256)}" alt="">`;
  const tiles = h(
    'div',
    { class: 'menu-buttons' },
    tile('QUICK GAME', 'MONEYLINE 1:1 – 2.5:1', logo(fav), fav.colors.primary, '#05060c', () => app.show(quickGameScreen(app)), true),
    tile('MY CAREER', career ? `CONTINUE · ${career.playerName.toUpperCase()}` : 'ROOKIE TO LEGEND', career ? ART.jersey(String(makeCareerPlayer(career.first ?? '', career.last ?? '', career.pos).number), careerTeam.colors.primary) : ART.jersey('27', '#ff2a3d'), '#ff2a3d', '#3a0410', () => app.show(careerScreen(app))),
    tile('PLAYOFFS', playoffLabel, ART.trophy, '#ff9d00', '#3a2200', () => app.show(playoffsScreen(app))),
    tile('ALL-STAR', '3PT · DUNK · SKILLS', ART.star, '#1446ff', '#04103a', () => app.show(allStarScreen(app))),
    tile('SETTINGS', settingsSummary(), ART.gear, '#3a3f55', '#0b0d18', () => app.show(settingsScreen(app))),
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
