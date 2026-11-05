import { App, h, type Screen } from '../../app/app.ts';
import { fmtCredits } from '../../app/casino.ts';
import type { TeamDef } from '../../data/teams.ts';
import type { Match } from '../../match/match.ts';
import { fairnessBlock, logoImg } from '../common.ts';
import { audio } from '../../engine/audio.ts';

export interface ResultsOptions {
  title: string;
  teams: [TeamDef, TeamDef];
  scores: [number, number];
  match?: Match;
  payout: number;
  bet: number;
  multiplier: number;
  fairnessHash: string;
  lines?: string[];
  actions: { label: string; primary?: boolean; onClick: () => void }[];
}

export function resultsScreen(app: App, o: ResultsOptions): Screen {
  app.startReel();
  const el = h('div', { class: 'screen center fade-in' });
  const won = o.payout > 0;
  const score = h(
    'div',
    { class: 'results-score' },
    h('div', { class: 't' }, logoImg(o.teams[0]), o.teams[0].abbr),
    h('div', {}, `${o.scores[0]}`),
    h('div', { class: 'muted', style: 'font-size:32px' }, '–'),
    h('div', {}, `${o.scores[1]}`),
    h('div', { class: 't' }, logoImg(o.teams[1]), o.teams[1].abbr),
  );
  const payout = h('div', { class: `payout ${won ? 'win' : 'lose'}` }, won ? `+${fmtCredits(o.payout)} CR` : 'NO RETURN');
  const sub = h('div', { class: 'muted' }, `STAKE ${fmtCredits(o.bet)} · MULTIPLIER ${o.multiplier.toFixed(2)}x`);
  const panel = h('div', { class: 'panel', style: 'text-align:center' }, h('div', { class: 'subtitle' }, o.title), score, payout, sub);
  if (o.lines) for (const l of o.lines) panel.append(h('div', { class: 'muted', style: 'margin-top:6px' }, l));
  const box = o.match ? boxScore(o.match) : null;
  const actions = h('div', { class: 'row', style: 'justify-content:center' });
  for (const a of o.actions) {
    const b = h('button', { class: `btn ${a.primary ? 'primary' : ''}` }, a.label);
    b.onclick = () => {
      audio.click();
      a.onClick();
    };
    actions.append(b);
  }
  el.append(panel);
  if (box) el.append(box);
  el.append(actions, h('div', { class: 'panel' }, fairnessBlock(o.fairnessHash)));
  if (won) audio.cash();
  return { el, keepReel: true };
}

export function boxScore(match: Match): HTMLElement {
  const rows = match.athletes
    .filter((a) => a.team === 0 && (a.stats.pts > 0 || a.stats.fga > 0 || a.isUser || a.onCourt))
    .sort((a, b) => b.stats.pts - a.stats.pts);
  const table = h('table', { class: 'table' });
  table.append(h('tr', {}, h('th', {}, `${match.opts.teams[0].abbr} BOX SCORE`), h('th', {}, 'PTS'), h('th', {}, 'AST'), h('th', {}, 'REB'), h('th', {}, 'STL'), h('th', {}, 'BLK'), h('th', {}, 'FG'), h('th', {}, '3PT')));
  for (const a of rows) {
    const s = a.stats;
    table.append(h('tr', { class: a.isUser ? 'you' : '' }, h('td', {}, `${a.def.name} · ${a.def.pos}`), h('td', {}, String(s.pts)), h('td', {}, String(s.ast)), h('td', {}, String(s.reb)), h('td', {}, String(s.stl)), h('td', {}, String(s.blk)), h('td', {}, `${s.fgm}/${s.fga}`), h('td', {}, `${s.tpm}/${s.tpa}`)));
  }
  return h('div', { class: 'panel', style: 'overflow-x:auto' }, table);
}
