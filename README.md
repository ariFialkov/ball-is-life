# Ball is Life

A 3D basketball betting game in the style of the modern NBA 2K menus and gameplay, built as an installable PWA that runs on desktop and mobile. Every round is a bet. The front end plays like a skill-based sports game; the backend resolves every round as a strictly deterministic, RTP-controlled betting game and the on-court bots are steered to reproduce that result.

**Play it:** https://arifialkov.github.io/ball-is-life/ (auto-deployed from `main` by `.github/workflows/deploy-pages.yml`)

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
npm test           # RTP audit + determinism tests (vitest)
npm run server     # optional reference backend exposing the outcome engine over HTTP
```

Demo credits only. The game starts you with 1,000 CR; Settings has a `+1000 DEMO` button.

## Game modes

| Mode | Bet | Payout |
| --- | --- | --- |
| **Quick Game** | Moneyline on your team. Fractional odds from 1:1 to 2.5:1 depending on the rating gap between the two teams. | Win pays `bet × (1 + odds)`. |
| **My Career** | One contract stake. You start on the bench and get subbed in for your "moments"; play well and your minutes grow. Each game earns a performance bonus (grade F to A+). | Bonuses accumulate and pay when the career ends by retirement, career-ending injury or being cut. Retire early to collect what you have banked. |
| **Playoffs** | Entry stake into an 8-team single-elimination bracket. | Ladder: out in QF 0x · reach SF 1.2x · reach Final 3x · Champion 10x. Cash out between rounds at the current ladder value. |
| **All-Star** | Entry stake into the 3-Point Contest, Dunk Contest or Skills Challenge against three league stars. You go first; the bots go after. | 1st 3x (dunk 4x), 2nd 1.5x (dunk 1.2x). |

Twelve fictional teams with full 13-man rosters, procedural crests, home/away kits, arenas and play styles live in `src/data/teams.ts`.

## How the betting layer works

Everything about money is decided by `src/core/casino/engine.ts` **before** a round starts, from `hash(serverSeed, clientSeed, nonce)`:

1. **Paytables** (`paytables.ts`) describe the *shape* of each mode's prize distribution. At resolution time the winning probabilities are scaled so that `Σ p_i × payout_i = RTP` exactly; the remaining mass is the losing outcome. Changing the RTP therefore never changes the feel of a mode, only how often it pays.
2. **Match scripts**: for every game the engine draws win/lose, a final margin and a 16-point Brownian-bridge *margin trajectory* with lead changes. For career games it also draws the user's target stat line and minutes share; for contests it draws the user's finishing place.
3. **The Director** (`src/match/director.ts`) runs inside every live match. It compares the live margin with the scripted trajectory and continuously tunes bot make-probabilities, steal/interception rates and rebounding. Early on the gain is low, so games feel loose and the player's inputs matter; late in the game the gain rises and, if the scripted winner is not in front, "force" mode makes the bots convert everything (or nothing) and press for steals so the user cannot stall the clock. In career mode the same loop steers teammates to feed (or freeze out) the user to land the scripted stat line. Contests are turn-based: the user plays first and the bots' scores are placed above or below per the ticket.
4. **Settlement**: quick game and playoff rounds settle on the on-court result (the director guarantees it matches the ticket; a `directorMisses` counter is exposed for monitoring). Career and contests settle on the ticket.
5. **Provably fair**: the hash of `serverSeed:nonce` is shown before every round and the seed is revealed in the ledger after settlement (Settings → Round Ledger verifies it client-side).

### Configuring the RTP

Settings → Operator lets you set the RTP (80–99%), the server seed and the bet limits. `npm run rtp:audit` Monte-Carlos 200k tickets per mode and asserts the realised return matches the configured RTP (tests in `tests/rtp.audit.test.ts`).

The engine uses only erasable TypeScript syntax, so the same file runs in Node without a build step. `server/server.mjs` is a reference backend (`POST /api/round`, `GET /api/reveal/:nonce`, `POST /api/operator`). The PWA ships with the engine embedded (`src/app/casino.ts`) so it works fully offline; swapping that facade for `fetch('/api/round')` moves resolution server-side without touching the game.

## Controls (2K layout)

| | Keyboard | PlayStation | Xbox | Touch |
| --- | --- | --- | --- | --- |
| Move | WASD | Left stick | Left stick | Left stick |
| Sprint | Shift | R2 | RT | SPRINT (hold) |
| Shoot (hold, release in the green) / Steal on D | Space / J | Square | X | SHOOT / STEAL |
| Pass / Switch on D / Call for the ball off it | E / K | Cross | A | PASS / SWITCH / CALL |
| Bounce pass | Q / L | Circle | B | |
| Lob pass / Block on D | R / I | Triangle | Y | LOB / BLOCK |
| Dribble moves (skill stick) | Arrow keys | Right stick | Right stick | Swipe on the right side |
| Pause | Esc / P | Options | Menu | II |
| Menus | Arrows, Enter, Esc | D-pad or left stick, Cross, Circle | D-pad or left stick, A, B | Tap |

Dribble moves are read relative to the way the ball handler faces:

| Skill stick | Move |
| --- | --- |
| Forward | Hesitation (stop, then explode) |
| Sideways, away from the ball | Crossover |
| Sideways, toward the ball | Spin |
| Back-diagonal, away from the ball | Between the legs |
| Back-diagonal, toward the ball | Behind the back |
| Straight back | Step-back |

The ball really changes hands: crossovers bounce in front, between-the-legs under the body and behind-the-back behind it, and the handler also switches hands on their own when driving to the other side. Chained moves are more likely to freeze a defender; a defender reaching from the ball side gets more steals than one reaching across the body.

Near the rim, Shoot triggers a layup or dunk automatically. On offense the controlled player follows the ball; on defense it auto-switches to the man guarding the ball and can be switched manually.

**Boundaries and inbounds.** A soft wall along the lines holds the ball handler in bounds; only sprinting straight at the line for about a third of a second breaks through, and stepping on or over the line with the ball is a turnover. Every dead ball is restarted with a real throw-in from out of bounds. After a made basket the player nearest the ball inbounds from the baseline to the point guard (automatic, like 2K). After a violation, the ball going out, and at the start of each period, the small forward inbounds; on your own team's throw-ins you pick the pass yourself (Cross for a chest pass, Circle bounce, Triangle lob; aim with the stick). The clocks stay stopped until the throw-in is touched.

## Tech

- Vite + TypeScript + three.js. No external 3D assets: players are procedurally rigged primitives with analytic animation (idle, run, dribble, defense, jump shot, layup, dunk, pass, block, steal, celebrate) blended in real time; court, crests, jerseys and ball are canvas textures; crowd is an instanced mesh with a vertex-shader bob.
- Ball physics: ballistic flight with rim (torus), backboard and floor collisions; scripted makes get a soft rim, scripted misses a realistic rattle-out.
- 2K-style camera behind the offense (flips with possession) plus a broadcast camera and a cinematic multi-shot reel that plays an all-bot game behind the main menu with a film-grain/scanline/decal overlay.
- PWA: `public/manifest.json` + `public/sw.js` (app-shell precache, stale-while-revalidate runtime cache, installable on iOS/Android/desktop). Fullscreen, safe-area aware, portrait and landscape.
- Procedural WebAudio SFX (bounces, swish, rim, buzzer, crowd bed) with no audio files.

### Debug / test hooks

`?debug=1` shows the director telemetry in the HUD. `?autopilot=ai` lets the bots drive the controlled player, `?autopilot=stall` makes the controlled player hold the ball and run (an adversarial test of the director), `?speed=N` runs N simulation steps per frame. `window.__match` exposes the live match.

### Not implemented (yet)

Fouls and free throws, substitutions/fatigue outside career moments, and online multiplayer. The betting layer is a demo with local credits.
