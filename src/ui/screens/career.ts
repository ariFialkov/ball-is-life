import { App, h, type Screen } from '../../app/app.ts';
import { casino, fmtCredits } from '../../app/casino.ts';
import { store, type CareerGameLog, type CareerSave } from '../../app/store.ts';
import { TEAMS, teamById, makeCareerPlayer, type Position, type TeamDef } from '../../data/teams.ts';
import { betPanel, fairnessBlock, teamCard, topbar } from '../common.ts';
import { gameScreen } from './game.ts';
import { resultsScreen } from './results.ts';
import { menuScreen } from './menu.ts';
import { audio } from '../../engine/audio.ts';
import { Rng } from '../../core/rng.ts';
import { GRADES, afterGame, gameBonus, gradeGame, injuryThisGame, nextMinutes, type CareerState, type NegativeKind, type PositiveKind } from '../../career/progress.ts';

const GRADE_COLORS = ['#ff5c5c', '#ff9a3d', '#ffd166', '#9df22a', '#38ff7a', '#7dffff'];

export function careerScreen(app: App): Screen {
  const save = store.data.career;
  if (save) return hubScreen(app, migrate(save));
  return createScreen(app);
}

/** Older saves predate the split name, minutes, events and the full stat line. */
function migrate(save: CareerSave): CareerSave {
  if (!save.first || !save.last) {
    const parts = (save.playerName || 'Rookie Player').trim().split(/\s+/);
    save.first = save.first || parts[0];
    save.last = save.last || parts.slice(1).join(' ') || 'Player';
  }
  save.minutes ??= 0.4;
  save.events ??= [];
  save.midEventDone ??= false;
  for (const g of save.log) {
    g.stl ??= 0;
    g.blk ??= 0;
    g.fgm ??= 0;
    g.fga ??= 0;
    g.tpm ??= 0;
    g.tpa ??= 0;
    g.to ??= 0;
    g.min ??= 0;
    g.opp ??= '';
    g.notes ??= [];
  }
  return save;
}

function fullName(save: CareerSave) {
  return `${save.first} ${save.last}`;
}

function pct(m: number, a: number) {
  return a ? `${Math.round((m / a) * 100)}%` : '—';
}

// ---------------------------------------------------------------------------
// Create a player

function createScreen(app: App): Screen {
  const el = h('div', { class: 'screen fade-in' });
  let team: TeamDef = teamById(store.data.favTeam);
  let pos: Position = 'PG';
  app.showTeam(team);
  const first = h('input', { type: 'text', placeholder: 'First name', maxlength: '14', value: store.data.playerFirst ?? '', autocomplete: 'off' }) as HTMLInputElement;
  const last = h('input', { type: 'text', placeholder: 'Last name', maxlength: '16', value: store.data.playerLast ?? '', autocomplete: 'off' }) as HTMLInputElement;
  const hint = h('div', { class: 'muted', style: 'font-size:12px' }, 'Both names are required: they go on your jersey, the box score and every call.');
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
  const valid = () => first.value.trim().length >= 1 && last.value.trim().length >= 2;
  const refresh = () => {
    (sign as HTMLButtonElement).disabled = !casino.canBet(bet.bet) || !valid();
    hint.style.color = valid() ? '' : '#ffd166';
  };
  first.oninput = refresh;
  last.oninput = refresh;
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
    refresh();
  };
  sign.onclick = () => {
    if (!casino.canBet(bet.bet) || !valid()) return;
    audio.click();
    const f = cap(first.value.trim());
    const l = cap(last.value.trim());
    store.data.playerFirst = f;
    store.data.playerLast = l;
    store.data.playerName = `${f} ${l}`;
    const ticket = casino.placeBet('career', bet.bet, { team: team.id, pos, name: `${f} ${l}` });
    const save: CareerSave = { ticket, playerName: `${f} ${l}`, first: f, last: l, pos, teamId: team.id, gamesPlayed: 0, log: [], earned: 0, minutes: 0.4, events: [], midEventDone: false };
    store.data.career = save;
    store.save();
    app.show(hubScreen(app, save));
  };
  el.append(
    topbar('MY CAREER', () => app.show(menuScreen(app))),
    h('div', { class: 'panel' }, h('h3', {}, 'CREATE YOUR PLAYER'), h('div', { class: 'row' }, h('div', { class: 'grow' }, first), h('div', { class: 'grow' }, last), posRow), hint),
    h('div', { class: 'subtitle' }, 'CHOOSE YOUR TEAM'),
    grid,
    h(
      'div',
      { class: 'panel' },
      h('h3', {}, 'THE CONTRACT'),
      h(
        'div',
        { class: 'muted', style: 'font-size:13px;margin-bottom:8px' },
        'You start on the bench and get subbed in for your moments. Every game is graded on what you actually do, judged for your position and how far into your career you are: a quiet night is fine for a rookie, not for a veteran. Good grades earn incentive bonuses and more minutes. Careers end the way careers do: injuries, contract calls, trades, retirement. Your bonuses are paid when it ends.',
      ),
      bet.el,
      sign,
    ),
  );
  render();
  bet.el.addEventListener('click', () => refresh());
  return { el };
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function opponentFor(save: CareerSave, gameIndex: number): TeamDef {
  const rng = new Rng(`career-opp:${save.ticket.id}:${gameIndex}`);
  const others = TEAMS.filter((t) => t.id !== save.teamId);
  return others[(gameIndex * 5 + rng.int(0, 2)) % others.length];
}

function careerState(save: CareerSave): CareerState {
  const o = save.ticket.outcome;
  if (o.kind !== 'career') throw new Error('bad ticket');
  return { total: o.totalMultiplier, maxGames: o.games.length, played: save.gamesPlayed, banked: save.earned, midEventDone: save.midEventDone };
}

// ---------------------------------------------------------------------------
// Locker room (hub)

function hubScreen(app: App, save: CareerSave): Screen {
  app.startReel();
  const el = h('div', { class: 'screen fade-in' });
  const ticket = save.ticket;
  if (ticket.outcome.kind !== 'career') throw new Error('bad ticket');
  const team = teamById(save.teamId);
  const player = makeCareerPlayer(save.first, save.last, save.pos);
  const tot = save.log.reduce(
    (a, g) => ({ pts: a.pts + g.pts, ast: a.ast + g.ast, reb: a.reb + g.reb, stl: a.stl + g.stl, blk: a.blk + g.blk, fgm: a.fgm + g.fgm, fga: a.fga + g.fga, tpm: a.tpm + g.tpm, tpa: a.tpa + g.tpa }),
    { pts: 0, ast: 0, reb: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0 },
  );
  const n = Math.max(1, save.log.length);
  const card = h(
    'div',
    { class: 'panel' },
    h(
      'div',
      { class: 'row between' },
      h('div', {}, h('div', { class: 'subtitle' }, `${team.city} ${team.name}`), h('div', { class: 'title big' }, fullName(save)), h('div', { class: 'muted' }, `${save.pos} · ${player.height.toFixed(2)}m · ${player.ratings.ovr} OVR · AGE ${player.age + save.gamesPlayed} · GAME ${save.gamesPlayed + 1}`)),
      h(
        'div',
        { style: 'text-align:right' },
        h('div', { class: 'subtitle' }, 'CAREER AVERAGES'),
        h('div', { class: 'balance' }, `${(tot.pts / n).toFixed(1)} PPG`),
        h('div', { class: 'muted' }, `${(tot.reb / n).toFixed(1)} RPG · ${(tot.ast / n).toFixed(1)} APG · ${(tot.stl / n).toFixed(1)} SPG · ${(tot.blk / n).toFixed(1)} BPG`),
        h('div', { class: 'muted' }, `FG ${pct(tot.fgm, tot.fga)} · 3PT ${pct(tot.tpm, tot.tpa)} · ${save.gamesPlayed} GP`),
      ),
    ),
  );
  const log = h(
    'table',
    { class: 'table' },
    h('tr', {}, ...['GAME', 'RESULT', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG', '3PT', 'GRADE', 'BONUS'].map((x) => h('th', {}, x))),
  );
  save.log.forEach((g, i) => {
    log.append(
      h(
        'tr',
        {},
        h('td', {}, `#${i + 1} vs ${g.opp || opponentFor(save, i).abbr}`),
        h('td', {}, `${g.win ? 'W' : 'L'} ${g.score[0]}-${g.score[1]}`),
        h('td', {}, `${Math.round(g.min * 100)}%`),
        h('td', {}, String(g.pts)),
        h('td', {}, String(g.reb)),
        h('td', {}, String(g.ast)),
        h('td', {}, String(g.stl)),
        h('td', {}, String(g.blk)),
        h('td', {}, `${g.fgm}/${g.fga}`),
        h('td', {}, `${g.tpm}/${g.tpa}`),
        h('td', { style: `color:${GRADE_COLORS[g.grade]};font-weight:900` }, GRADES[g.grade] + (g.injured ? ' (INJ)' : '')),
        h('td', {}, `${fmtCredits(g.bonus * ticket.bet)}`),
      ),
    );
  });
  const events = h('div', {});
  for (const e of save.events) events.append(h('div', { class: 'muted', style: 'font-size:13px;margin-top:4px' }, `After game ${e.afterGame}: ${e.title} · ${e.amount >= 0 ? '+' : ''}${fmtCredits(e.amount * ticket.bet)} CR`));
  const actions = h('div', { class: 'row' });
  const opp = opponentFor(save, save.gamesPlayed);
  const play = h('button', { class: 'btn primary' }, `PLAY GAME ${save.gamesPlayed + 1} VS ${opp.abbr}`);
  play.onclick = () => {
    audio.click();
    playCareerGame(app, save, team, opp, save.gamesPlayed);
  };
  actions.append(play);
  const retire = h('button', { class: 'btn ghost' }, 'RETIRE NOW');
  retire.onclick = () => {
    if (!confirm('Retire now? Your career ends and your contract settles.')) return;
    const st = careerState(save);
    endCareer(app, save, st.banked > st.total ? { neg: 'contract' } : { pos: 'retire' }, true);
  };
  actions.append(retire);
  el.append(
    topbar('MY CAREER', () => app.show(menuScreen(app))),
    card,
    h(
      'div',
      { class: 'panel' },
      h('h3', {}, 'GAME LOG'),
      save.log.length ? h('div', { style: 'overflow-x:auto' }, log) : h('div', { class: 'muted' }, 'No games yet. The coach has you pencilled in for limited minutes.'),
      events,
      h('div', { class: 'muted', style: 'margin-top:8px' }, `Contract stake ${fmtCredits(ticket.bet)} CR · Bonuses banked ${fmtCredits(save.earned * ticket.bet)} CR (paid when your career ends) · Next game: about ${Math.round(save.minutes * 100)}% of the minutes`),
    ),
    actions,
    h('div', { class: 'panel' }, fairnessBlock(ticket.fairnessHash)),
  );
  return { el, keepReel: true };
}

// ---------------------------------------------------------------------------
// A game

function playCareerGame(app: App, save: CareerSave, team: TeamDef, opp: TeamDef, index: number) {
  const ticket = save.ticket;
  if (ticket.outcome.kind !== 'career') return;
  const outcome = ticket.outcome;
  const g = outcome.games[Math.min(index, outcome.games.length - 1)];
  const player = makeCareerPlayer(save.first, save.last, save.pos);
  const rng = new Rng(`career-flow:${ticket.id}:${index}`);
  const qlen = store.data.settings.quarterLength;
  const st = careerState(save);
  // Already banked what this career pays: this could be the night it ends.
  const injuryAfter = injuryThisGame(st, () => rng.next()) ? save.minutes * qlen * 4 * rng.float(0.3, 0.75) : undefined;
  app.show(
    gameScreen(app, {
      matchOptions: {
        teams: [team, opp],
        script: g.script,
        quarterLength: qlen,
        homeIndex: index % 2 === 0 ? 0 : 1,
        seed: `career:${ticket.id}:${index}`,
        career: { player, minutesShare: save.minutes, injuryAfter },
      },
      strip: `CAREER GAME ${index + 1} · ${team.abbr} vs ${opp.abbr} · ${Math.round(save.minutes * 100)}% MINUTES`,
      onFinish: (r) => {
        const u = r.match.userAthlete!;
        const s = u.stats;
        const minutesFrac = Math.min(1, r.match.userOnCourtTime / r.match.regulation);
        const graded = gradeGame({ line: s, pos: save.pos, gameIndex: index, minutesFrac, quarterLength: qlen, teamWon: r.userWon });
        const bonus = gameBonus(graded.grade, index);
        const injured = r.match.userInjured;
        const entry: CareerGameLog = { pts: s.pts, ast: s.ast, reb: s.reb, stl: s.stl, blk: s.blk, fgm: s.fgm, fga: s.fga, tpm: s.tpm, tpa: s.tpa, to: s.to, min: minutesFrac, grade: graded.grade, bonus, win: r.userWon, score: r.scores, opp: opp.abbr, notes: graded.notes, injured };
        save.log.push(entry);
        save.gamesPlayed = index + 1;
        save.earned += bonus;
        const prevMinutes = save.minutes;
        save.minutes = nextMinutes(save.minutes, graded.grade);
        store.save();
        const next = injured ? ({ kind: 'end-negative', event: 'injury' } as const) : afterGame(careerState(save), () => rng.next());
        const lines = [
          `${s.pts} PTS · ${s.reb} REB · ${s.ast} AST · ${s.stl} STL · ${s.blk} BLK · FG ${s.fgm}/${s.fga} (${pct(s.fgm, s.fga)}) · 3PT ${s.tpm}/${s.tpa} (${pct(s.tpm, s.tpa)}) · ${Math.round(minutesFrac * 100)}% of the minutes`,
          ...graded.notes,
          `Incentive bonus ${fmtCredits(bonus * ticket.bet)} CR · Banked ${fmtCredits(save.earned * ticket.bet)} CR`,
          injured
            ? 'You went down in the game and did not return.'
            : next.kind === 'continue' || next.kind === 'boost'
              ? save.minutes > prevMinutes
                ? `Coach: "You earned more minutes." Next game about ${Math.round(save.minutes * 100)}% of the floor time.`
                : save.minutes < prevMinutes
                  ? `Coach: "That's not good enough." Next game about ${Math.round(save.minutes * 100)}% of the floor time.`
                  : `Coach: "Keep working." Next game about ${Math.round(save.minutes * 100)}% of the floor time.`
              : '',
        ].filter(Boolean);
        const gradeEl = h('div', { class: 'grade', style: `color:${GRADE_COLORS[graded.grade]}` }, `GRADE ${GRADES[graded.grade]}`);
        const after = () => {
          if (next.kind === 'continue') app.show(careerScreen(app));
          else if (next.kind === 'boost') app.show(boostScreen(app, save, next.amount));
          else if (next.kind === 'end-negative') endCareer(app, save, { neg: next.event }, false);
          else endCareer(app, save, { pos: next.event }, false);
        };
        const screen = resultsScreen(app, {
          title: r.userWon ? 'TEAM WIN' : 'TEAM LOSS',
          teams: [team, opp],
          scores: r.scores,
          match: r.match,
          payout: 0,
          bet: ticket.bet,
          multiplier: bonus,
          fairnessHash: ticket.fairnessHash,
          lines,
          actions: [{ label: next.kind === 'continue' ? 'BACK TO THE LOCKER ROOM' : 'CONTINUE', primary: true, onClick: after }],
        });
        screen.el.querySelector('.payout')!.replaceWith(gradeEl);
        app.show(screen);
      },
      onQuit: () => {
        // Walking out of a game is a DNP: no bonus, the career continues.
        save.log.push({ pts: 0, ast: 0, reb: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, to: 0, min: 0, grade: 0, bonus: 0, win: false, score: [0, 0], opp: opp.abbr, notes: ['Did not play'] });
        save.gamesPlayed = index + 1;
        save.minutes = nextMinutes(save.minutes, 0);
        store.save();
        app.show(careerScreen(app));
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Career events

interface Story {
  title: string;
  text: string;
  /** Optional decision: each choice has its own consequence text. */
  choices?: { label: string; outcome: string }[];
  outcome?: string;
}

function negativeStory(kind: NegativeKind, save: CareerSave, rng: Rng): Story {
  const team = teamById(save.teamId);
  const others = rng.shuffle(TEAMS.filter((t) => t.id !== save.teamId));
  switch (kind) {
    case 'injury':
      return { title: 'CAREER-ENDING INJURY', text: `${save.first} landed awkwardly and did not get up. The MRI confirms the worst: a torn ACL with cartilage damage, and the doctors say your playing days are over.`, outcome: 'The insurance policy pays out, but the unvested incentives lapse.' };
    case 'contract':
      return {
        title: 'CONTRACT TALKS',
        text: `Your agent has two offers from the ${team.name} front office on the table.`,
        choices: [
          { label: 'Sign the 1-year, fully guaranteed deal', outcome: 'You take the safe money. In the summer the team declines your option, no offers come, and you retire.' },
          { label: 'Bet on yourself: hold out for a multi-year deal', outcome: 'The holdout drags into the season. The team moves on, the phone stops ringing, and your career is over.' },
        ],
      };
    case 'locker':
      return { title: 'LOCKER ROOM FALLOUT', text: `A heated argument with a ${team.name} veteran spills into the press. The front office releases you and voids your unpaid incentives.`, outcome: 'Your agent negotiates a buyout. Nobody else calls.' };
    case 'waived':
      return { title: 'WAIVED', text: `Your rookie deal was non-guaranteed. The ${team.name} waive you the day before the guarantee date to clear a roster spot.`, outcome: 'Unvested incentives are forfeited; you keep the guaranteed portion and hang it up.' };
    case 'traded':
      return { title: 'TRADED. AGAIN.', text: `Traded to the ${others[0].name}, flipped to the ${others[1].name} at the deadline, then to the ${others[2].name} two days later. You never unpack.`, outcome: 'Three moves in a season is enough: you retire, and the trade kickers settle your contract.' };
  }
}

function positiveStory(kind: PositiveKind, save: CareerSave, rng: Rng): Story {
  const brands = ['Apex', 'Vanta', 'Stride', 'Kinetic', 'Halo'];
  switch (kind) {
    case 'extension':
      return {
        title: 'EXTENSION OFFER',
        text: `The ${teamById(save.teamId).name} want to keep you. Your agent brings two structures.`,
        choices: [
          { label: '4 years, fully guaranteed', outcome: 'You sign the long deal, play it out as a fan favourite and retire with the signing bonus in the bank.' },
          { label: '2 years plus incentives', outcome: 'You bet on yourself, hit the incentives, and retire on your own terms with the bonus paid in full.' },
        ],
      };
    case 'endorsement':
      return { title: 'SIGNATURE SHOE DEAL', text: `${rng.pick(brands)} signs ${fullName(save)} to a signature-shoe deal on your way out of the league.`, outcome: 'The deal pays out as you retire.' };
    case 'retire':
      return { title: 'RETIREMENT TOUR', text: `${fullName(save)} announces this is it. Every road arena gives you a send-off.`, outcome: 'Farewell-tour appearances settle the last of your contract.' };
  }
}

/** A mid-career boost (the career goes on). */
function boostScreen(app: App, save: CareerSave, amount: number): Screen {
  const rng = new Rng(`career-boost:${save.ticket.id}`);
  const title = rng.pick(['ALL-STAR VOTING BONUS', 'ENDORSEMENT DEAL', 'CONTRACT INCENTIVE HIT']);
  const text =
    title === 'ALL-STAR VOTING BONUS'
      ? `The fans vote ${fullName(save)} into the All-Star conversation and an escalator in your contract kicks in.`
      : title === 'ENDORSEMENT DEAL'
        ? `A sports drink signs ${save.last} to a national campaign.`
        : 'A games-played incentive in your rookie deal triggers early.';
  save.earned += amount;
  save.midEventDone = true;
  save.events.push({ afterGame: save.gamesPlayed, title, text, amount });
  store.save();
  return storyScreen(app, save, { title, text, outcome: `+${fmtCredits(amount * save.ticket.bet)} CR added to your banked bonuses.` }, () => app.show(careerScreen(app)), 'BACK TO THE LOCKER ROOM');
}

function storyScreen(app: App, save: CareerSave, story: Story, onDone: () => void, doneLabel: string): Screen {
  app.startReel();
  const el = h('div', { class: 'screen center fade-in' });
  const panel = h('div', { class: 'panel career-event' }, h('div', { class: 'subtitle' }, `${fullName(save).toUpperCase()} · AFTER GAME ${save.gamesPlayed}`), h('div', { class: 'title big' }, story.title), h('p', {}, story.text));
  const finish = (outcome: string) => {
    panel.querySelectorAll('.choice').forEach((b) => b.remove());
    panel.append(h('p', { class: 'muted' }, outcome));
    const go = h('button', { class: 'btn primary', 'data-nav-default': '' }, doneLabel);
    go.onclick = () => {
      audio.click();
      onDone();
    };
    panel.append(go);
  };
  if (story.choices) {
    for (const c of story.choices) {
      const b = h('button', { class: 'btn choice' }, c.label);
      b.onclick = () => {
        audio.click();
        finish(c.outcome);
      };
      panel.append(b);
    }
  } else finish(story.outcome ?? '');
  el.append(panel);
  return { el, keepReel: true };
}

/** End the career with a story, then settle it at exactly what the ticket pays. */
function endCareer(app: App, save: CareerSave, kind: { neg: NegativeKind } | { pos: PositiveKind }, voluntary: boolean) {
  const rng = new Rng(`career-end:${save.ticket.id}:${save.gamesPlayed}`);
  const story = 'neg' in kind ? negativeStory(kind.neg, save, rng) : positiveStory(kind.pos, save, rng);
  if (voluntary) {
    story.title = 'RETIREMENT';
    story.text = `${fullName(save)} calls it a career after ${save.gamesPlayed} game${save.gamesPlayed === 1 ? '' : 's'}.`;
    story.choices = undefined;
    story.outcome = 'neg' in kind ? 'Walking away early forfeits your unvested incentives.' : 'Your retirement settles the contract.';
  }
  app.show(storyScreen(app, save, story, () => settleCareer(app, save, story.title), 'SEE THE FINAL CONTRACT'));
}

function settleCareer(app: App, save: CareerSave, title: string) {
  const ticket = save.ticket;
  if (ticket.outcome.kind !== 'career') return;
  const total = ticket.outcome.totalMultiplier;
  const adjust = Math.round((total - save.earned) * 1000) / 1000;
  save.events.push({ afterGame: save.gamesPlayed, title, text: '', amount: adjust });
  const entry = casino.settle(ticket, total, `${fullName(save)}: ${save.gamesPlayed} games, ${title.toLowerCase()}`);
  store.data.career = null;
  store.save();
  const team = teamById(save.teamId);
  const wins = save.log.filter((g) => g.win).length;
  const tot = save.log.reduce((a, g) => ({ pts: a.pts + g.pts, reb: a.reb + g.reb, ast: a.ast + g.ast }), { pts: 0, reb: 0, ast: 0 });
  const incentives = save.log.reduce((a, g) => a + g.bonus, 0);
  const otherEvents = save.events.slice(0, -1).reduce((a, e) => a + e.amount, 0);
  const lines = [
    `${save.gamesPlayed} games · ${tot.pts} points · ${tot.reb} rebounds · ${tot.ast} assists`,
    `Performance incentives earned: ${fmtCredits(incentives * ticket.bet)} CR`,
    ...(otherEvents ? [`Career events: ${otherEvents >= 0 ? '+' : ''}${fmtCredits(otherEvents * ticket.bet)} CR`] : []),
    `${title}: ${adjust >= 0 ? '+' : ''}${fmtCredits(adjust * ticket.bet)} CR`,
    `Contract paid out: ${fmtCredits(entry.payout)} CR`,
  ];
  app.show(
    resultsScreen(app, {
      title,
      teams: [team, team],
      scores: [wins, save.log.length - wins],
      payout: entry.payout,
      bet: ticket.bet,
      multiplier: total,
      fairnessHash: ticket.fairnessHash,
      lines,
      actions: [
        { label: 'NEW CAREER', primary: true, onClick: () => app.show(careerScreen(app)) },
        { label: 'MAIN MENU', onClick: () => app.show(menuScreen(app)) },
      ],
    }),
  );
}
