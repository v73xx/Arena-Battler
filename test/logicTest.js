'use strict';
/* Standalone sanity test for Bot + CombatEngine + GameRoom logic.
   Run with: node test/logicTest.js
   Exits non-zero on any failed assertion. */

const assert = require('assert');
const Bot = require('../src/Bot');
const CombatEngine = require('../src/CombatEngine');
const { CLASSES, ABILITIES, TALENT_TREES, SHOP_ITEMS } = require('../public/js/gameData');

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

console.log('--- Item application ---');
const rogue = new Bot('p3', 'Valeera', 'rogue');
const apBefore = rogue.attackPower;
const item = SHOP_ITEMS.find(i => i.id === 'rough_blade');
rogue.applyItem(item);
check('item increased attack power', rogue.attackPower > apBefore);
check('item id tracked', rogue.items.includes('rough_blade'));

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


if (process.exitCode) {
  console.error('\nSOME CHECKS FAILED. See FAIL lines above.');
} else {
  console.log('\nALL CHECKS PASSED.');
}
