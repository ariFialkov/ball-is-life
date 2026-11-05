import { App, h, type Screen } from '../../app/app.ts';
import { casino, fmtCredits } from '../../app/casino.ts';
import { store } from '../../app/store.ts';
import { TEAMS, teamById, makeCareerPlayer, type PlayerDef, type TeamDef } from '../../data/teams.ts';
import { CONTEST_PAYTABLES } from '../../core/casino/paytables.ts';
import { betPanel, fairnessBlock, logoImg, topbar } from '../common.ts';
import { threePointContest, type ContestResult } from '../../contests/three.ts';
import { dunkContest } from '../../contests/dunk.ts';
import { skillsContest } from '../../contests/skills.ts';
import { menuScreen } from './menu.ts';
import { audio } from '../../engine/audio.ts';
import { Rng } from '../../core/rng.ts';
import type { RoundTicket } from '../../core/casino/types.ts';

type ContestId = 'three' | 'dunk' | 'skills';

const CONTESTS: { id: ContestId; name: string; blurb: string; rating: keyof PlayerDef['ratings'] }[] = [
  { id: 'three', name: '3-POINT CONTEST', blurb: '5 racks · 25 balls · 60 seconds · money balls worth 2', rating: 'three' },
  { id: 'dunk', name: 'DUNK CONTEST', blurb: '2 dunks · nail the takeoff and the slam · 5 judges', rating: 'dunk' },
  { id: 'skills', name: 'SKILLS CHALLENGE', blurb: 'Slalom · pass · layup · three · fastest time wins', rating: 'speed' },
];

export function allStarScreen(app: App): Screen {
  app.startReel();
  const el = h('div', { class: 'screen fade-in' });
  let contest: ContestId = 'three';
  const team = teamById(store.data.favTeam);
  const bet = betPanel({ label: 'ENTRY STAKE' });
  const cards = h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(240px,1fr))' });
  const pay = h('div', { class: 'row' });
  const enter = h('button', { class: 'btn primary' }, 'ENTER CONTEST');
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
    pay.append(h('div', { class: 'chip gold' }, `1ST: ${pt[0]}x`), h('div', { class: 'chip' }, `2ND: ${pt[1]}x`), h('div', { class: 'chip' }, '3RD / 4TH: 0x'));
    (enter as HTMLButtonElement).disabled = !casino.canBet(bet.bet);
  };
  enter.onclick = () => {
    if (!casino.canBet(bet.bet)) return;
    audio.click();
    const ticket = casino.placeBet(contest, bet.bet, { team: team.id });
    runContest(app, ticket, contest, team);
  };
  el.append(
    topbar('ALL-STAR WEEKEND', () => app.show(menuScreen(app))),
    h('div', { class: 'subtitle' }, `REPRESENTING ${team.city.toUpperCase()} ${team.name.toUpperCase()} · CHANGE TEAM IN QUICK GAME`),
    cards,
    h('div', { class: 'panel' }, h('h3', {}, 'PAYOUT · 4 COMPETITORS'), pay, h('div', { class: 'muted', style: 'font-size:13px;margin:6px 0' }, 'You go first. Three league stars follow. Finish first or second to cash.'), bet.el, enter),
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
  const bots = pickBots(contest, team, `bots:${ticket.id}`);
  const name = store.data.playerName || 'You';
  const player = makeCareerPlayer(name, contest === 'dunk' ? 'SF' : contest === 'three' ? 'SG' : 'PG');
  player.number = 7;
  const strip = `${CONTESTS.find((c) => c.id === contest)!.name} · STAKE ${fmtCredits(ticket.bet)} CR · 1ST PAYS ${fmtCredits(ticket.bet * outcome.paytable[0])}`;
  const onFinish = (r: ContestResult) => {
    const lowerIsBetter = contest === 'skills';
    const rows = [{ name, team, score: r.userScore, you: true }, ...bots.map((b, i) => ({ name: b.def.name, team: b.team, score: r.botScores[i], you: false }))];
    rows.sort((a, b) => (lowerIsBetter ? a.score - b.score : b.score - a.score) || (a.you ? -1 : 1));
    const place = rows.findIndex((x) => x.you) + 1;
    const mult = outcome.paytable[place - 1] ?? 0;
    const entry = casino.settle(ticket, mult, `${CONTESTS.find((c) => c.id === contest)!.name}: ${place}${['st', 'nd', 'rd', 'th'][place - 1]} (${r.userScore}${r.unit})`);
    app.show(contestResults(app, { rows, place, payout: entry.payout, bet: ticket.bet, mult, hash: ticket.fairnessHash, unit: r.unit }));
  };
  const common = { team, player, bots, botsAbove: outcome.botsAbove, strip, seed: `contest:${ticket.id}`, onFinish };
  if (contest === 'three') app.show(threePointContest(app, common));
  else if (contest === 'dunk') app.show(dunkContest(app, common));
  else app.show(skillsContest(app, common));
}

function contestResults(app: App, o: { rows: { name: string; team: TeamDef; score: number; you: boolean }[]; place: number; payout: number; bet: number; mult: number; hash: string; unit: string }): Screen {
  app.startReel();
  const el = h('div', { class: 'screen center fade-in' });
  const table = h('table', { class: 'table' }, h('tr', {}, h('th', {}, 'PLACE'), h('th', {}, 'COMPETITOR'), h('th', {}, 'SCORE')));
  o.rows.forEach((r, i) => {
    const cell = h('td', { style: 'text-align:left' });
    cell.append(logoImg(r.team, 22), ` ${r.name} (${r.team.abbr})`);
    table.append(h('tr', { class: r.you ? 'you' : '' }, h('td', {}, `${i + 1}`), cell, h('td', {}, `${r.score}${o.unit}`)));
  });
  const won = o.payout > 0;
  const back = h('button', { class: 'btn primary' }, 'ALL-STAR HUB');
  back.onclick = () => app.show(allStarScreen(app));
  const menu = h('button', { class: 'btn' }, 'MAIN MENU');
  menu.onclick = () => app.show(menuScreen(app));
  el.append(
    h('div', { class: 'panel', style: 'text-align:center' }, h('div', { class: 'subtitle' }, 'FINAL STANDINGS'), h('div', { class: 'title big' }, `${o.place}${['ST', 'ND', 'RD', 'TH'][o.place - 1]} PLACE`), h('div', { class: `payout ${won ? 'win' : 'lose'}` }, won ? `+${fmtCredits(o.payout)} CR` : 'NO RETURN'), h('div', { class: 'muted' }, `STAKE ${fmtCredits(o.bet)} · MULTIPLIER ${o.mult.toFixed(2)}x`)),
    h('div', { class: 'panel' }, table),
    h('div', { class: 'row', style: 'justify-content:center' }, back, menu),
    h('div', { class: 'panel' }, fairnessBlock(o.hash)),
  );
  if (won) audio.cash();
  return { el, keepReel: true };
}
