import { App, h, type Screen } from '../../app/app.ts';
import { fmtCredits } from '../../app/casino.ts';
import type { TeamDef } from '../../data/teams.ts';
import type { Match } from '../../match/match.ts';
import { fineHash, logoImg } from '../common.ts';
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
  /** Middle label of the score slab (FINAL by default; RECORD for a career summary). */
  scoreLabel?: string;
}

/** The broadcast final: score slab with logos, the payout, player of the game and the box score. */
export function resultsScreen(app: App, o: ResultsOptions): Screen {
  app.startReel();
  const el = h('div', { class: 'screen center fade-in' });
  const won = o.payout > 0;
  const [a, b] = o.teams;
  const same = a === b;
  const side = (t: TeamDef, pts: number, r: boolean) =>
    h('div', { class: `side${r ? ' r' : ''}`, style: `--c:${t.colors.primary};--c2:${t.colors.secondary}` }, logoImg(t, 88), h('div', { class: 'ab' }, t.abbr), h('div', { class: 'pts' }, String(pts)));
  const score = h(
    'div',
    { class: 'final-score' },
    side(a, o.scores[0], false),
    h('div', { class: 'mid' }, h('div', { class: 'f' }, o.scoreLabel ?? (same ? 'RECORD' : 'FINAL')), h('div', { class: 's' }, same ? 'W – L' : o.match && o.match.period > 4 ? `OT${o.match.period > 5 ? o.match.period - 4 : ''}` : '')),
    side(b, o.scores[1], true),
  );
  const payout = h('div', { class: `payout ${won ? 'win' : 'lose'}` }, won ? `+${fmtCredits(o.payout)} CR` : 'NO RETURN');
  const strip = h('div', { class: 'final-strip' }, h('div', { class: 'title big' }, o.title), payout, h('div', { class: 'chip' }, `STAKE ${fmtCredits(o.bet)} · ${o.multiplier.toFixed(2)}x`));
  const details = h('div', { class: 'final-details' });
  const left = h('div', { class: 'panel gold' });
  const potg = o.match ? playerOfTheGame(o.match) : null;
  if (potg) left.append(h('h3', {}, 'PLAYER OF THE GAME'), potg);
  if (o.lines?.length) {
    const lines = h('div', { class: 'final-lines' });
    for (const l of o.lines) lines.append(h('div', {}, l));
    left.append(lines);
  }
  if (left.childElementCount) details.append(left);
  if (o.match) details.append(boxScore(o.match));
  const actions = h('div', { class: 'frame-foot' }, fineHash(o.fairnessHash));
  for (const x of o.actions) {
    const btn = h('button', { class: `btn ${x.primary ? 'primary' : ''}`, ...(x.primary ? { 'data-nav-default': '' } : {}) }, x.label);
    btn.onclick = () => {
      audio.click();
      x.onClick();
    };
    actions.append(btn);
  }
  el.append(h('div', { class: 'final-card' }, score, strip, details, actions));
  if (won) audio.cash();
  return { el, keepReel: true };
}

function playerOfTheGame(match: Match): HTMLElement | null {
  const best = match.athletes.filter((x) => x.stats.pts + x.stats.reb + x.stats.ast > 0).sort((x, y) => gameScore(y) - gameScore(x))[0];
  if (!best) return null;
  const s = best.stats;
  const team = match.opts.teams[best.team];
  return h(
    'div',
    { class: 'potg' },
    logoImg(team, 48),
    h('div', { class: 'grow' }, h('div', { class: 'title mid' }, `#${best.def.number} ${best.def.name}`), h('div', { class: 'kicker' }, `${team.abbr} · ${best.def.pos} · ${s.reb} REB · ${s.ast} AST · ${s.fgm}/${s.fga} FG`)),
    h('div', { class: 'num' }, `${s.pts}`, h('small', {}, 'PTS')),
  );
}

function gameScore(a: Match['athletes'][number]) {
  const s = a.stats;
  return s.pts + 0.4 * s.fgm - 0.7 * s.fga + 0.7 * s.reb + 0.7 * s.ast + s.stl + 0.7 * s.blk - s.to + (a.isUser ? 2 : 0);
}

export function boxScore(match: Match): HTMLElement {
  const rows = match.athletes
    .filter((a) => a.team === 0 && (a.stats.pts > 0 || a.stats.fga > 0 || a.isUser || a.onCourt))
    .sort((a, b) => (b.isUser ? 1 : 0) - (a.isUser ? 1 : 0) || b.stats.pts - a.stats.pts)
    .slice(0, 6);
  const table = h('table', { class: 'table' });
  table.append(h('tr', {}, h('th', {}, `${match.opts.teams[0].abbr} BOX SCORE`), h('th', {}, 'PTS'), h('th', {}, 'AST'), h('th', {}, 'REB'), h('th', {}, 'STL'), h('th', {}, 'BLK'), h('th', {}, 'FG'), h('th', {}, '3PT')));
  for (const a of rows) {
    const s = a.stats;
    table.append(h('tr', { class: a.isUser ? 'you' : '' }, h('td', {}, `${a.def.name} · ${a.def.pos}`), h('td', {}, String(s.pts)), h('td', {}, String(s.ast)), h('td', {}, String(s.reb)), h('td', {}, String(s.stl)), h('td', {}, String(s.blk)), h('td', {}, `${s.fgm}/${s.fga}`), h('td', {}, `${s.tpm}/${s.tpa}`)));
  }
  return h('div', { class: 'panel volt box' }, table);
}
