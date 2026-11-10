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
| **My Career** | One contract stake. Create your player (first and last name), start on the bench and get subbed in for your "moments" (the stretches you sit are simulated, so you never watch live play from the bench; if the game goes to overtime you play all of it). Every game is graded F to A+ from your real stat line, judged for your position and how far into your career you are; good grades earn incentive bonuses and more minutes. | The career pays exactly the ticket, reached through what happens to it: injuries, contract calls, locker-room fallout, trades when you have banked more; extensions, shoe deals and retirement tours when you have banked less. |
| **Playoffs** | Entry stake into an 8-team single-elimination bracket. | Ladder: out in QF 0x · reach SF 1.2x · reach Final 3x · Champion 10x. Cash out between rounds at the current ladder value. |
| **All-Star** | Entry stake into the 3-Point Contest, Slam Dunk Contest or Skills Challenge against three league stars, in the real formats (a first round, then a final). You go first in every round; the bots go after. | Champion 3x (dunk 4x), runner-up 1.5x (dunk 1.2x). |

Twelve fictional teams with full 13-man rosters, procedural crests, home/away kits, arenas and play styles live in `src/data/teams.ts`.

## How the betting layer works

Everything about money is decided by `src/core/casino/engine.ts` **before** a round starts, from `hash(serverSeed, clientSeed, nonce)`:

1. **Paytables** (`paytables.ts`) describe the *shape* of each mode's prize distribution. At resolution time the winning probabilities are scaled so that `Σ p_i × payout_i = RTP` exactly; the remaining mass is the losing outcome. Changing the RTP therefore never changes the feel of a mode, only how often it pays.
2. **Match scripts**: for every game the engine draws win/lose, a final margin and a 16-point Brownian-bridge *margin trajectory* with lead changes. For career games it also draws the user's target stat line and minutes share; for contests it draws the user's finishing place.
3. **The Director** (`src/match/director.ts`) runs inside every live match. It compares the live margin with the scripted trajectory and continuously tunes bot make-probabilities, steal/interception rates and rebounding. Early on the gain is low, so games feel loose and the player's inputs matter; late in the game the gain rises and, if the scripted winner is not in front, "force" mode makes the bots convert everything (or nothing) and press for steals so the user cannot stall the clock. In career mode the same loop steers teammates to feed (or freeze out) the user to land the scripted stat line. Contests are turn-based: the user plays first in every round, then the bots' results are steered (relative to what the user actually scored) to land above or below per the ticket, including who reaches the final (`src/contests/plan.ts`).
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
| Lob pass / Block on D / Rebound off the ball | R / I | Triangle | Y | LOB / BLOCK / JUMP |
| Call a screen (with the ball) / Set a screen (off it, standing still) | F | L1 | LB | SCREEN |
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

**Pick and roll.** With the ball, L1 / LB / F calls the nearest big up to set a ball screen on your defender; come off their shoulder and they read it: roll to the rim, pop out for a jumper, or clear the lane (bigs who can finish roll more, shooters pop, a hedge or a switch opens the roll, a crowded paint says pop). Off the ball, standing still, the same button sets a screen yourself; an AI ball handler will use it. Screeners are planted: a defender who runs into one gets hung up, and defenses sometimes switch. AI teams run their own pick and rolls.

**Passing and rebounding.** Passes lead the receiver: they are aimed where the receiver will be, and keep leading them in flight. Your player gets a little extra reach on passes thrown to them and on rebounds (2K-style catch assist); rebounding reach also grows with height and with Triangle to jump, and a bot you have sealed behind you rarely beats you to the ball.

**Catch and shoot.** Hold Shoot while a pass is on its way and the jumper starts the moment you catch it; a press during the catch works too.

**Possession rules.** Out-of-bounds balls go against whoever touched the ball last, including deflections: a defender who pokes the ball loose, tips a pass or fumbles a loose ball gets the blame, and a block counts as the blocker's touch. Once the ball handler crosses half court the offense cannot take the ball back over it (backcourt violation), and it has 8 seconds to get it across. A shot or a defensive touch resets both.

**Boundaries and inbounds.** A soft wall along the lines holds the ball handler in bounds; only sprinting straight at the line for about a third of a second breaks through, and stepping on or over the line with the ball is a turnover. Every dead ball is restarted with a real throw-in from out of bounds. After a made basket the player nearest the ball inbounds from the baseline to the point guard (automatic, like 2K). After a violation, the ball going out, and at the start of each period, the small forward inbounds; on your own team's throw-ins you pick the pass yourself (Cross for a chest pass, Circle bounce, Triangle lob; aim with the stick). The clocks stay stopped until the throw-in is touched.

## Tech

- Vite + TypeScript + three.js. No external 3D assets: players are procedurally rigged primitives with analytic animation (idle, run, dribble, defense, jump shot, layup, dunk, pass, block, steal, celebrate) blended in real time; court, crests, jerseys and ball are canvas textures; crowd is an instanced mesh with a vertex-shader bob.
- Kinetic motion: bodies react to the forces on them, sensed from how each player actually moves. They lean forward into acceleration from the ankles. When braking they brace their legs out in front while the hips flex to keep the chest tall. In a curl the hips shift over the inside leg and that knee sinks to take the load, with the legs angled so the feet stay planted. On a hard cut they plant the outside foot and turn their shoulders and eyes into the new direction. When they arrive from a run to spot up they hop-stop and sink. The head and torso stay level side to side: no part of the frame rolls into a turn, and the spine takes out the pelvis's stride rotation so a leaning torso doesn't swing with each step. The forces go through springs that settle cleanly instead of snapping.
- The dribble is physics (`src/engine/dribble.ts`): the hand pushes the ball down from rest, lets go, the ball falls under gravity, bounces and rises, and the hand meets it on the way up and cushions it to a stop. The tempo comes out of the dribble height and the push (a low, hard dribble is quicker). The arm reaches the ball with two-bone IK so the palm stays on it through the push and the catch, and once the ball is in the air it keeps its own momentum: on a hard cut it carries on the old way and the hand goes and gets it.
- Ball physics: ballistic flight with rim (torus), backboard and floor collisions; scripted makes get a soft rim, scripted misses a realistic rattle-out.
- 2K-style camera behind the offense (flips with possession) plus a broadcast camera and a cinematic multi-shot reel that plays an all-bot game behind the main menu with a film-grain/scanline/decal overlay.
- PWA: `public/manifest.json` + `public/sw.js` (app-shell precache, stale-while-revalidate runtime cache, installable on iOS/Android/desktop). Fullscreen, safe-area aware, portrait and landscape.
- Procedural WebAudio SFX (bounces, swish, rim, buzzer, crowd reactions on big plays; no constant background bed) with no audio files.

### Debug / test hooks

`?debug=1` shows the director telemetry in the HUD. `?autopilot=ai` lets the bots drive the controlled player, `?autopilot=stall` makes the controlled player hold the ball and run (an adversarial test of the director), `?speed=N` runs N simulation steps per frame. `window.__match` exposes the live match.

## All-Star Saturday

All three contests are physics-based: every shot, pass and dunk is a real ball flight through the same rim, backboard and net collisions as the games, with no assists. `tests/contest.physics.test.ts` checks that clean releases go in from every contest spot and that the bots' planned misses never do.

- **3-Point Contest** (current NBA format): 70 seconds; five racks around the arc, each with four 1-point balls and a 2-point money ball; one all-money rack of your choice; two 3-point deep balls between the wings and the top of the key; 40 points maximum. Hold Shoot and release in the green; several balls can be in the air at once. Top 3 go to the final round.
- **Slam Dunk Contest**: two dunks a round, up to three attempts each, five judges scoring 6-10. Pick a dunk (two-hand, tomahawk, windmill, baseline reverse, 360, between the legs, free-throw line), press Shoot to take off as the ring closes and again to slam as you reach the rim. Takeoff spot and slam timing decide where the ball leaves your hand, and the rim decides the rest. Top 2 go to the final.
- **Skills Challenge** (classic course): weave the chairs on the arrow side, hit the chest-pass target, make a layup at the far basket, then dribble back to the top of the key and make a three. Every pass and shot must go in before you move on. Fastest 2 go to the final.

Bot turns can be watched at speed or skipped (Cross / A / Enter, or the SKIP button).

### Not implemented (yet)

Fouls and free throws, substitutions/fatigue outside career moments, and online multiplayer. The betting layer is a demo with local credits.
