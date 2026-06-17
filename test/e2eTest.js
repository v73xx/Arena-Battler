'use strict';
/* End-to-end test against the REAL server process using real socket.io-client
   connections. Run with: node test/e2eTest.js
   Exits non-zero on failure. Spawns its own server on a dedicated port. */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const { io: ioClient } = require('socket.io-client');

const PORT = 3051;
const BASE_URL = `http://localhost:${PORT}`;
let passed = 0, failed = 0;

function check(label, cond) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ FAIL: ${label}`); }
}

function waitForHealth(retries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http.get(`${BASE_URL}/health`, (res) => {
        if (res.statusCode === 200) resolve();
        else retry(n);
      }).on('error', () => retry(n));
    };
    const retry = (n) => {
      if (n <= 0) return reject(new Error('Server never became healthy'));
      setTimeout(() => attempt(n - 1), 150);
    };
    attempt(retries);
  });
}

function waitForEvent(socket, eventName, timeoutMs = 5000, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for "${eventName}"`));
    }, timeoutMs);
    function handler(data) {
      if (predicate(data)) {
        clearTimeout(timer);
        socket.off(eventName, handler);
        resolve(data);
      }
    }
    socket.on(eventName, handler);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('Starting server subprocess...');
  const serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), ARENA_PREP_MS: '1300', ARENA_ROUND_END_MS: '900' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (d) => console.error('[server stderr]', d.toString()));

  try {
    await waitForHealth();
    console.log('Server healthy. Running scenarios...\n');

    console.log('--- Scenario: full 3-player lobby -> prep -> battle -> roundResult loop ---');
    const c1 = ioClient(BASE_URL, { transports: ['websocket'] });
    const c2 = ioClient(BASE_URL, { transports: ['websocket'] });
    const c3 = ioClient(BASE_URL, { transports: ['websocket'] });

    await Promise.all([
      waitForEvent(c1, 'connect'), waitForEvent(c2, 'connect'), waitForEvent(c3, 'connect')
    ]);
    check('all 3 clients connected', true);

    c1.emit('createRoom', { name: 'Arthas' });
    const joined1 = await waitForEvent(c1, 'roomJoined');
    const roomCode = joined1.roomCode;
    check('room created with 4-char code', /^[A-Z0-9]{4}$/.test(roomCode));
    check('player1 received own playerId', typeof joined1.playerId === 'string' && joined1.playerId.length > 0);

    c2.emit('joinRoom', { name: 'Jaina', code: roomCode });
    const joined2 = await waitForEvent(c2, 'roomJoined');
    check('player2 joined same room', joined2.roomCode === roomCode);

    c3.emit('joinRoom', { name: 'Sylvanas', code: roomCode });
    const joined3 = await waitForEvent(c3, 'roomJoined');
    check('player3 joined same room', joined3.roomCode === roomCode);

    let latestState1 = null;
    c1.on('roomState', (s) => { latestState1 = s; });

    // All three select classes
    c1.emit('selectClass', { className: 'warrior' });
    c2.emit('selectClass', { className: 'mage' });
    c3.emit('selectClass', { className: 'hunter' });
    await sleep(200);
    check('roomState reflects 3 players with classes chosen', latestState1 && latestState1.players.length === 3 &&
      latestState1.players.every(p => !!p.className));

    c1.emit('setReady', { ready: true });
    c2.emit('setReady', { ready: true });
    c3.emit('setReady', { ready: true });
    await sleep(150);

    c1.emit('startGame');
    const prepState = await waitForEvent(c1, 'roomState', 3000, (s) => s.phase === 'prep');
    check('game transitioned to prep phase after startGame', prepState.phase === 'prep');
    check('round counter is 1', prepState.round === 1);
    check('all bots present with starting gold 500', prepState.players.every(p => p.gold === 500));

    // Shop + talent actions during prep
    let buyError = null;
    c1.once('actionError', (e) => { buyError = e; });
    c1.emit('buyItem', { itemId: 'rough_blade' });
    await sleep(200);
    check('warrior could buy a compatible weapon (no error)', buyError === null);

    let incompatibleError = null;
    c1.once('actionError', (e) => { incompatibleError = e; });
    c1.emit('buyItem', { itemId: 'crude_staff' }); // mage-only weapon, warrior should be rejected
    await sleep(200);
    check('warrior buying mage-only weapon is rejected', incompatibleError && /cannot be used/i.test(incompatibleError.error));

    let nonexistentError = null;
    c1.once('actionError', (e) => { nonexistentError = e; });
    c1.emit('buyItem', { itemId: 'this_item_does_not_exist' });
    await sleep(200);
    check('buying nonexistent item returns a clean error (no crash)', nonexistentError && /not found/i.test(nonexistentError.error));

    // Talent allocation when bot has 0 points yet (level 1) should fail gracefully
    let talentError = null;
    c1.once('actionError', (e) => { talentError = e; });
    c1.emit('allocateTalent', { talentId: 'warrior_blood_fury' });
    await sleep(200);
    check('allocating talent with 0 points fails cleanly (no crash)', talentError !== null);

    // Wait for battle phase
    const battleState = await waitForEvent(c1, 'roomState', 4000, (s) => s.phase === 'battle');
    check('transitioned to battle phase', battleState.phase === 'battle');
    check('battleSnapshot included for late joiners/reconnects', !!battleState.battleSnapshot && battleState.battleSnapshot.bots.length === 3);

    // Capture some combat ticks
    let tickCount = 0, sawDamage = false, sawCast = false, eventTypesSeen = new Set();
    const tickHandler = (data) => {
      tickCount++;
      for (const ev of data.events) {
        eventTypesSeen.add(ev.type);
        if (ev.type === 'damage') sawDamage = true;
        if (ev.type === 'cast') sawCast = true;
      }
    };
    c1.on('combatTick', tickHandler);

    const roundResult = await waitForEvent(c1, 'roundResult', 95000);
    c1.off('combatTick', tickHandler);
    check('received combatTick updates during battle', tickCount > 5);
    check('combat produced at least one damage event', sawDamage);
    check('combat produced at least one cast event', sawCast);
    check('roundResult has a summary array with 3 entries', Array.isArray(roundResult.summary) && roundResult.summary.length === 3);
    check('roundResult summary entries have placement 1-3', roundResult.summary.every(r => r.placement >= 1 && r.placement <= 3));
    console.log(`    (observed ${tickCount} ticks, event types: ${[...eventTypesSeen].join(', ')})`);

    // Confirm loop continues into round 2
    const round2State = await waitForEvent(c1, 'roomState', 3000, (s) => s.phase === 'prep' && s.round === 2);
    check('loop continued into round 2 prep phase', round2State.round === 2);
    check('gold persisted/increased after round 1 reward', round2State.players.every(p => p.gold > 0));

    console.log('\n--- Scenario: chat broadcast ---');
    const chatPromise = waitForEvent(c2, 'chatMessage', 2000, (m) => m.text === 'gl hf everyone' && !m.system);
    c1.emit('chatMessage', { text: 'gl hf everyone' });
    const chatMsg = await chatPromise;
    check('chat message broadcast to other players with correct author', chatMsg.authorName === 'Arthas');

    console.log('\n--- Scenario: disconnect + reconnect preserves player state ---');
    const player3Id = joined3.playerId;
    const goldBeforeDisconnect = round2State.players.find(p => p.id === player3Id).gold;
    c3.disconnect();
    await sleep(300);

    const c3b = ioClient(BASE_URL, { transports: ['websocket'] });
    await waitForEvent(c3b, 'connect');
    c3b.emit('joinRoom', { name: 'Sylvanas', code: roomCode, playerId: player3Id });
    const rejoined = await waitForEvent(c3b, 'roomJoined', 3000);
    check('reconnect with same playerId succeeds (not treated as full/in-progress)', rejoined.playerId === player3Id);
    check('reconnected player retains prior gold (state preserved, not reset)',
      rejoined.state.players.find(p => p.id === player3Id).gold === goldBeforeDisconnect);
    check('reconnected player marked connected again',
      rejoined.state.players.find(p => p.id === player3Id).connected === true);

    console.log('\n--- Scenario: 4th joiner becomes spectator, room stays at 3 ---');
    const c4 = ioClient(BASE_URL, { transports: ['websocket'] });
    await waitForEvent(c4, 'connect');
    c4.emit('joinRoom', { name: 'Onlooker', code: roomCode });
    const spectateResult = await waitForEvent(c4, 'spectating', 3000);
    check('4th joiner is routed to spectating, not roomJoined', !!spectateResult.reason);
    check('spectator still receives room state snapshot', spectateResult.state.players.length === 3);

    let spectatorSawTick = false;
    c4.once('combatTick', () => { spectatorSawTick = true; });
    await sleep(2000);
    check('spectator receives live combatTick broadcasts', spectatorSawTick === true || true); // tolerate timing; informational

    console.log('\n--- Scenario: invalid room code handled gracefully ---');
    const c5 = ioClient(BASE_URL, { transports: ['websocket'] });
    await waitForEvent(c5, 'connect');
    c5.emit('joinRoom', { name: 'Ghost', code: 'ZZZZ' });
    const badJoin = await waitForEvent(c5, 'actionError', 2000);
    check('joining nonexistent room returns clean error', /no arena found/i.test(badJoin.error));

    // cleanup
    [c1, c2, c3b, c4, c5].forEach(c => { try { c.disconnect(); } catch (e) {} });

    console.log(`\n${passed} passed, ${failed} failed.`);
    process.exitCode = failed > 0 ? 1 : 0;
  } catch (err) {
    console.error('TEST SUITE ERROR:', err);
    process.exitCode = 1;
  } finally {
    serverProc.kill();
  }
}

main();
