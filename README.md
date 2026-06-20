# Arena of Aetherfall — a miniature WoW-inspired bot battler

A 2–3 player browser game: each player builds a champion (pick a class, gear
it up from the shop, spend talent points), then everyone's bots fight each
other automatically in a shared arena while you watch, chat, and plan your
next round of upgrades. A game runs for 5 rounds (or until the host ends it
early), then shows final standings and lets the host start a fresh game.

## What's inside

- **6 classes** (Warrior, Mage, Paladin, Hunter, Rogue, Warlock), each with
  4 unique abilities.
- **FFNN-driven targeting AI** — bots pick targets using a small feedforward
  neural network (real weighted layers + nonlinear activation, forward pass
  every decision tick) instead of a fixed "always attack lowest HP" rule.
  See the honesty note in `src/NeuralTargeting.js` for exactly what this is
  and isn't.
- **Shop** — 17 fixed items across weapons/armor/trinkets, gated by class.
- **Real talent trees** — 9 talents per class (Offense / Defense / Mastery ×
  3 tiers), 3 ranks each, with classic-WoW-style tier gating (you must fully
  invest in a tier before the next one unlocks) and a free respec option.
- **Loot crates & world-drop rolls** — every round, the winner opens a
  personal crate and everyone can roll Need/Greed-style on a shared
  world-drop item. Both are procedurally generated with random stats,
  rarity (Common → Uncommon → Rare → Epic → Legendary), and item level
  scaled to the arena's average level.
- **Live canvas arena** — particle effects, blood, slashes, projectiles,
  crowd-control icons, floating combat text, and a continuous day in the
  life of a gladiator pit (braziers, blood stains that build up over a
  round).
- **In-room chat**, persistent across phases.
- **A room-code system** — host an arena, share a 4-character code, up to
  3 players join as combatants and anyone after that joins as a spectator.
- **Reconnection-safe** — refreshing the page or dropping Wi-Fi doesn't
  lose your bot; you rejoin the same seat with the same gold/level/gear.
- **Bounded game loop** — prep → battle → results → loot → prep → … for
  5 rounds by default, then a Game Over screen with final standings. The
  host can also end the game early at any time, and start a new one
  afterward (fresh gold/level/gear for everyone).

## Project layout

```
server.js                   Express + Socket.IO server, all socket event routing
src/Bot.js                  Bot stat model: leveling, talents, items, status effects
src/CombatEngine.js         Tick-based AI combat simulation (the actual "fight")
src/NeuralTargeting.js      Small FFNN that scores/selects combat targets
src/LootGenerator.js        Procedural rarity-tiered loot item generation
src/GameRoom.js             Room lifecycle: lobby → prep → battle → roundEnd → loot → … → gameOver
public/index.html           App shell
public/css/style.css        Dark-fantasy arena theme (Cinzel/Inter/JetBrains Mono)
public/js/gameData.js       Shared data: classes, abilities, shop items, talents,
                              rarity tiers (loaded by both the server via require()
                              and the browser via <script> — keep these in sync!)
public/js/arenaRenderer.js  Canvas rendering + animation/particle system
public/js/ui.js             All DOM rendering (lobby, roster, shop, talents,
                              loot overlay, game-over screen, chat)
public/js/app.js            Socket wiring, identity/reconnection, screen control
test/logicTest.js           Pure server-logic tests (no network) incl. stress tests,
                              balance regression checks, FFNN sanity checks
test/clientUiTest.js        jsdom test that runs the real ui.js against realistic
                              server payloads (built from real Bot/GameRoom
                              instances) and checks nothing throws
test/e2eTest.js             Full end-to-end test: real server + real socket clients
```

## Running locally

```bash
npm install
npm start
# open http://localhost:3000 in two or three browser tabs/windows
```

For auto-restart on file changes during development: `npm run dev`.

## Testing

```bash
npm test            # runs all three suites below
npm run test:logic  # bot/combat/room logic — no network, includes
                     # max-level/full-talent/full-gear stress simulations,
                     # balance regression checks, FFNN behavior checks
npm run test:ui      # jsdom: executes the actual ui.js against realistic
                     # state payloads for every phase, checks nothing throws
npm run test:e2e    # spins up the real server and drives it with real
                     # socket.io-client connections through the full game
                     # loop: lobby, shop, talents, battle, loot/rolling,
                     # reconnection, spectators, chat, host controls,
                     # game-over + play-again, error handling
```

Run these after making any changes — especially to `GameRoom.js` or
`CombatEngine.js` — before deploying.

## Deploying to Railway from GitHub

1. **Push this project to a GitHub repo.**
   ```bash
   cd arena-battler
   git init
   git add .
   git commit -m "Initial commit: Arena of Aetherfall"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

2. **Create a Railway project.**
   - Go to [railway.com](https://railway.com/) and sign in.
   - Click **New Project → Deploy from GitHub repo**.
   - Select your repo. Railway will detect the Node app automatically via
     Nixpacks (no Dockerfile needed) and use the `railway.toml` in this
     repo, which sets the start command to `node server.js`.

3. **No environment variables are required to run.** Railway sets `PORT`
   automatically and the server reads it (`process.env.PORT`). If you want
   to tune phase timings, you can optionally set:
   - `ARENA_PREP_MS` — shop/talent phase length in ms (default `45000`)
   - `ARENA_ROUND_END_MS` — results-screen length in ms (default `7000`)
   - `ARENA_LOOT_MS` — loot/roll phase length in ms (default `14000`)
   - `ARENA_MAX_ROUNDS` — rounds per game before Game Over (default `5`)

4. **Generate a public domain.** In the Railway project's service settings,
   under **Networking**, click **Generate Domain**. You'll get a URL like
   `https://your-app.up.railway.app` — that's the link you share with
   friends.

5. **Play.** Open the link, one person clicks **Host New Arena**, shares
   the 4-character code shown at the top of the room panel, and the other
   1–2 people click **Join With Code**.

Every push to your GitHub branch will trigger Railway to redeploy
automatically.

### A note on persistence

Room state (gold, levels, gear, chat) lives in server memory for as long
as the room has at least one connected player or spectator, plus a short
grace window after everyone leaves. Redeploys or server restarts on
Railway will clear all active rooms — that's normal for this kind of
lightweight real-time app and keeps the hosting free of a database
dependency. If you want progress to survive restarts/deploys, the next
step would be adding a small persistence layer (e.g., Railway's Postgres
plugin) keyed by player ID — `src/GameRoom.js` is the only place that
would need to change.

## Tuning / extending

- **Balance**: all class stats, ability numbers, and AI rotations live in
  `public/js/gameData.js`. Nothing else hardcodes balance numbers.
- **New abilities**: add an entry to `ABILITIES`, reference it in a class's
  `abilities` array and in that class's `AI_PROFILES.rotation`, and
  `CombatEngine.js`'s `_castAbility` will handle it automatically as long
  as it matches one of the existing `type`s (`melee`, `projectile`, `aoe`,
  `aoe_ranged`, `dot`, `channel`, `buff`, `defensive`, `heal`, `cc`,
  `gap_closer`).
- **New shop items / talents**: just add entries to `SHOP_ITEMS` /
  `TALENT_TREES` in `gameData.js` — the shop and talent UI render
  dynamically from that data. Talent tier-gating is computed automatically
  from each talent's `tier` field (no extra config needed).
- **Loot tuning**: rarity weights, stat budgets, and naming parts all live
  in `RARITY_TIERS` / `LOOT_NAME_PARTS` / `LOOT_STAT_POOL` in
  `gameData.js`; the generation logic itself is in `src/LootGenerator.js`.
- **AI targeting**: `src/NeuralTargeting.js` has hand-authored weight
  matrices, not ones trained on match data (there's no training pipeline in
  this project). If you want to actually train it, you'd need to log
  (features, outcome) pairs from real matches and add an offline training
  script — the forward-pass architecture is already there to plug weights
  into.

## Patch notes — this round of changes

Based on first playtest feedback:

- **Games now end.** Default 5 rounds per game, then a Game Over screen
  with final standings. The host can also end the game early at any time
  via the "End Game" button, and start a fresh game afterward (everyone's
  gold/level/gear resets) via "Play Again."
- **Fixed the XP imbalance bug.** The reward formula used to add a flat
  bonus per raw point of damage dealt, uncapped. Combined with magic damage
  having zero armor mitigation (only physical did), caster classes could
  rack up damage numbers 2–3x higher than melee for comparable performance,
  letting that bonus swamp the placement-based reward entirely — which is
  almost certainly why XP felt disconnected from placement. Fixed two ways:
  magic/fire/shadow/nature damage now gets partial armor mitigation (holy
  stays unmitigated), and the damage-based bonus is now a bounded
  *share-of-total-damage-in-the-fight* rather than an unbounded raw number.
- **Smarter, less scripted bot AI.** Target selection now runs through a
  small feedforward neural network (see `src/NeuralTargeting.js`) instead
  of a fixed "always go for lowest HP, 85% sticky" rule, with
  temperature-based sampling instead of strict best-pick — so the same
  starting matchup won't always play out identically round after round.
- **Combat rebalancing.** Toned down the worst burst multipliers (Arcane
  Blast, Chaos Bolt, Aimed Shot, Backstab), lowered the crit multiplier
  from a flat 2x to 1.6x, and added the magic-damage mitigation above —
  together these should stop the "one ability deletes someone" feeling.
  Buffed Paladin's survivability and self-healing. This was tuned against
  ~800 simulated round-robin fights for a rough balance pass, but 6-class
  3-way balance is hard to fully nail through simulation alone — please
  flag anything that still feels off after a playtest and it can be tuned
  further.
- **Real talent trees**, not a flat list — tiers now gate on investment
  in earlier tiers (classic WoW shape), with a visible lock state and a
  free respec button.
- **Loot crates and Need/Greed-style rolling**, replacing pure shop-only
  gearing — see "What's inside" above.
