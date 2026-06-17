# Arena of Aetherfall — a miniature WoW-inspired bot battler

A 2–3 player browser game: each player builds a champion (pick a class, gear
it up from the shop, spend talent points), then everyone's bots fight each
other automatically in a shared arena while you watch, chat, and plan your
next round of upgrades. Gold and levels carry forward forever — the room
just keeps running round after round.

## What's inside

- **6 classes** (Warrior, Mage, Paladin, Hunter, Rogue, Warlock), each with
  4 unique abilities and class-appropriate AI behavior (kiting casters,
  aggressive melee, smart defensive-cooldown usage, etc).
- **Shop** — 17 items across weapons/armor/trinkets, gated by class.
- **Talent trees** — 9 talents per class (Offense / Defense / Mastery × 3
  tiers), 3 ranks each.
- **Live canvas arena** — particle effects, blood, slashes, projectiles,
  crowd-control icons, floating combat text, and a continuous day in the
  life of a gladiator pit (braziers, blood stains that build up over a
  round).
- **In-room chat**, persistent across phases.
- **A room-code system** — host an arena, share a 4-character code, up to
  3 players join as combatants and anyone after that joins as a spectator.
- **Reconnection-safe** — refreshing the page or dropping Wi-Fi doesn't
  lose your bot; you rejoin the same seat with the same gold/level/gear.
- **Continuous game loop** — prep (shop+talents) → battle → results →
  prep → … forever, with "match point" banners every 3 round-wins.

## Project layout

```
server.js              Express + Socket.IO server, all socket event routing
src/Bot.js              Bot stat model: leveling, talents, items, status effects
src/CombatEngine.js     Tick-based AI combat simulation (the actual "fight")
src/GameRoom.js         Room lifecycle: lobby → prep → battle → results loop
public/index.html       App shell
public/css/style.css    Dark-fantasy arena theme (Cinzel/Inter/JetBrains Mono)
public/js/gameData.js   Shared data: classes, abilities, shop items, talents
                         (loaded by both the server via require() and the
                         browser via <script> — keep these in sync!)
public/js/arenaRenderer.js   Canvas rendering + animation/particle system
public/js/ui.js         All DOM rendering (lobby, roster, shop, talents, chat)
public/js/app.js        Socket wiring, identity/reconnection, screen control
test/logicTest.js       Pure server-logic tests (no network) incl. stress tests
test/e2eTest.js         Full end-to-end test: real server + real socket clients
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
npm test            # runs both suites below
npm run test:logic  # bot/combat/room logic — no network, includes
                     # max-level/full-talent/full-gear stress simulations
npm run test:e2e    # spins up the real server and drives it with real
                     # socket.io-client connections through the full game
                     # loop: lobby, shop, talents, battle, reconnection,
                     # spectators, chat, error handling
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
  dynamically from that data.
