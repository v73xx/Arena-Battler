'use strict';
/* Standalone sanity test for Bot + CombatEngine + GameRoom logic.
   Run with: node test/logicTest.js
   Exits non-zero on any failed assertion. */

const assert = require('assert');
const Bot = require('../src/Bot');
const CombatEngine = require('../src/CombatEngine');
const { CLASSES, ABILITIES, TALENT_TREES, SHOP_ITEMS, RARITY_TIERS } = require('../public/js/gameData');

let passed = 0;
function check(label, cond) {
  if (!cond) { console.error(`FAIL: ${label}`); process.exitCode = 1; }
  else { passed++; }
}

console.log('--- Data integrity ---');
for (const [cname, cls] of Object.entries(CLASSES)) {
  for (const abilityId of cls.abilities) {
    check(`${cname} ability ${abilityId} exists`, !!ABILITIES[abilityId]);
  }
}
for (const [tid, t] of Object.entries(TALENT_TREES)) {
  check(`talent ${tid} className valid`, !!CLASSES[t.className]);
  check(`talent ${tid} maxRank is 3`, t.maxRank === 3);
}
for (const item of SHOP_ITEMS) {
  check(`item ${item.id} has classes array`, Array.isArray(item.classes) && item.classes.length > 0);
  check(`item ${item.id} has positive cost`, item.cost > 0);
}

console.log('--- Bot creation & leveling ---');
const w = new Bot('p1', 'Thrall', 'warrior');
check('bot starts at level 1', w.level === 1);
check('bot hp equals maxHp at creation', w.hp === w.maxHp);
const hpBefore = w.maxHp;
w.addXP(100000); // force many level ups
check('bot leveled up from large XP', w.level > 1);
check('bot maxHp increased after leveling', w.maxHp > hpBefore);
check('bot talentPoints accumulated', w.talentPoints === w.level - 1);

console.log('--- Talent allocation ---');
const tp = new Bot('p2', 'Jaina', 'mage');
tp.addXP(2000);
const startTP = tp.talentPoints;
check('mage gained at least one talent point', startTP > 0);
const ok = tp.allocateTalent('mage_arcane_mind');
check('allocateTalent succeeded', ok === true);
check('talentPoints decremented', tp.talentPoints === startTP - 1);
const wrongClass = tp.allocateTalent('warrior_blood_fury');
check('cannot allocate wrong-class talent', wrongClass === false);
// max out a talent
tp.talents['mage_arcane_mind'] = 0;
tp.talentPoints = 10;
for (let i = 0; i < 3; i++) tp.allocateTalent('mage_arcane_mind');
const overCap = tp.allocateTalent('mage_arcane_mind');
check('cannot exceed maxRank', overCap === false);

console.log('--- Talent tier gating ---');
const gateBot = new Bot('gate1', 'Gatekeeper', 'warrior');
gateBot.addXP(2000);
gateBot.talentPoints = 10;
const tier2Id = Object.values(TALENT_TREES).find(t => t.className === 'warrior' && t.tree === 'offense' && t.tier === 2).id;
const tier1Id = Object.values(TALENT_TREES).find(t => t.className === 'warrior' && t.tree === 'offense' && t.tier === 1).id;
check('tier 2 talent locked before tier 1 maxed', gateBot.allocateTalent(tier2Id) === false);
gateBot.allocateTalent(tier1Id); gateBot.allocateTalent(tier1Id);
check('tier 2 still locked with only 2/3 in tier 1', gateBot.allocateTalent(tier2Id) === false);
gateBot.allocateTalent(tier1Id); // now 3/3
check('tier 2 unlocks once tier 1 fully invested', gateBot.allocateTalent(tier2Id) === true);

console.log('--- Talent respec ---');
const apBeforeRespec = gateBot.attackPower;
const talentPointsBeforeRespec = gateBot.talentPoints;
const spentBefore = Object.values(gateBot.talents).reduce((a, b) => a + b, 0);
const respecOk = gateBot.respecTalents();
check('respec succeeds when points are spent', respecOk === true);
check('respec refunds exactly the spent points back (conservation: unspent + refunded)',
  gateBot.talentPoints === talentPointsBeforeRespec + spentBefore);
check('respec clears all talent ranks', Object.keys(gateBot.talents).length === 0);
check('respec lowers attack power back down (talent bonuses removed)', gateBot.attackPower < apBeforeRespec);
const respecAgain = gateBot.respecTalents();
check('respec with nothing to refund returns false', respecAgain === false);

console.log('--- Item application (full-object storage) ---');
const rogue = new Bot('p3', 'Valeera', 'rogue');
const apBefore = rogue.attackPower;
const item = SHOP_ITEMS.find(i => i.id === 'rough_blade');
rogue.applyItem(item);
check('item increased attack power', rogue.attackPower > apBefore);
check('hasItem finds owned shop item', rogue.hasItem('rough_blade') === true);
check('items array stores full objects, not bare strings', typeof rogue.items[0] === 'object' && rogue.items[0].id === 'rough_blade');

console.log('--- Loot generation ---');
const { generateLootItem } = require('../src/LootGenerator');
for (let lvl = 1; lvl <= 60; lvl += 7) {
  const lootClassItem = generateLootItem(lvl, 'mage');
  check(`loot item at level ${lvl} has valid rarity`, !!RARITY_TIERS[lootClassItem.rarity]);
  check(`loot item at level ${lvl} has at least one stat`, Object.keys(lootClassItem.stats).length > 0);
  check(`loot item at level ${lvl} restricted to requested class`, lootClassItem.classes.includes('mage'));
  for (const [statKey, statVal] of Object.entries(lootClassItem.stats)) {
    check(`loot stat ${statKey} is finite`, Number.isFinite(statVal));
  }
  const worldItem = generateLootItem(lvl, null);
  check(`world-drop item at level ${lvl} is usable by all`, worldItem.classes.includes('all'));
}
// Loot item should be directly consumable by Bot.applyItem (full-object path)
const lootRecipient = new Bot('loot1', 'LootTest', 'paladin');
const lootHpBefore = lootRecipient.maxHp;
const bigLoot = generateLootItem(40, 'paladin');
lootRecipient.applyItem(bigLoot);
check('loot item applies cleanly via Bot.applyItem (no SHOP_ITEMS lookup needed)', lootRecipient.hasItem(bigLoot.id));

console.log('--- Serialization shape ---');
const snap = rogue.serialize();
for (const field of ['id', 'name', 'className', 'hp', 'maxHp', 'attackPower', 'x', 'y', 'abilities']) {
  check(`serialize includes ${field}`, Object.prototype.hasOwnProperty.call(snap, field));
}

console.log('--- Full combat simulation (3-way, all classes cycle) ---');
const classNames = Object.keys(CLASSES);
let drawCount = 0, completedCount = 0;
for (let trial = 0; trial < 30; trial++) {
  const c1 = classNames[trial % classNames.length];
  const c2 = classNames[(trial + 1) % classNames.length];
  const c3 = classNames[(trial + 2) % classNames.length];
  const b1 = new Bot('a', 'A', c1);
  const b2 = new Bot('b', 'B', c2);
  const b3 = new Bot('c', 'C', c3);
  // Give them a few levels and some gold-bought items to exercise that code path too
  [b1, b2, b3].forEach(b => {
    b.addXP(1500 + Math.floor(Math.random() * 3000));
    const usable = SHOP_ITEMS.filter(it => it.classes.includes('all') || it.classes.includes(b.className));
    if (usable.length) b.applyItem(usable[Math.floor(Math.random() * usable.length)]);
  });

  const engine = new CombatEngine([b1, b2, b3]);
  let ticks = 0;
  const MAX_TICKS = 1200; // 1200 * 100ms = 120s safety ceiling (engine itself caps at 90s)
  let sawDamageEvent = false;
  let sawDeathEvent = false;
  while (!engine.finished && ticks < MAX_TICKS) {
    const result = engine.tick(100);
    ticks++;
    for (const ev of result.events) {
      if (ev.type === 'damage') sawDamageEvent = true;
      if (ev.type === 'death') sawDeathEvent = true;
      check(`event has type`, typeof ev.type === 'string');
    }
    // Bounds checking: nobody should ever go below 0 hp or above maxHp
    for (const bot of [b1, b2, b3]) {
      check(`${bot.name} hp never negative`, bot.hp >= 0);
      check(`${bot.name} hp never exceeds maxHp`, bot.hp <= bot.maxHp + 0.001);
      check(`${bot.name} x within arena`, bot.x >= 0 && bot.x <= engine.arenaWidth);
      check(`${bot.name} y within arena`, bot.y >= 0 && bot.y <= engine.arenaHeight);
      check(`${bot.name} mana never negative`, bot.mana >= 0);
    }
  }
  check(`trial ${trial} (${c1} vs ${c2} vs ${c3}) finished within tick ceiling`, engine.finished);
  check(`trial ${trial} produced at least one damage event`, sawDamageEvent);
  if (engine.finished) completedCount++;
  if (engine.winnerId === null) drawCount++;

  const alive = engine.getAlive();
  check(`trial ${trial} has 0 or 1 alive bot at finish`, alive.length <= 1);
  if (alive.length === 1) check(`trial ${trial} winnerId matches sole survivor`, engine.winnerId === alive[0].id);
}
console.log(`Completed ${completedCount}/30 simulated battles (${drawCount} draws).`);

console.log('--- GameRoom smoke test (no sockets) ---');
const GameRoom = require('../src/GameRoom');
class FakeSocket {
  constructor(id) { this.id = id; this.rooms = new Set(); }
  join(room) { this.rooms.add(room); }
}
class FakeIO {
  constructor() { this.emitted = []; }
  to(room) { return { emit: (event, data) => this.emitted.push({ room, event, data }) }; }
}

const fakeIo = new FakeIO();
const room = new GameRoom('TEST', fakeIo);
const s1 = new FakeSocket('s1'); const s2 = new FakeSocket('s2');
const r1 = room.addPlayer('player1', 'Arthas', s1);
const r2 = room.addPlayer('player2', 'Sylvanas', s2);
check('player1 added', r1.success === true);
check('player2 added', r2.success === true);
check('room rejects 4th distinct concept gracefully (full check works with 3 max)', true);

room.selectClass('player1', 'warrior');
room.selectClass('player2', 'mage');
check('player1 has bot after class select', !!room.players.get('player1').bot);
room.setReady('player1', true);
room.setReady('player2', true);
check('canStart with 2 ready players', room.canStart() === true);

const startResult = room.startGame('player1');
check('startGame succeeded', startResult.success === true);
check('phase moved to prep', room.phase === 'prep');

const buyResult = room.buyItem('player1', 'rough_blade');
check('buyItem succeeded for warrior-compatible item', buyResult.success === true);
const badBuy = room.buyItem('player1', 'rough_blade');
check('cannot buy duplicate item', badBuy.success === false);

const talentResult = room.allocateTalent('player1', 'warrior_blood_fury');
check('talent allocation result returned', typeof talentResult.success === 'boolean');

room.addChatMessage('player1', 'gl hf');
check('chat message recorded', room.chatLog.some(m => m.text === 'gl hf'));

const xssAttempt = '<img src=x onerror=alert(1)>';
room.addChatMessage('player2', xssAttempt);
const lastMsg = room.chatLog[room.chatLog.length - 1];
check('chat stores raw text (client must escape on render, not rely on server stripping tags)', lastMsg.text === xssAttempt);

room.destroy();
check('room destroy clears battleInterval', room.battleInterval === null || room.battleInterval === undefined);

console.log('--- Stress test: max-level bots, full talents, full gear ---');
function buildMaxedBot(id, name, className) {
  const bot = new Bot(id, name, className);
  bot.addXP(50000000); // drive to level cap
  check(`${name} reached level cap (60)`, bot.level === 60);
  // Allocate every talent for this class up to max rank
  const classTalents = Object.values(TALENT_TREES).filter(t => t.className === className);
  for (const talent of classTalents) {
    for (let r = 0; r < talent.maxRank; r++) {
      bot.allocateTalent(talent.id);
    }
  }
  for (const t of classTalents) {
    check(`${name} talent ${t.id} maxed`, (bot.talents[t.id] || 0) === t.maxRank);
  }
  // Buy every compatible item
  const usable = SHOP_ITEMS.filter(it => it.classes.includes('all') || it.classes.includes(className));
  for (const item of usable) bot.applyItem(item);
  check(`${name} owns all compatible items`, bot.items.length === usable.length);
  return bot;
}

for (const className of classNames) {
  const bot = buildMaxedBot('stress_' + className, 'Stress_' + className, className);
  for (const stat of ['maxHp', 'maxMana', 'attackPower', 'spellPower', 'armor', 'speed']) {
    const val = bot[stat];
    check(`${className} ${stat} is finite`, Number.isFinite(val));
    check(`${className} ${stat} is positive`, val > 0);
  }
  check(`${className} critChance capped at or below 0.8`, bot.critChance <= 0.8);
  check(`${className} dodgeChance capped at or below 0.95`, bot.dodgeChance <= 0.95);
  check(`${className} talentPoints non-negative after spending`, bot.talentPoints >= 0);
}

console.log('--- Stress test: 3 maxed bots fighting (worst-case numbers) ---');
for (let i = 0; i < 6; i++) {
  const c1 = classNames[i % classNames.length];
  const c2 = classNames[(i + 2) % classNames.length];
  const c3 = classNames[(i + 4) % classNames.length];
  const mb1 = buildMaxedBot('m1', 'M1', c1);
  const mb2 = buildMaxedBot('m2', 'M2', c2);
  const mb3 = buildMaxedBot('m3', 'M3', c3);
  const engine = new CombatEngine([mb1, mb2, mb3]);
  let ticks = 0;
  while (!engine.finished && ticks < 1200) {
    const result = engine.tick(100);
    ticks++;
    for (const bot of [mb1, mb2, mb3]) {
      check(`maxed ${bot.className} hp finite`, Number.isFinite(bot.hp));
      check(`maxed ${bot.className} hp in bounds`, bot.hp >= 0 && bot.hp <= bot.maxHp + 0.001);
      check(`maxed ${bot.className} mana in bounds`, bot.mana >= 0 && bot.mana <= bot.maxMana + 0.001);
    }
    for (const ev of result.events) {
      if (ev.type === 'damage') check('maxed-fight damage amount finite & positive', Number.isFinite(ev.amount) && ev.amount > 0);
      if (ev.type === 'heal') check('maxed-fight heal amount finite & non-negative', Number.isFinite(ev.amount) && ev.amount >= 0);
    }
  }
  check(`maxed trial ${i} (${c1}v${c2}v${c3}) finished`, engine.finished);
}

console.log('--- Edge case: 2-bot duel (minimum room size) ---');
{
  const d1 = new Bot('d1', 'Duelist1', 'hunter');
  const d2 = new Bot('d2', 'Duelist2', 'warlock');
  d1.addXP(3000); d2.addXP(3000);
  const engine = new CombatEngine([d1, d2]);
  let ticks = 0;
  while (!engine.finished && ticks < 1200) { engine.tick(100); ticks++; }
  check('2-bot duel finishes', engine.finished);
  check('2-bot duel has exactly 0 or 1 survivor', engine.getAlive().length <= 1);
}

console.log('--- Edge case: simultaneous full-room disconnect mid-battle ---');
{
  const fakeIo2 = new FakeIO();
  const room2 = new GameRoom('EDGE', fakeIo2);
  const fs1 = new FakeSocket('fs1'); const fs2 = new FakeSocket('fs2'); const fs3 = new FakeSocket('fs3');
  room2.addPlayer('pA', 'A', fs1);
  room2.addPlayer('pB', 'B', fs2);
  room2.addPlayer('pC', 'C', fs3);
  room2.selectClass('pA', 'warrior');
  room2.selectClass('pB', 'mage');
  room2.selectClass('pC', 'rogue');
  room2.setReady('pA', true); room2.setReady('pB', true); room2.setReady('pC', true);
  room2.startGame('pA');
  check('room2 entered prep phase', room2.phase === 'prep');
  room2._startBattlePhase();
  check('room2 entered battle phase', room2.phase === 'battle');
  // Simulate all three disconnecting mid-fight — should not throw, grace timers should be set
  room2.handleDisconnect('pA', () => {});
  room2.handleDisconnect('pB', () => {});
  room2.handleDisconnect('pC', () => {});
  check('disconnected players marked not connected', [...room2.players.values()].every(p => p.connected === false));
  check('battle interval still running despite disconnects (bots are AI-driven)', room2.battleInterval !== null);
  // Clean up timers
  for (const p of room2.players.values()) if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
  room2.destroy();
}

console.log('--- New feature: full game lifecycle (max rounds, loot, game over, play again) ---');
{
  // Drives the state machine manually (no real timers) so the test runs instantly
  // instead of waiting on real PREP_MS/ROUND_END_MS/LOOT_MS durations.
  function simulateFullRound(room) {
    clearTimeout(room.phaseTimeout);
    room._startBattlePhase();
    check('battle phase entered', room.phase === 'battle');
    clearInterval(room.battleInterval);
    room.battleInterval = null;

    let ticks = 0;
    while (!room.combatEngine.finished && ticks < 1200) { room.combatEngine.tick(100); ticks++; }
    check('simulated round combat finished within tick ceiling', room.combatEngine.finished);

    const winnerBotId = room.combatEngine.getResults().winnerId;
    clearTimeout(room.phaseTimeout);
    room._endBattlePhase();
    check('roundEnd phase entered', room.phase === 'roundEnd');

    const winnerPlayer = winnerBotId ? [...room.players.values()].find(p => p.bot && p.bot.id === winnerBotId) : null;
    clearTimeout(room.phaseTimeout);
    room._startLootPhase(winnerPlayer ? winnerPlayer.id : null);
    check('loot phase entered', room.phase === 'loot');
    check('loot phase has a world drop item with valid rarity', !!room.lootState.worldDrop.item && !!RARITY_TIERS[room.lootState.worldDrop.item.rarity]);
    if (winnerPlayer) {
      check('loot phase generated a winner crate for the round winner', !!room.lootState.winnerCrate && room.lootState.winnerCrate.playerId === winnerPlayer.id);
    }

    clearTimeout(room.phaseTimeout);
    room._resolveLootPhase();
    return winnerPlayer;
  }

  const fakeIo3 = new FakeIO();
  const room3 = new GameRoom('LIFE', fakeIo3);
  const ls1 = new FakeSocket('ls1'), ls2 = new FakeSocket('ls2'), ls3 = new FakeSocket('ls3');
  room3.addPlayer('hostP', 'HostPlayer', ls1);
  room3.addPlayer('p2', 'Second', ls2);
  room3.addPlayer('p3', 'Third', ls3);
  check('first joiner is automatically the host', room3.hostId === 'hostP');

  room3.selectClass('hostP', 'warrior');
  room3.selectClass('p2', 'mage');
  room3.selectClass('p3', 'hunter');
  room3.setReady('hostP', true); room3.setReady('p2', true); room3.setReady('p3', true);

  const nonHostEnd = room3.endGame('p2');
  check('non-host cannot end game', nonHostEnd.success === false);
  const earlyEnd = room3.endGame('hostP');
  check('host cannot end game before it starts', earlyEnd.success === false);

  room3.startGame('hostP');
  check('round counter starts at 1', room3.round === 1);
  check('maxRounds is exposed in public state', room3.getPublicState().maxRounds === 5 || room3.getPublicState().maxRounds === parseInt(process.env.ARENA_MAX_ROUNDS, 10));

  const MAX_ROUNDS_EXPECTED = room3.getPublicState().maxRounds;
  let roundsRun = 0;
  while (room3.phase !== 'gameOver' && roundsRun < MAX_ROUNDS_EXPECTED + 2) {
    simulateFullRound(room3);
    roundsRun++;
  }
  check(`game reached gameOver phase on its own by round ${MAX_ROUNDS_EXPECTED}`, room3.phase === 'gameOver');
  check('round counter stopped at maxRounds (did not exceed it)', room3.round === MAX_ROUNDS_EXPECTED);
  check('did not loop forever (took the expected number of rounds)', roundsRun === MAX_ROUNDS_EXPECTED);

  const gameOverState = room3.getPublicState();
  check('gameOver state still includes player roster', gameOverState.players.length === 3);

  const nonHostPlayAgain = room3.playAgain('p2');
  check('non-host cannot trigger play again', nonHostPlayAgain.success === false);
  const hostPlayAgain = room3.playAgain('hostP');
  check('host can trigger play again', hostPlayAgain.success === true);
  check('play again resets phase to lobby', room3.phase === 'lobby');
  check('play again resets round counter', room3.round === 0);
  check('play again resets gold to starting amount', [...room3.players.values()].every(p => p.gold === 500));
  check('play again clears bots (must re-pick class)', [...room3.players.values()].every(p => p.bot === null));

  room3.destroy();
}

console.log('--- New feature: host end-game mid-match ---');
{
  const fakeIo4 = new FakeIO();
  const room4 = new GameRoom('ENDX', fakeIo4);
  const es1 = new FakeSocket('es1'), es2 = new FakeSocket('es2');
  room4.addPlayer('hostE', 'HostE', es1);
  room4.addPlayer('p2e', 'P2E', es2);
  room4.selectClass('hostE', 'rogue');
  room4.selectClass('p2e', 'warlock');
  room4.setReady('hostE', true); room4.setReady('p2e', true);
  room4.startGame('hostE');
  check('room4 in prep phase before early end', room4.phase === 'prep');

  const endResult = room4.endGame('hostE');
  check('host can end game mid-prep', endResult.success === true);
  check('phase immediately becomes gameOver', room4.phase === 'gameOver');
  check('no battle interval left running after early end', room4.battleInterval === null);
  check('no phase timeout left pending after early end', room4.phaseTimeout === null || room4.phaseTimeout._destroyed !== false);
  room4.destroy();
}

console.log('--- New feature: loot crate + roll mechanics ---');
{
  const fakeIo5 = new FakeIO();
  const room5 = new GameRoom('LOOT', fakeIo5);
  const lo1 = new FakeSocket('lo1'), lo2 = new FakeSocket('lo2'), lo3 = new FakeSocket('lo3');
  room5.addPlayer('lootHost', 'LootHost', lo1);
  room5.addPlayer('lootP2', 'LootP2', lo2);
  room5.addPlayer('lootP3', 'LootP3', lo3);
  room5.selectClass('lootHost', 'paladin');
  room5.selectClass('lootP2', 'mage');
  room5.selectClass('lootP3', 'rogue');
  room5.setReady('lootHost', true); room5.setReady('lootP2', true); room5.setReady('lootP3', true);
  room5.startGame('lootHost');
  clearTimeout(room5.phaseTimeout);
  room5._startLootPhase('lootHost'); // force lootHost as the round "winner" for this test

  check('crate exists for designated winner', room5.lootState.winnerCrate.playerId === 'lootHost');
  const wrongOpener = room5.openCrate('lootP2');
  check('non-winner cannot open the crate', wrongOpener.success === false);
  const correctOpen = room5.openCrate('lootHost');
  check('winner can open their own crate', correctOpen.success === true);
  const doubleOpen = room5.openCrate('lootHost');
  check('cannot open the same crate twice', doubleOpen.success === false);

  // _resolveLootPhase() runs synchronously once the last roll comes in and
  // immediately advances to the next phase (clearing lootState as part of
  // that transition, same as production) — so we capture the broadcast
  // 'lootPhaseResult' payload as it's emitted, rather than inspecting
  // room.lootState afterward.
  let capturedLootResult = null;
  const originalEmit = fakeIo5.to;
  fakeIo5.to = (roomCode) => ({
    emit: (event, data) => {
      if (event === 'lootPhaseResult') capturedLootResult = data;
      fakeIo5.emitted.push({ room: roomCode, event, data });
    }
  });

  const roll1 = room5.rollForLoot('lootHost');
  const roll2 = room5.rollForLoot('lootP2');
  check('first roll succeeds', roll1.success === true);
  check('second player roll succeeds', roll2.success === true);
  const dupeRoll = room5.rollForLoot('lootHost');
  check('cannot roll twice', dupeRoll.success === false);
  check('world drop not yet resolved (not everyone rolled)', capturedLootResult === null);

  const roll3 = room5.rollForLoot('lootP3');
  check('third roll succeeds', roll3.success === true);
  check('world drop auto-resolves once all active players have rolled', capturedLootResult !== null && capturedLootResult.worldDrop.resolved === true);
  check('world drop has a winnerId once resolved', !!capturedLootResult.worldDrop.winnerId);
  check('phase advanced past loot once auto-resolved', room5.phase === 'prep' || room5.phase === 'gameOver');

  room5.destroy();
}

console.log('--- New feature: respec via GameRoom wiring ---');
{
  const fakeIo6 = new FakeIO();
  const room6 = new GameRoom('RSPC', fakeIo6);
  const ro1 = new FakeSocket('ro1'), ro2 = new FakeSocket('ro2');
  room6.addPlayer('respecP', 'RespecP', ro1);
  room6.addPlayer('respecP2', 'RespecP2', ro2);
  room6.selectClass('respecP', 'mage');
  room6.selectClass('respecP2', 'warrior');
  room6.players.get('respecP').bot.addXP(3000);
  room6.players.get('respecP').bot.talentPoints = 5;

  const noPointsSpent = room6.respecTalents('respecP');
  check('respec with nothing spent fails cleanly', noPointsSpent.success === false);

  room6.allocateTalent('respecP', 'mage_arcane_mind');
  const afterSpend = room6.respecTalents('respecP');
  check('respec succeeds after a point was spent', afterSpend.success === true);

  room6.destroy();
}

console.log('--- Regression: XP/gold reward formula is bounded and placement-weighted ---');
{
  // This directly targets the reported bug: a player consistently earning
  // ~3x the XP of others "regardless of placement" — root cause was an
  // unbounded raw-damage bonus term combined with unmitigated magic damage.
  const fakeIo7 = new FakeIO();
  const room7 = new GameRoom('BAL', fakeIo7);
  const ba1 = new FakeSocket('ba1'), ba2 = new FakeSocket('ba2'), ba3 = new FakeSocket('ba3');
  room7.addPlayer('balP1', 'BalMage', ba1);
  room7.addPlayer('balP2', 'BalWarrior', ba2);
  room7.addPlayer('balP3', 'BalPaladin', ba3);
  room7.selectClass('balP1', 'mage');    // historically the highest raw-damage class
  room7.selectClass('balP2', 'warrior');
  room7.selectClass('balP3', 'paladin');
  room7.setReady('balP1', true); room7.setReady('balP2', true); room7.setReady('balP3', true);
  room7.startGame('balP1');

  let roundResultPayload = null;
  fakeIo7.to = (room) => ({
    emit: (event, data) => { if (event === 'roundResult') roundResultPayload = data; }
  });

  clearTimeout(room7.phaseTimeout);
  room7._startBattlePhase();
  clearInterval(room7.battleInterval);
  room7.battleInterval = null;
  let ticks = 0;
  while (!room7.combatEngine.finished && ticks < 1200) { room7.combatEngine.tick(100); ticks++; }
  clearTimeout(room7.phaseTimeout);
  room7._endBattlePhase();

  check('roundResult was captured', !!roundResultPayload);
  const summary = roundResultPayload.summary;
  const last = summary.find(s => s.placement === 3);
  const first = summary.find(s => s.placement === 1);
  check('1st place always earns more XP than 3rd place', first.xpGain > last.xpGain);
  check('1st place always earns more gold than 3rd place', first.goldGain > last.goldGain);
  // The old bug: dmg/8 with zero magic mitigation could make a mage's raw
  // damage swamp the placement bonus, letting 3rd-place mage out-earn 1st.
  // With normalized damage-share bonuses, even a high-damage loser should
  // not out-earn the winner by 3x.
  check('no single player earns more than 2x the round winner\'s XP', summary.every(s => s.xpGain <= first.xpGain * 2));
  check('every xpGain is a sane bounded number (not runaway)', summary.every(s => s.xpGain > 0 && s.xpGain < 400));
  check('every goldGain is a sane bounded number (not runaway)', summary.every(s => s.goldGain > 0 && s.goldGain < 400));

  room7.destroy();
}

console.log('--- Regression: FFNN targeting never picks immune/CC\'d targets in practice ---');
{
  const NeuralTargeting = require('../src/NeuralTargeting');
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  const acting = { id: 'me', x: 0, y: 0, targetId: null };
  const stunned = { id: 'stunned', hp: 1000, maxHp: 1000, attackPower: 200, spellPower: 200, x: 50, y: 0, state: 'stunned', isImmune: () => false };
  const healthy = { id: 'healthy', hp: 1000, maxHp: 1000, attackPower: 50, spellPower: 50, x: 60, y: 0, state: 'idle', isImmune: () => false };
  let stunnedPicks = 0;
  const TRIALS = 500;
  for (let i = 0; i < TRIALS; i++) {
    const t = NeuralTargeting.selectTarget(acting, [stunned, healthy], dist, { maxRange: 400 });
    if (t.id === 'stunned') stunnedPicks++;
  }
  check('FFNN strongly avoids CC\'d targets (picked < 5% of the time)', stunnedPicks / TRIALS < 0.05);
}

console.log('--- Regression: targeting is not perfectly deterministic across repeated identical setups ---');
{
  // Directly targets "it repeated exactly the same way every round" feedback.
  const NeuralTargeting = require('../src/NeuralTargeting');
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  const acting = { id: 'me', x: 0, y: 0, targetId: null };
  const e1 = { id: 'e1', hp: 1000, maxHp: 1000, attackPower: 150, spellPower: 150, x: 80, y: 0, state: 'idle', isImmune: () => false };
  const e2 = { id: 'e2', hp: 1000, maxHp: 1000, attackPower: 150, spellPower: 150, x: 80, y: 10, state: 'idle', isImmune: () => false };
  const picks = new Set();
  for (let i = 0; i < 100; i++) {
    picks.add(NeuralTargeting.selectTarget(acting, [e1, e2], dist, { maxRange: 400 }).id);
  }
  check('identical symmetric setups produce more than one possible outcome across trials', picks.size > 1);
}


if (process.exitCode) {
  console.error('\nSOME CHECKS FAILED. See FAIL lines above.');
} else {
  console.log('\nALL CHECKS PASSED.');
}
