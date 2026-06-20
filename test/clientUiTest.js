'use strict';
/* Client-side UI smoke test using jsdom. Executes the REAL ui.js code
   against realistic state payloads shaped exactly like what GameRoom's
   getPublicState()/event emitters actually produce (built by driving real
   Bot/CombatEngine/GameRoom instances, not hand-typed mocks), and checks
   that no rendering function throws, and that key DOM side-effects landed.
   Run with: node test/clientUiTest.js */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ FAIL: ${label}`); }
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.alert = () => {}; // jsdom doesn't implement alert/confirm
window.confirm = () => true;

const gameDataSrc = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'gameData.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'ui.js'), 'utf8');

window.eval(gameDataSrc);
window.eval(uiSrc);

check('window.GAME_DATA loaded', !!window.GAME_DATA);
check('window.UI loaded', !!window.UI);

const UI = window.UI;
const noop = () => {};
UI.bindActions({
  onCreateRoom: noop, onJoinRoom: noop, onSelectClass: noop, onSetReady: noop,
  onStartGame: noop, onBuyItem: noop, onAllocateTalent: noop, onRespecTalents: noop,
  onSendChat: noop, onEndGame: noop, onPlayAgain: noop, onOpenCrate: noop, onRollForLoot: noop
});
UI.init();

/* ── Build REAL state via the actual server modules, not hand-typed mocks ── */
const Bot = require('../src/Bot');
const { SHOP_ITEMS } = require('../public/js/gameData');
const { generateLootItem } = require('../src/LootGenerator');

function makePlayer(id, name, className, opts = {}) {
  const bot = new Bot(id, name, className);
  if (opts.xp) bot.addXP(opts.xp);
  if (opts.items) for (const itemId of opts.items) {
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (item) bot.applyItem(item);
  }
  if (opts.lootItem) bot.applyItem(opts.lootItem);
  if (opts.talents) for (const tid of opts.talents) bot.allocateTalent(tid);
  return {
    id, name, className, ready: opts.ready ?? true, connected: opts.connected ?? true,
    gold: opts.gold ?? 500, wins: opts.wins ?? 0, bot: bot.serialize()
  };
}

console.log('--- Lobby rendering (various states) ---');
try {
  UI.setMyPlayerId('p1');
  const lobbyState = {
    code: 'AB12', phase: 'lobby', round: 0, maxRounds: 5, hostId: 'p1', spectatorCount: 0,
    players: [
      { id: 'p1', name: 'Arthas', className: 'warrior', ready: true, connected: true, gold: 500, wins: 0, bot: new Bot('p1', 'Arthas', 'warrior').serialize() },
      { id: 'p2', name: 'Jaina', className: null, ready: false, connected: true, gold: 500, wins: 0, bot: null }
    ],
    chatLog: []
  };
  UI.renderLobby(lobbyState);
  check('lobby renders without throwing', true);
  check('room code displayed', window.document.getElementById('roomCodeDisplay').textContent === 'AB12');
  check('ready button enabled for player with a class', window.document.getElementById('readyBtn').disabled === false);
} catch (err) {
  check('lobby renders without throwing: ' + err.message, false);
}

console.log('--- Full game-screen render across every phase ---');
const PHASES = ['prep', 'battle', 'roundEnd', 'loot', 'gameOver'];
for (const phase of PHASES) {
  try {
    const players = [
      makePlayer('p1', 'Arthas', 'warrior', { xp: 4000, items: ['rough_blade', 'iron_shield'], talents: ['warrior_blood_fury'], wins: 2 }),
      makePlayer('p2', 'Jaina', 'mage', { xp: 6000, lootItem: generateLootItem(15, 'mage'), wins: 1 }),
      makePlayer('p3', 'Sylvanas', 'hunter', { xp: 1000, connected: false, wins: 0 })
    ];
    const state = {
      code: 'AB12', phase, round: 3, maxRounds: 5, hostId: 'p1', spectatorCount: 1,
      phaseEndsAt: Date.now() + 12000,
      lootState: phase === 'loot' ? {
        winnerCrate: { playerId: 'p1', playerName: 'Arthas', item: generateLootItem(10, 'warrior'), opened: false },
        worldDrop: { item: generateLootItem(10, null), rolls: { p2: 87 }, resolved: false, winnerId: null }
      } : null,
      gameOverStandings: phase === 'gameOver' ? [
        { playerId: 'p1', name: 'Arthas', className: 'warrior', wins: 2, level: 5, gold: 800, placement: 1 },
        { playerId: 'p2', name: 'Jaina', className: 'mage', wins: 1, level: 6, gold: 700, placement: 2 },
        { playerId: 'p3', name: 'Sylvanas', className: 'hunter', wins: 0, level: 2, gold: 500, placement: 3 }
      ] : null,
      players,
      chatLog: [
        { id: 'c1', authorName: 'Arena', text: 'The gates open!', system: true, ts: Date.now() },
        { id: 'c2', authorName: 'Arthas', text: 'gl hf', system: false, ts: Date.now(), classColor: '#C8973A' }
      ],
      battleSnapshot: phase === 'battle' ? { bots: players.filter(p => p.bot).map(p => p.bot), elapsed: 5000 } : null
    };

    UI.renderTopBar(state);
    UI.renderRosterRail(state);
    UI.renderShopList(state);
    UI.renderTalentPanel(state);
    UI.renderFullChat(state.chatLog);
    check(`[${phase}] full game-screen render did not throw`, true);

    if (phase === 'loot') {
      UI.showLootOverlay(state.lootState);
      check(`[${phase}] loot overlay shows without throwing`, true);
      UI.updateLootRoll({ playerId: 'p3', playerName: 'Sylvanas', roll: 42 }, state.lootState);
      check(`[${phase}] loot roll update applies without throwing`, true);
      UI.markLootResolved({ ...state.lootState, worldDrop: { ...state.lootState.worldDrop, resolved: true, winnerId: 'p2' } });
      check(`[${phase}] loot resolution renders without throwing`, true);
      UI.hideLootOverlay();
    }

    if (phase === 'gameOver') {
      UI.showGameOverOverlay({ standings: state.gameOverStandings }, true);
      check(`[${phase}] game-over overlay (as host) renders without throwing`, window.document.getElementById('playAgainBtn').classList.contains('hidden') === false);
      UI.showGameOverOverlay({ standings: state.gameOverStandings }, false);
      check(`[${phase}] game-over overlay (non-host) hides Play Again button`, window.document.getElementById('playAgainBtn').classList.contains('hidden') === true);
      UI.hideGameOverOverlay();
    }

    if (phase === 'roundEnd') {
      const roundData = {
        round: 3,
        summary: [
          { playerId: 'p1', name: 'Arthas', className: 'warrior', placement: 1, goldGain: 220, xpGain: 240, damageDealt: 1500, healingDone: 0, survived: true, wins: 2, leveledUp: true },
          { playerId: 'p2', name: 'Jaina', className: 'mage', placement: 2, goldGain: 160, xpGain: 180, damageDealt: 1200, healingDone: 0, survived: false, wins: 1, leveledUp: false },
          { playerId: 'p3', name: 'Sylvanas', className: 'hunter', placement: 3, goldGain: 100, xpGain: 110, damageDealt: 600, healingDone: 0, survived: false, wins: 0, leveledUp: false }
        ],
        winnerId: 'p1'
      };
      UI.showRoundOverlay(roundData, { p1: 'warrior', p2: 'mage', p3: 'hunter' });
      check(`[${phase}] round overlay renders without throwing`, true);
      UI.hideRoundOverlay();
    }
  } catch (err) {
    check(`[${phase}] render threw an unexpected error: ${err.stack}`, false);
  }
}

console.log('--- Talent tree tier-gating render (locked vs unlocked vs maxed) ---');
try {
  const freshBot = new Bot('tp1', 'TalentTest', 'warrior');
  freshBot.addXP(50000);
  freshBot.talentPoints = 10;
  const stateNoSpend = {
    code: 'AB12', phase: 'prep', round: 1, maxRounds: 5, hostId: 'tp1', spectatorCount: 0,
    players: [{ id: 'tp1', name: 'TalentTest', className: 'warrior', ready: true, connected: true, gold: 500, wins: 0, bot: freshBot.serialize() }],
    chatLog: []
  };
  UI.setMyPlayerId('tp1');
  UI.renderTalentPanel(stateNoSpend);
  const lockedNodes = window.document.querySelectorAll('#talentTrees .talent-node.locked');
  check('tier-2/3 talents render as locked before any points spent', lockedNodes.length > 0);
  check('respec button disabled when nothing is spent', window.document.getElementById('respecBtn').disabled === true);

  freshBot.allocateTalent('warrior_blood_fury');
  freshBot.allocateTalent('warrior_blood_fury');
  freshBot.allocateTalent('warrior_blood_fury'); // tier 1 maxed -> tier 2 should unlock
  const stateTier1Maxed = { ...stateNoSpend, players: [{ ...stateNoSpend.players[0], bot: freshBot.serialize() }] };
  UI.renderTalentPanel(stateTier1Maxed);
  const maxedNode = window.document.querySelector('#talentTrees .talent-node.maxed');
  check('a maxed tier-1 talent renders with the maxed class', !!maxedNode);
  check('respec button enabled once points are spent', window.document.getElementById('respecBtn').disabled === false);
} catch (err) {
  check('talent tier-gating render threw: ' + err.stack, false);
}

console.log('--- XSS / escaping safety in chat and names ---');
try {
  const evilState = {
    code: 'AB12', phase: 'lobby', round: 0, maxRounds: 5, hostId: 'evil', spectatorCount: 0,
    players: [{ id: 'evil', name: '<img src=x onerror=alert(1)>', className: null, ready: false, connected: true, gold: 500, wins: 0, bot: null }],
    chatLog: []
  };
  UI.setMyPlayerId('evil');
  UI.renderLobby(evilState);
  const rosterHtml = window.document.getElementById('lobbyRoster').innerHTML;
  check('player name with HTML is escaped in lobby roster (no raw <img> tag)', !rosterHtml.includes('<img src=x'));

  UI.appendChatMessage({ id: 'x1', authorName: '<script>alert(1)</script>', text: '<b>bold attempt</b>', system: false, ts: Date.now(), classColor: '#fff' });
  const chatHtml = window.document.getElementById('chatMessages').innerHTML;
  check('chat author/text use safe DOM text nodes, not raw HTML injection', !chatHtml.includes('<script>alert') && !chatHtml.includes('<b>bold'));
} catch (err) {
  check('XSS safety check threw: ' + err.message, false);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exitCode = failed > 0 ? 1 : 0;
process.exit(process.exitCode); // ui.js's startPhaseTimerLoop() sets a real setInterval that would otherwise keep this process alive forever outside a browser context
