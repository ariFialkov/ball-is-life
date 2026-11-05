import { App, h, type Screen } from '../../app/app.ts';
import { casino, fmtCredits } from '../../app/casino.ts';
import { store } from '../../app/store.ts';
import { TEAMS, teamById, type TeamDef } from '../../data/teams.ts';
import { quickGameOdds } from '../../core/casino/paytables.ts';
import { betPanel, teamCard, topbar } from '../common.ts';
import { gameScreen } from './game.ts';
import { resultsScreen } from './results.ts';
import { menuScreen } from './menu.ts';
import { audio } from '../../engine/audio.ts';
import type { RoundTicket } from '../../core/casino/types.ts';

export function quickGameScreen(app: App): Screen {
  const el = h('div', { class: 'screen fade-in' });
  let mine: TeamDef = teamById(store.data.favTeam);
  let opp: TeamDef = TEAMS.find((t) => t.id !== mine.id)!;
  let step: 'mine' | 'opp' = 'mine';
  app.showTeam(mine);

  const grid = h('div', { class: 'grid' });
  const stepLabel = h('div', { class: 'subtitle' }, 'CHOOSE YOUR TEAM');
  const oddsEl = h('div', { class: 'odds' }, '');
  const payoutEl = h('div', { class: 'muted' }, '');
  const bet = betPanel({ onChange: () => refreshOdds() });
  const start = h('button', { class: 'btn primary' }, 'PLACE BET & TIP OFF');
  const next = h('button', { class: 'btn' }, 'NEXT: PICK OPPONENT ›');
  const info = h('div', { class: 'panel' });

  const refreshOdds = () => {
    const f = quickGameOdds(mine.ovr, opp.ovr);
    oddsEl.textContent = `${f.toFixed(2)} : 1`;
    payoutEl.textContent = `Win pays ${fmtCredits(bet.bet * (1 + f))} CR on a ${fmtCredits(bet.bet)} CR stake · ${mine.abbr} (${mine.ovr}) vs ${opp.abbr} (${opp.ovr}) @ ${opp.arena.name}`;
    (start as HTMLButtonElement).disabled = !casino.canBet(bet.bet);
  };
  const renderGrid = () => {
    grid.innerHTML = '';
    for (const t of TEAMS) {
      const sel = step === 'mine' ? t === mine : t === opp;
      const card = teamCard(t, sel);
      if (step === 'opp' && t === mine) card.classList.add('disabled');
      card.onclick = () => {
        audio.click();
        if (step === 'mine') {
          mine = t;
          store.data.favTeam = t.id;
          store.save();
          if (opp === mine) opp = TEAMS.find((x) => x !== mine)!;
        } else opp = t;
        app.showTeam(t);
        renderGrid();
        refreshOdds();
        renderInfo(t);
      };
      grid.append(card);
    }
  };
  const renderInfo = (t: TeamDef) => {
    info.innerHTML = '';
    const starters = t.roster.slice(0, 5);
    const table = h('table', { class: 'table' });
    table.append(h('tr', {}, h('th', {}, `${t.city} ${t.name} · ${t.arena.name} (${t.arena.capacity.toLocaleString()})`), h('th', {}, 'POS'), h('th', {}, 'OVR'), h('th', {}, '3PT'), h('th', {}, 'DNK'), h('th', {}, 'DEF')));
    for (const p of starters) table.append(h('tr', {}, h('td', {}, `#${p.number} ${p.name}`), h('td', {}, p.pos), h('td', {}, String(p.ratings.ovr)), h('td', {}, String(p.ratings.three)), h('td', {}, String(p.ratings.dunk)), h('td', {}, String(p.ratings.def))));
    info.append(h('h3', {}, 'STARTING FIVE'), h('div', { style: 'overflow-x:auto' }, table));
  };
  next.onclick = () => {
    audio.click();
    step = 'opp';
    stepLabel.textContent = 'CHOOSE YOUR OPPONENT';
    next.style.display = 'none';
    start.style.display = '';
    app.showTeam(opp);
    renderGrid();
    renderInfo(opp);
  };
  start.style.display = 'none';
  start.onclick = () => {
    audio.click();
    if (!casino.canBet(bet.bet)) return;
    const ticket = casino.placeBet('quick', bet.bet, { userOvr: mine.ovr, oppOvr: opp.ovr, mine: mine.id, opp: opp.id });
    launchQuickGame(app, ticket, mine, opp);
  };
  const betBox = h('div', { class: 'panel' }, h('h3', {}, 'MONEYLINE'), h('div', { class: 'row' }, oddsEl, h('div', { class: 'grow' }, payoutEl)), bet.el, h('div', { class: 'row' }, next, start));
  el.append(topbar('QUICK GAME', () => app.show(menuScreen(app))), stepLabel, grid, betBox, info);
  renderGrid();
  refreshOdds();
  renderInfo(mine);
  return { el };
}

export function launchQuickGame(app: App, ticket: RoundTicket, mine: TeamDef, opp: TeamDef) {
  if (ticket.outcome.kind !== 'quick') throw new Error('bad ticket');
  const f = ticket.outcome.fractionalOdds;
  app.show(
    gameScreen(app, {
      matchOptions: { teams: [mine, opp], script: ticket.outcome.script, quarterLength: store.data.settings.quarterLength, homeIndex: 1, seed: `quick:${ticket.id}` },
      strip: `QUICK GAME · ${fmtCredits(ticket.bet)} CR @ ${f.toFixed(2)}:1 · WIN PAYS ${fmtCredits(ticket.bet * (1 + f))}`,
      onFinish: (r) => {
        // Settle on the on-court result (the director guarantees it matches the ticket).
        const mult = r.userWon ? 1 + f : 0;
        const entry = casino.settle(ticket, mult, `${mine.abbr} ${r.scores[0]}-${r.scores[1]} ${opp.abbr}`);
        app.show(
          resultsScreen(app, {
            title: r.userWon ? 'YOU WIN' : 'DEFEAT',
            teams: [mine, opp],
            scores: r.scores,
            match: r.match,
            payout: entry.payout,
            bet: ticket.bet,
            multiplier: mult,
            fairnessHash: ticket.fairnessHash,
            actions: [
              { label: 'RUN IT BACK', primary: true, onClick: () => app.show(quickGameScreen(app)) },
              { label: 'MAIN MENU', onClick: () => app.show(menuScreen(app)) },
            ],
          }),
        );
      },
      onQuit: () => {
        casino.settle(ticket, 0, `Forfeit vs ${opp.abbr}`);
        app.show(menuScreen(app));
      },
    }),
  );
}
