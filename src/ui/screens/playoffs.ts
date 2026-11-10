import { App, h, type Screen } from '../../app/app.ts';
import { casino, fmtCredits } from '../../app/casino.ts';
import { store, type PlayoffSave } from '../../app/store.ts';
import { TEAMS, teamById, type TeamDef } from '../../data/teams.ts';
import { PLAYOFF_LADDER, PLAYOFF_ROUND_NAMES } from '../../core/casino/paytables.ts';
import { Rng } from '../../core/rng.ts';
import { betPanel, teamCard, topbar, fairnessBlock } from '../common.ts';
import { gameScreen } from './game.ts';
import { resultsScreen } from './results.ts';
import { menuScreen } from './menu.ts';
import { audio } from '../../engine/audio.ts';

/** Standard 8-team seeding: 1v8, 4v5, 3v6, 2v7 so 1 and 2 can only meet in the final. */
const PAIRS = [
  [0, 7],
  [3, 4],
  [2, 5],
  [1, 6],
];

export function playoffsScreen(app: App): Screen {
  const save = store.data.playoffs;
  if (save && !save.finished) return bracketScreen(app, save);
  return setupScreen(app);
}

function setupScreen(app: App): Screen {
  const el = h('div', { class: 'screen fade-in' });
  let mine: TeamDef = teamById(store.data.favTeam);
  app.showTeam(mine);
  const grid = h('div', { class: 'grid' });
  const bet = betPanel({ label: 'ENTRY STAKE' });
  const ladder = h('div', { class: 'row' }, ...PLAYOFF_LADDER.map((m, i) => h('div', { class: `chip${i === 3 ? ' gold' : ''}` }, i === 0 ? 'OUT IN QF: 0x' : i === 3 ? `CHAMPION: ${m}x` : `${['', 'REACH SF', 'REACH FINAL'][i]}: ${m}x`)));
  const start = h('button', { class: 'btn primary', 'data-nav-advance': '' }, 'ENTER THE PLAYOFFS');
  const render = () => {
    grid.innerHTML = '';
    for (const t of TEAMS) {
      const c = teamCard(t, t === mine);
      c.onclick = () => {
        audio.click();
        mine = t;
        store.data.favTeam = t.id;
        store.save();
        app.showTeam(t);
        render();
      };
      grid.append(c);
    }
    (start as HTMLButtonElement).disabled = !casino.canBet(bet.bet);
  };
  start.onclick = () => {
    if (!casino.canBet(bet.bet)) return;
    audio.click();
    const ticket = casino.placeBet('playoffs', bet.bet, { team: mine.id });
    const rng = new Rng(`bracket:${ticket.id}`);
    const others = rng.shuffle(TEAMS.filter((t) => t !== mine)).slice(0, 7);
    const field = [mine, ...others].sort((a, b) => b.ovr - a.ovr);
    const save: PlayoffSave = { ticket, teamId: mine.id, bracket: field.map((t) => t.id), results: [], roundsWon: 0, finished: false };
    store.data.playoffs = save;
    store.save();
    app.show(bracketScreen(app, save));
  };
  el.append(
    topbar('PLAYOFFS', () => app.show(menuScreen(app))),
    h('div', { class: 'subtitle' }, 'CHOOSE YOUR TEAM · 8-TEAM BRACKET · SINGLE ELIMINATION'),
    grid,
    h('div', { class: 'panel' }, h('h3', {}, 'PRIZE LADDER'), ladder, h('div', { class: 'muted', style: 'font-size:13px;margin:6px 0' }, 'Cash out between rounds at the current ladder value, or play on for the championship.'), bet.el, start),
  );
  render();
  bet.el.addEventListener('click', () => render());
  return { el };
}

/** Simulated result between two bot teams. */
function simGame(rng: Rng, a: TeamDef, b: TeamDef): { winner: TeamDef; score: [number, number] } {
  const pA = 1 / (1 + Math.exp(-(a.ovr - b.ovr) / 6));
  const aWins = rng.chance(pA);
  const base = rng.int(88, 118);
  const margin = rng.int(2, 18);
  return aWins ? { winner: a, score: [base + margin, base] } : { winner: b, score: [base, base + margin] };
}

function roundTeams(save: PlayoffSave, round: number): [string, string][] {
  const ids = save.bracket;
  if (round === 0) return PAIRS.map(([i, j]) => [ids[i], ids[j]]);
  const prev = roundTeams(save, round - 1);
  const winners = prev.map(([a, b]) => save.results.find((r) => r.round === round - 1 && ((r.home === a && r.away === b) || (r.home === b && r.away === a)))?.winner ?? null);
  const out: [string, string][] = [];
  for (let i = 0; i < winners.length; i += 2) out.push([winners[i] ?? '?', winners[i + 1] ?? '?']);
  return out;
}

/** Ensure all bot-vs-bot games in a round are resolved. */
function resolveBotGames(save: PlayoffSave, round: number) {
  const rng = new Rng(`sim:${save.ticket.id}:${round}`);
  for (const [a, b] of roundTeams(save, round)) {
    if (a === '?' || b === '?') continue;
    if (a === save.teamId || b === save.teamId) continue;
    if (save.results.some((r) => r.round === round && r.home === a && r.away === b)) continue;
    const g = simGame(rng, teamById(a), teamById(b));
    save.results.push({ round, home: a, away: b, winner: g.winner.id, score: g.score });
  }
}

function bracketScreen(app: App, save: PlayoffSave): Screen {
  app.startReel();
  const el = h('div', { class: 'screen fade-in' });
  const mine = teamById(save.teamId);
  const ticket = save.ticket;
  if (ticket.outcome.kind !== 'playoffs') throw new Error('bad ticket');
  const outcome = ticket.outcome;
  const round = save.roundsWon;
  resolveBotGames(save, round);
  store.save();
  const myPair = roundTeams(save, round).find(([a, b]) => a === save.teamId || b === save.teamId);
  const oppId = myPair ? (myPair[0] === save.teamId ? myPair[1] : myPair[0]) : null;
  const opp = oppId && oppId !== '?' ? teamById(oppId) : null;

  const bracket = h('div', { class: 'bracket' });
  for (let r = 0; r < 3; r++) {
    const col = h('div', { class: 'round' }, h('h4', {}, PLAYOFF_ROUND_NAMES[r]));
    for (const [a, b] of roundTeams(save, r)) {
      const res = save.results.find((x) => x.round === r && ((x.home === a && x.away === b) || (x.home === b && x.away === a)));
      const line = (id: string) => {
        const t = id === '?' ? null : teamById(id);
        const w = res && res.winner === id;
        const score = res ? (res.home === id ? res.score[0] : res.score[1]) : '';
        return h('div', { class: `${w ? 'w' : ''} ${id === save.teamId ? 'you' : ''}` }, h('span', {}, t ? `${t.abbr} (${t.ovr})` : 'TBD'), h('span', {}, String(score)));
      };
      col.append(h('div', { class: 'mu' }, line(a), line(b)));
    }
    bracket.append(col);
  }
  const champ = save.results.find((x) => x.round === 2)?.winner;
  const ladderCol = h('div', { class: 'round ladder' }, h('h4', {}, 'LADDER'));
  PLAYOFF_LADDER.forEach((m, i) => ladderCol.append(h('div', { class: i === round ? 'you' : '' }, h('span', {}, i === 0 ? 'Out in QF' : i === 3 ? 'Champion' : `Reach ${['', 'SF', 'Final'][i]}`), h('span', {}, `${m}x`))));
  if (champ) ladderCol.append(h('div', { class: 'w' }, h('span', {}, 'CHAMPION'), h('span', {}, teamById(champ).abbr)));
  bracket.append(ladderCol);

  const actions = h('div', { class: 'row' });
  const cashValue = PLAYOFF_LADDER[round] * ticket.bet;
  if (opp) {
    const play = h('button', { class: 'btn primary' }, `PLAY ${PLAYOFF_ROUND_NAMES[round].toUpperCase()} VS ${opp.abbr}`);
    play.onclick = () => {
      audio.click();
      playRound(app, save, mine, opp, round);
    };
    actions.append(play);
    if (round > 0) {
      const cash = h('button', { class: 'btn success' }, `CASH OUT ${fmtCredits(cashValue)} CR`);
      cash.onclick = () => {
        audio.click();
        save.finished = true;
        store.save();
        const entry = casino.settle(ticket, PLAYOFF_LADDER[round], `Cashed out after ${round} round${round > 1 ? 's' : ''}`);
        app.show(
          resultsScreen(app, {
            title: 'CASHED OUT',
            teams: [mine, opp],
            scores: [0, 0],
            payout: entry.payout,
            bet: ticket.bet,
            multiplier: PLAYOFF_LADDER[round],
            fairnessHash: ticket.fairnessHash,
            actions: [{ label: 'MAIN MENU', primary: true, onClick: () => app.show(menuScreen(app)) }],
          }),
        );
      };
      actions.append(cash);
    }
  }
  const strip = `${mine.city.toUpperCase()} ${mine.name.toUpperCase()} · SEED ${save.bracket.indexOf(save.teamId) + 1} · STAKE ${fmtCredits(ticket.bet)} CR`;
  el.append(topbar('PLAYOFFS', () => app.show(menuScreen(app))), h('div', { class: 'subtitle' }, strip), h('div', { class: 'panel' }, bracket), actions, h('div', { class: 'panel' }, fairnessBlock(ticket.fairnessHash)));
  void outcome;
  return { el, keepReel: true };
}

function playRound(app: App, save: PlayoffSave, mine: TeamDef, opp: TeamDef, round: number) {
  const ticket = save.ticket;
  if (ticket.outcome.kind !== 'playoffs') return;
  const script = ticket.outcome.scripts[round] ?? ticket.outcome.scripts[ticket.outcome.scripts.length - 1];
  const higherSeed = save.bracket.indexOf(mine.id) < save.bracket.indexOf(opp.id);
  app.show(
    gameScreen(app, {
      matchOptions: { teams: [mine, opp], script, quarterLength: store.data.settings.quarterLength, homeIndex: higherSeed ? 0 : 1, seed: `po:${ticket.id}:${round}` },
      strip: `${PLAYOFF_ROUND_NAMES[round].toUpperCase()} · ${mine.abbr} vs ${opp.abbr} · WIN TO REACH ${round < 2 ? PLAYOFF_ROUND_NAMES[round + 1].toUpperCase() : 'THE TITLE'}`,
      onFinish: (r) => {
        save.results.push({ round, home: mine.id, away: opp.id, winner: r.userWon ? mine.id : opp.id, score: r.scores });
        if (r.userWon) {
          save.roundsWon = round + 1;
          if (save.roundsWon >= 3) {
            save.finished = true;
            store.save();
            const entry = casino.settle(ticket, PLAYOFF_LADDER[3], `CHAMPIONS! ${mine.abbr} beat ${opp.abbr} ${r.scores[0]}-${r.scores[1]}`);
            app.show(
              resultsScreen(app, {
                title: 'CHAMPIONS',
                teams: [mine, opp],
                scores: r.scores,
                match: r.match,
                payout: entry.payout,
                bet: ticket.bet,
                multiplier: PLAYOFF_LADDER[3],
                fairnessHash: ticket.fairnessHash,
                lines: ['Grand prize paid at 10x the entry stake.'],
                actions: [{ label: 'MAIN MENU', primary: true, onClick: () => app.show(menuScreen(app)) }],
              }),
            );
            return;
          }
          store.save();
          app.show(
            resultsScreen(app, {
              title: `${PLAYOFF_ROUND_NAMES[round].toUpperCase()} WON`,
              teams: [mine, opp],
              scores: r.scores,
              match: r.match,
              payout: 0,
              bet: ticket.bet,
              multiplier: PLAYOFF_LADDER[save.roundsWon],
              fairnessHash: ticket.fairnessHash,
              lines: [`Current ladder value ${fmtCredits(PLAYOFF_LADDER[save.roundsWon] * ticket.bet)} CR. Cash out or play on from the bracket.`],
              actions: [{ label: 'TO THE BRACKET', primary: true, onClick: () => app.show(playoffsScreen(app)) }],
            }),
          );
        } else {
          save.finished = true;
          store.save();
          const mult = PLAYOFF_LADDER[round];
          const entry = casino.settle(ticket, mult, `Eliminated in ${PLAYOFF_ROUND_NAMES[round]} by ${opp.abbr}`);
          app.show(
            resultsScreen(app, {
              title: 'ELIMINATED',
              teams: [mine, opp],
              scores: r.scores,
              match: r.match,
              payout: entry.payout,
              bet: ticket.bet,
              multiplier: mult,
              fairnessHash: ticket.fairnessHash,
              actions: [
                { label: 'NEW RUN', primary: true, onClick: () => app.show(playoffsScreen(app)) },
                { label: 'MAIN MENU', onClick: () => app.show(menuScreen(app)) },
              ],
            }),
          );
        }
      },
      onQuit: () => {
        save.finished = true;
        store.save();
        casino.settle(ticket, 0, `Forfeited in ${PLAYOFF_ROUND_NAMES[round]}`);
        app.show(menuScreen(app));
      },
    }),
  );
}
