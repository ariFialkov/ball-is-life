import { App, h, type Screen } from '../../app/app.ts';
import { casino, fmtCredits } from '../../app/casino.ts';
import { store } from '../../app/store.ts';
import { TEAMS, teamById, makeCareerPlayer, type PlayerDef, type TeamDef } from '../../data/teams.ts';
import { CONTEST_PAYTABLES } from '../../core/casino/paytables.ts';
import { betPanel, fairnessBlock, logoImg, topbar } from '../common.ts';
import { threePointContest } from '../../contests/three.ts';
import { dunkContest } from '../../contests/dunk.ts';
import { skillsChallenge } from '../../contests/skills.ts';
import type { ContestOptions, ContestResult } from '../../contests/base.ts';
import { fmt } from '../../contests/base.ts';
import { menuScreen } from './menu.ts';
import { audio } from '../../engine/audio.ts';
import { Rng } from '../../core/rng.ts';
import type { RoundTicket } from '../../core/casino/types.ts';

type ContestId = 'three' | 'dunk' | 'skills';

const CONTESTS: { id: ContestId; name: string; blurb: string; rating: keyof PlayerDef['ratings'] }[] = [
  { id: 'three', name: '3-POINT CONTEST', blurb: '70 seconds · 5 racks + your money rack · 2 deep balls · 40 max · top 3 to the final', rating: 'three' },
  { id: 'dunk', name: 'SLAM DUNK CONTEST', blurb: '2 dunks a round · 3 attempts each · 5 judges, 6-10 · top 2 to the final', rating: 'dunk' },
  { id: 'skills', name: 'SKILLS CHALLENGE', blurb: '2 halves: chairs · chest pass · layup · three, then cones · bounce pass · dunk · logo 3 · fastest 2 to the final', rating: 'handle' },
];

export function allStarScreen(app: App): Screen {
  app.startReel();
  const el = h('div', { class: 'screen fade-in' });
  let contest: ContestId = 'three';
  const team = teamById(store.data.favTeam);
  const bet = betPanel({ label: 'ENTRY STAKE' });
  const cards = h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(240px,1fr))' });
  const pay = h('div', { class: 'row' });
  const enter = h('button', { class: 'btn primary', 'data-nav-advance': '' }, 'ENTER CONTEST');
  const render = () => {
    cards.innerHTML = '';
    for (const c of CONTESTS) {
      const card = h('div', { class: `team-card${c.id === contest ? ' selected' : ''}`, style: `--c:${team.colors.primary}` }, h('div', { class: 'name' }, c.name), h('div', { class: 'city' }, c.blurb));
      card.onclick = () => {
        audio.click();
        contest = c.id;
        render();
      };
      cards.append(card);
    }
    const pt = CONTEST_PAYTABLES[contest];
    pay.innerHTML = '';
    pay.append(h('div', { class: 'chip gold' }, `CHAMPION: ${pt[0]}x`), h('div', { class: 'chip' }, `RUNNER-UP: ${pt[1]}x`), h('div', { class: 'chip' }, '3RD / 4TH: 0x'));
    (enter as HTMLButtonElement).disabled = !casino.canBet(bet.bet);
  };
  enter.onclick = () => {
    if (!casino.canBet(bet.bet)) return;
    audio.click();
    const ticket = casino.placeBet(contest, bet.bet, { team: team.id });
    runContest(app, ticket, contest, team);
  };
  el.append(
    topbar('ALL-STAR SATURDAY', () => app.show(menuScreen(app))),
    h('div', { class: 'subtitle' }, `REPRESENTING ${team.city.toUpperCase()} ${team.name.toUpperCase()} · CHANGE TEAM IN QUICK GAME`),
    cards,
    h('div', { class: 'panel' }, h('h3', {}, 'PAYOUT · 4 COMPETITORS'), pay, h('div', { class: 'muted', style: 'font-size:13px;margin:6px 0' }, 'You go first in every round, then three league stars. Win the final or finish runner-up to cash.'), bet.el, enter),
  );
  render();
  bet.el.addEventListener('click', () => render());
  return { el, keepReel: true };
}

function pickBots(contest: ContestId, exclude: TeamDef, seed: string): { def: PlayerDef; team: TeamDef }[] {
  const rng = new Rng(seed);
  const key = CONTESTS.find((c) => c.id === contest)!.rating;
  const pool: { def: PlayerDef; team: TeamDef }[] = [];
  for (const t of TEAMS) {
    if (t === exclude) continue;
    const best = t.roster.slice().sort((a, b) => b.ratings[key] - a.ratings[key])[0];
    pool.push({ def: best, team: t });
  }
  return rng.shuffle(pool.sort((a, b) => b.def.ratings[key] - a.def.ratings[key]).slice(0, 6)).slice(0, 3);
}

function runContest(app: App, ticket: RoundTicket, contest: ContestId, team: TeamDef) {
  if (ticket.outcome.kind !== 'contest') return;
  const outcome = ticket.outcome;
  // Your MyCareer name if you have one; otherwise the jersey just says YOU.
  const first = store.data.playerFirst || (store.data.playerName ? store.data.playerName.split(' ')[0] : '');
  const last = store.data.playerLast || (store.data.playerName ? store.data.playerName.split(' ').slice(1).join(' ') : '') || 'You';
  const name = `${first} ${last}`.trim();
  const player = makeCareerPlayer(first, last, contest === 'dunk' ? 'SF' : contest === 'three' ? 'SG' : 'PG');
  player.number = 7;
  const info = CONTESTS.find((c) => c.id === contest)!;
  const strip = `${info.name} · STAKE ${fmtCredits(ticket.bet)} CR · CHAMPION PAYS ${fmtCredits(ticket.bet * outcome.paytable[0])}`;
  const onFinish = (r: ContestResult) => {
    // The bet settles on the ticket; the standings were steered to land on it.
    const mult = outcome.paytable[outcome.place - 1] ?? 0;
    const entry = casino.settle(ticket, mult, `${info.name}: ${ordinal(r.place)}${r.tiebreak ? ' (tiebreaker)' : ''}`);
    app.show(contestResults(app, { r, info: info.name, payout: entry.payout, bet: ticket.bet, mult, hash: ticket.fairnessHash }));
  };
  const opts: ContestOptions = {
    team,
    player,
    userName: name,
    bots: pickBots(contest, team, `bots:${ticket.id}`),
    place: outcome.place,
    botsAbove: outcome.botsAbove,
    strip,
    seed: `contest:${ticket.id}`,
    onFinish,
  };
  if (contest === 'three') app.show(threePointContest(app, opts));
  else if (contest === 'dunk') app.show(dunkContest(app, opts));
  else app.show(skillsChallenge(app, opts));
}

function ordinal(n: number) {
  return `${n}${['ST', 'ND', 'RD', 'TH'][Math.min(3, n - 1)]}`;
}

function contestResults(app: App, o: { r: ContestResult; info: string; payout: number; bet: number; mult: number; hash: string }): Screen {
  app.startReel();
  const el = h('div', { class: 'screen center fade-in' });
  const r = o.r;
  const table = h('table', { class: 'table' }, h('tr', {}, h('th', {}, 'PLACE'), h('th', {}, 'COMPETITOR'), h('th', {}, 'ROUND 1'), h('th', {}, 'FINAL')));
  r.rows.forEach((row, i) => {
    const cell = h('td', { style: 'text-align:left' });
    cell.append(logoImg(row.team, 22), ` ${row.name} (${row.team.abbr})`);
    table.append(h('tr', { class: row.id === -1 ? 'you' : '' }, h('td', {}, `${i + 1}`), cell, h('td', {}, fmt(row.r1, r.unit)), h('td', {}, row.final === null ? '—' : fmt(row.final, r.unit))));
  });
  const won = o.payout > 0;
  const back = h('button', { class: 'btn primary', 'data-nav-default': '' }, 'ALL-STAR SATURDAY');
  back.onclick = () => app.show(allStarScreen(app));
  const menu = h('button', { class: 'btn' }, 'MAIN MENU');
  menu.onclick = () => app.show(menuScreen(app));
  el.append(
    h(
      'div',
      { class: 'panel', style: 'text-align:center' },
      h('div', { class: 'subtitle' }, o.info),
      h('div', { class: 'title big' }, r.place === 1 ? 'CHAMPION' : `${ordinal(r.place)} PLACE`),
      h('div', { class: `payout ${won ? 'win' : 'lose'}` }, won ? `+${fmtCredits(o.payout)} CR` : 'NO RETURN'),
      h('div', { class: 'muted' }, `STAKE ${fmtCredits(o.bet)} · MULTIPLIER ${o.mult.toFixed(2)}x${r.tiebreak ? ' · DECIDED BY TIEBREAKER' : ''}`),
    ),
    h('div', { class: 'panel', style: 'overflow-x:auto' }, table),
    h('div', { class: 'row', style: 'justify-content:center' }, back, menu),
    h('div', { class: 'panel' }, fairnessBlock(o.hash)),
  );
  if (won) audio.cash();
  return { el, keepReel: true };
}
