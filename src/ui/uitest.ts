/**
 * Test-only screen jumps for layout checks (?uitest): show screens that are normally deep in a
 * flow with sample data. Not reachable in normal play.
 */
import type { App } from '../app/app.ts';
import { TEAMS } from '../data/teams.ts';
import { resultsScreen } from './screens/results.ts';
import { contestResults } from './screens/allstar.ts';
import { storyScreen } from './screens/career.ts';
import { menuScreen } from './screens/menu.ts';
import type { CareerSave } from '../app/store.ts';

export function installUiTest(app: App) {
  const back = () => app.show(menuScreen(app));
  (window as any).__testScreens = {
    results: () =>
      app.show(
        resultsScreen(app, {
          title: 'TEAM WIN',
          teams: [TEAMS[0], TEAMS[1]],
          scores: [104, 98],
          payout: 25.1,
          bet: 10,
          multiplier: 2.51,
          fairnessHash: '8c4ea32c69fa903d78133b0061157514a8f2',
          lines: ['Grand prize paid at 10x the entry stake.', 'Current ladder value 30 CR.'],
          actions: [
            { label: 'PLAY AGAIN', primary: true, onClick: back },
            { label: 'MAIN MENU', onClick: back },
          ],
        }),
      ),
    contestres: () =>
      app.show(
        contestResults(app, {
          r: {
            rows: TEAMS.slice(0, 4).map((t, i) => ({ id: i === 1 ? -1 : i, name: t.roster[0].name, team: t, r1: 30 - i * 2, final: i < 2 ? 28 - i : null })),
            place: 2,
            unit: 'PTS',
            higherBetter: true,
            tiebreak: false,
          },
          info: '3-POINT CONTEST',
          payout: 15,
          bet: 10,
          mult: 1.5,
          hash: '8c4ea32c69fa903d78133b0061157514',
        }),
      ),
    story: () => {
      const save = { first: 'Marcus', last: 'Okonkwo', playerName: 'Marcus Okonkwo', gamesPlayed: 3 } as unknown as CareerSave;
      app.show(storyScreen(app, save, { title: 'EXTENSION OFFER', text: 'The front office wants to keep you. Your agent brings two structures.', choices: [{ label: '4 years, fully guaranteed', outcome: 'You sign.' }, { label: '2 years plus incentives', outcome: 'You bet on yourself.' }] }, back, 'SEE THE FINAL CONTRACT'));
    },
  };
}
