import { App, h, type Screen } from '../../app/app.ts';
import { casino, fmtCredits } from '../../app/casino.ts';
import { store, type CareerSave } from '../../app/store.ts';
import { TEAMS, teamById, makeCareerPlayer, type Position, type TeamDef } from '../../data/teams.ts';
import { betPanel, fairnessBlock, teamCard, topbar } from '../common.ts';
import { gameScreen } from './game.ts';
import { resultsScreen, boxScore } from './results.ts';
import { menuScreen } from './menu.ts';
import { audio } from '../../engine/audio.ts';
import { Rng } from '../../core/rng.ts';

const GRADES = ['F', 'D', 'C', 'B', 'A', 'A+'];
const GRADE_COLORS = ['#ff5c5c', '#ff9a3d', '#ffd166', '#9df22a', '#38ff7a', '#7dffff'];

export function careerScreen(app: App): Screen {
  const save = store.data.career;
  if (save) return hubScreen(app, save);
  return createScreen(app);
}

function createScreen(app: App): Screen {
  const el = h('div', { class: 'screen fade-in' });
  let team: TeamDef = teamById(store.data.favTeam);
  let pos: Position = 'PG';
  app.showTeam(team);
  const name = h('input', { type: 'text', placeholder: 'Your name', maxlength: '22', value: store.data.playerName }) as HTMLInputElement;
  const posRow = h('div', { class: 'toggle' });
  const renderPos = () => {
    posRow.innerHTML = '';
    for (const p of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[]) {
      const b = h('button', { class: `btn small${p === pos ? ' active' : ''}` }, p);
      b.onclick = () => {
        audio.click();
        pos = p;
        renderPos();
      };
      posRow.append(b);
    }
  };
  renderPos();
  const grid = h('div', { class: 'grid' });
  const bet = betPanel({ label: 'CONTRACT STAKE' });
  const sign = h('button', { class: 'btn primary' }, 'SIGN ROOKIE CONTRACT');
  const render = () => {
    grid.innerHTML = '';
    for (const t of TEAMS) {
      const c = teamCard(t, t === team);
      c.onclick = () => {
        audio.click();
        team = t;
        store.data.favTeam = t.id;
        store.save();
        app.showTeam(t);
        render();
      };
      grid.append(c);
    }
    (sign as HTMLButtonElement).disabled = !casino.canBet(bet.bet);
  };
  sign.onclick = () => {
    if (!casino.canBet(bet.bet)) return;
    audio.click();
    const playerName = name.value.trim() || 'Rookie Prospect';
    store.data.playerName = playerName;
    const ticket = casino.placeBet('career', bet.bet, { team: team.id, pos, name: playerName });
    const save: CareerSave = { ticket, playerName, pos, teamId: team.id, gamesPlayed: 0, log: [], earned: 0 };
    store.data.career = save;
    store.save();
    app.show(hubScreen(app, save));
  };
  el.append(
    topbar('MY CAREER', () => app.show(menuScreen(app))),
    h('div', { class: 'panel' }, h('h3', {}, 'CREATE YOUR PLAYER'), h('div', { class: 'row' }, h('div', { class: 'grow' }, name), posRow)),
    h('div', { class: 'subtitle' }, 'CHOOSE YOUR TEAM'),
    grid,
    h(
      'div',
      { class: 'panel' },
      h('h3', {}, 'THE CONTRACT'),
      h('div', { class: 'muted', style: 'font-size:13px;margin-bottom:8px' }, 'You start on the bench and get subbed in for your moments. Play well and your minutes grow. Every game earns a performance bonus (F to A+) paid as a multiple of your stake. The career ends with retirement, a career-ending injury, or getting cut. Bonuses are paid out when the career ends; retire early to collect what you have earned.'),
      bet.el,
      sign,
    ),
  );
  render();
  bet.el.addEventListener('click', () => render());
  return { el };
}

function opponentFor(save: CareerSave, gameIndex: number): TeamDef {
  const rng = new Rng(`career-opp:${save.ticket.id}:${gameIndex}`);
  const others = TEAMS.filter((t) => t.id !== save.teamId);
  return others[(gameIndex * 5 + rng.int(0, 2)) % others.length];
}

function hubScreen(app: App, save: CareerSave): Screen {
  app.startReel();
  const el = h('div', { class: 'screen fade-in' });
  const ticket = save.ticket;
  if (ticket.outcome.kind !== 'career') throw new Error('bad ticket');
  const outcome = ticket.outcome;
  const team = teamById(save.teamId);
  const player = makeCareerPlayer(save.playerName, save.pos);
  const totals = save.log.reduce((a, g) => ({ pts: a.pts + g.pts, ast: a.ast + g.ast, reb: a.reb + g.reb }), { pts: 0, ast: 0, reb: 0 });
  const n = Math.max(1, save.log.length);
  const over = save.gamesPlayed >= outcome.games.length;
  const card = h(
    'div',
    { class: 'panel' },
    h('div', { class: 'row between' }, h('div', {}, h('div', { class: 'subtitle' }, `${team.city} ${team.name}`), h('div', { class: 'title big' }, save.playerName), h('div', { class: 'muted' }, `${save.pos} · ${player.height.toFixed(2)}m · ${player.ratings.ovr} OVR · AGE ${player.age + save.gamesPlayed}`)), h('div', { style: 'text-align:right' }, h('div', { class: 'subtitle' }, 'CAREER AVERAGES'), h('div', { class: 'balance' }, `${(totals.pts / n).toFixed(1)} PPG`), h('div', { class: 'muted' }, `${(totals.ast / n).toFixed(1)} APG · ${(totals.reb / n).toFixed(1)} RPG · ${save.gamesPlayed} GP`))),
  );
  const log = h('table', { class: 'table' }, h('tr', {}, h('th', {}, 'GAME'), h('th', {}, 'RESULT'), h('th', {}, 'PTS'), h('th', {}, 'AST'), h('th', {}, 'REB'), h('th', {}, 'GRADE'), h('th', {}, 'BONUS')));
  save.log.forEach((g, i) => {
    log.append(h('tr', {}, h('td', {}, `#${i + 1} vs ${opponentFor(save, i).abbr}`), h('td', {}, `${g.win ? 'W' : 'L'} ${g.score[0]}-${g.score[1]}`), h('td', {}, String(g.pts)), h('td', {}, String(g.ast)), h('td', {}, String(g.reb)), h('td', { style: `color:${GRADE_COLORS[g.grade]};font-weight:900` }, GRADES[g.grade]), h('td', {}, `${fmtCredits(g.bonus * ticket.bet)} CR`)));
  });
  const earned = save.log.reduce((a, g) => a + g.bonus, 0);
  const next = outcome.games[save.gamesPlayed];
  const actions = h('div', { class: 'row' });
  if (!over && next) {
    const opp = opponentFor(save, save.gamesPlayed);
    const play = h('button', { class: 'btn primary' }, `PLAY GAME ${save.gamesPlayed + 1} VS ${opp.abbr}`);
    play.onclick = () => {
      audio.click();
      playCareerGame(app, save, team, opp, save.gamesPlayed);
    };
    actions.append(play);
    const retire = h('button', { class: 'btn ghost' }, `RETIRE NOW · COLLECT ${fmtCredits(earned * ticket.bet)} CR`);
    retire.onclick = () => {
      if (!confirm('Retire now and collect the bonuses earned so far?')) return;
      finishCareer(app, save, 'retired', earned);
    };
    actions.append(retire);
  }
  const minutes = next ? `${Math.round(next.minutesShare * 100)}% of the minutes` : '—';
  el.append(
    topbar('MY CAREER', () => app.show(menuScreen(app))),
    card,
    h('div', { class: 'panel' }, h('h3', {}, 'GAME LOG'), save.log.length ? h('div', { style: 'overflow-x:auto' }, log) : h('div', { class: 'muted' }, 'No games yet. The coach has you pencilled in for limited minutes.'), h('div', { class: 'muted', style: 'margin-top:8px' }, `Contract stake ${fmtCredits(ticket.bet)} CR · Earned so far ${fmtCredits(earned * ticket.bet)} CR · Next game: ${minutes}`)),
    actions,
    h('div', { class: 'panel' }, fairnessBlock(ticket.fairnessHash)),
  );
  return { el, keepReel: true };
}

function playCareerGame(app: App, save: CareerSave, team: TeamDef, opp: TeamDef, index: number) {
  const ticket = save.ticket;
  if (ticket.outcome.kind !== 'career') return;
  const outcome = ticket.outcome;
  const g = outcome.games[index];
  const player = makeCareerPlayer(save.playerName, save.pos);
  app.show(
    gameScreen(app, {
      matchOptions: {
        teams: [team, opp],
        script: g.script,
        quarterLength: store.data.settings.quarterLength,
        homeIndex: index % 2 === 0 ? 0 : 1,
        seed: `career:${ticket.id}:${index}`,
        career: { player, targetPoints: g.targetPoints, targetAssists: g.targetAssists, targetRebounds: g.targetRebounds, minutesShare: g.minutesShare },
      },
      strip: `CAREER GAME ${index + 1} · ${team.abbr} vs ${opp.abbr} · ${Math.round(g.minutesShare * 100)}% MINUTES`,
      onFinish: (r) => {
        const u = r.match.userAthlete!;
        const grade = g.grade;
        save.log.push({ pts: u.stats.pts, ast: u.stats.ast, reb: u.stats.reb, grade, bonus: g.bonus, win: r.userWon, score: r.scores });
        save.gamesPlayed = index + 1;
        save.earned += g.bonus;
        store.save();
        const over = save.gamesPlayed >= outcome.games.length;
        const nextG = outcome.games[save.gamesPlayed];
        const lines = [
          `Stat line: ${u.stats.pts} PTS · ${u.stats.ast} AST · ${u.stats.reb} REB · ${u.stats.fgm}/${u.stats.fga} FG`,
          `Game bonus ${fmtCredits(g.bonus * ticket.bet)} CR (${g.bonus.toFixed(2)}x) · Career total ${fmtCredits(save.earned * ticket.bet)} CR`,
          over ? '' : nextG.minutesShare > g.minutesShare ? `Coach: "You earned more minutes." Next game ${Math.round(nextG.minutesShare * 100)}% of the floor time.` : `Coach: "Keep working." Next game ${Math.round(nextG.minutesShare * 100)}% of the floor time.`,
        ].filter(Boolean);
        const gradeEl = h('div', { class: 'grade', style: `color:${GRADE_COLORS[grade]}` }, `GRADE ${GRADES[grade]}`);
        const screen = resultsScreen(app, {
          title: r.userWon ? 'TEAM WIN' : 'TEAM LOSS',
          teams: [team, opp],
          scores: r.scores,
          match: r.match,
          payout: 0,
          bet: ticket.bet,
          multiplier: g.bonus,
          fairnessHash: ticket.fairnessHash,
          lines,
          actions: over
            ? [{ label: 'SEE WHAT HAPPENS NEXT', primary: true, onClick: () => finishCareer(app, save, outcome.endReason, save.earned) }]
            : [{ label: 'BACK TO THE LOCKER ROOM', primary: true, onClick: () => app.show(careerScreen(app)) }],
        });
        screen.el.querySelector('.payout')!.replaceWith(gradeEl);
        app.show(screen);
      },
      onQuit: () => {
        // Quitting a career game counts as a DNP with no bonus; the career continues.
        save.log.push({ pts: 0, ast: 0, reb: 0, grade: 0, bonus: 0, win: false, score: [0, 0] });
        save.gamesPlayed = index + 1;
        store.save();
        app.show(careerScreen(app));
      },
    }),
  );
}

function finishCareer(app: App, save: CareerSave, reason: 'injury' | 'retired' | 'cut', earned: number) {
  const ticket = save.ticket;
  const team = teamById(save.teamId);
  const entry = casino.settle(ticket, earned, `${save.playerName}: ${save.gamesPlayed} games, ${reason}`);
  store.data.career = null;
  store.save();
  const headline = reason === 'injury' ? 'CAREER-ENDING INJURY' : reason === 'cut' ? 'WAIVED BY THE TEAM' : 'RETIREMENT';
  const story = reason === 'injury' ? 'A torn ACL in practice. The doctors say that is it.' : reason === 'cut' ? 'The front office went in another direction.' : 'You walk away on your own terms.';
  app.show(
    resultsScreen(app, {
      title: headline,
      teams: [team, team],
      scores: [save.log.filter((g) => g.win).length, save.log.filter((g) => !g.win).length],
      payout: entry.payout,
      bet: ticket.bet,
      multiplier: earned,
      fairnessHash: ticket.fairnessHash,
      lines: [story, `${save.gamesPlayed} games · ${save.log.reduce((a, g) => a + g.pts, 0)} career points · contract bonuses ${fmtCredits(entry.payout)} CR`],
      actions: [
        { label: 'NEW CAREER', primary: true, onClick: () => app.show(careerScreen(app)) },
        { label: 'MAIN MENU', onClick: () => app.show(menuScreen(app)) },
      ],
    }),
  );
}

export { boxScore };
