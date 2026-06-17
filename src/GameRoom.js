'use strict';
const { v4: uuidv4 } = require('uuid');
const { CLASSES, SHOP_ITEMS, TALENT_TREES } = require('../public/js/gameData');
const Bot = require('./Bot');
const CombatEngine = require('./CombatEngine');

const MAX_PLAYERS      = 3;
const PREP_MS          = parseInt(process.env.ARENA_PREP_MS, 10)      || 45000;
const ROUND_END_MS     = parseInt(process.env.ARENA_ROUND_END_MS, 10) || 7000;
const TICK_MS          = 100;
const WINS_PER_MATCH    = 3;
const DISCONNECT_GRACE  = 120000; // 2 minutes
const STARTING_GOLD     = 500;
const CHAT_MAX_LEN      = 240;
const CHAT_HISTORY_MAX  = 60;
const CHAT_COOLDOWN_MS  = 300;

function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, CHAT_MAX_LEN);
}

class GameRoom {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = new Map();     // playerId -> player state
    this.spectators = new Set();  // socket ids
    this.phase = 'lobby';         // lobby | prep | battle | roundEnd
    this.round = 0;
    this.chatLog = [];
    this.combatEngine = null;
    this.battleInterval = null;
    this.phaseTimeout = null;
    this.phaseEndsAt = null;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.destroyed = false;
  }

  /* ── ROOM HELPERS ─────────────────────────────────────── */
  touch() { this.lastActivity = Date.now(); }

  _emit(event, data) { if (!this.destroyed) this.io.to(this.code).emit(event, data); }

  _systemMessage(text) {
    const msg = { id: uuidv4(), authorName: 'Arena', text, system: true, ts: Date.now() };
    this.chatLog.push(msg);
    if (this.chatLog.length > CHAT_HISTORY_MAX) this.chatLog.shift();
    this._emit('chatMessage', msg);
  }

  /* ── PLAYER MANAGEMENT ────────────────────────────────── */
  addPlayer(playerId, name, socket) {
    const existing = this.players.get(playerId);
    if (existing) {
      existing.connected = true;
      existing.socketId = socket.id;
      if (existing.disconnectTimer) { clearTimeout(existing.disconnectTimer); existing.disconnectTimer = null; }
      socket.join(this.code);
      this.touch();
      return { success: true, reconnected: true };
    }

    if (this.phase !== 'lobby') {
      return { success: false, error: 'A match is already underway in this room. You can spectate or try a fresh room.' };
    }
    if (this.players.size >= MAX_PLAYERS) {
      return { success: false, error: 'This arena is full (3/3 players).' };
    }

    const safeName = sanitizeText(name) || `Champion${Math.floor(Math.random() * 1000)}`;
    this.players.set(playerId, {
      id: playerId,
      socketId: socket.id,
      name: safeName,
      className: null,
      ready: false,
      connected: true,
      disconnectTimer: null,
      gold: STARTING_GOLD,
      wins: 0,
      bot: null,
      lastChatAt: 0
    });
    socket.join(this.code);
    this.touch();
    this._systemMessage(`${safeName} has entered the arena.`);
    return { success: true, reconnected: false };
  }

  addSpectator(socket) {
    this.spectators.add(socket.id);
    socket.join(this.code);
  }

  removeSpectator(socketId) { this.spectators.delete(socketId); }

  handleDisconnect(playerId, onEmptyCallback) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    this._systemMessage(`${player.name} has disconnected.`);
    player.disconnectTimer = setTimeout(() => {
      this.players.delete(playerId);
      this._broadcastState();
      if (this._isEmpty() && onEmptyCallback) onEmptyCallback();
    }, DISCONNECT_GRACE);
  }

  _isEmpty() {
    if (this.spectators.size > 0) return false;
    for (const p of this.players.values()) if (p.connected) return false;
    return this.players.size === 0;
  }

  /* ── LOBBY ACTIONS ────────────────────────────────────── */
  selectClass(playerId, className) {
    if (this.phase !== 'lobby') return { success: false, error: 'Class is locked once the match begins.' };
    const player = this.players.get(playerId);
    if (!player) return { success: false, error: 'Player not found.' };
    if (!CLASSES[className]) return { success: false, error: 'Unknown class.' };

    player.className = className;
    player.bot = new Bot(playerId, player.name, className);
    player.ready = false;
    this.touch();
    this._broadcastState();
    return { success: true };
  }

  setReady(playerId, ready) {
    if (this.phase !== 'lobby') return { success: false, error: 'Already underway.' };
    const player = this.players.get(playerId);
    if (!player) return { success: false, error: 'Player not found.' };
    if (!player.className) return { success: false, error: 'Choose a class first.' };
    player.ready = !!ready;
    this.touch();
    this._broadcastState();
    return { success: true };
  }

  canStart() {
    const connectedPlayers = [...this.players.values()].filter(p => p.connected);
    if (connectedPlayers.length < 2) return false;
    return connectedPlayers.every(p => p.ready && p.className);
  }

  startGame(requestingPlayerId) {
    if (this.phase !== 'lobby') return { success: false, error: 'Already started.' };
    if (!this.players.has(requestingPlayerId)) return { success: false, error: 'Player not found.' };
    if (!this.canStart()) return { success: false, error: 'All players must select a class and ready up (min 2 players).' };

    this.round = 0;
    this._systemMessage('The gates open. Welcome to the arena!');
    this._startPrepPhase();
    return { success: true };
  }

  /* ── SHOP / TALENTS (allowed any time outside active battle) ── */
  buyItem(playerId, itemId) {
    if (this.phase === 'battle') return { success: false, error: 'Cannot shop during battle.' };
    const player = this.players.get(playerId);
    if (!player || !player.bot) return { success: false, error: 'Player not found.' };
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return { success: false, error: 'Item not found.' };
    if (!(item.classes.includes('all') || item.classes.includes(player.bot.className))) {
      return { success: false, error: `${item.name} cannot be used by a ${CLASSES[player.bot.className].name}.` };
    }
    if (player.bot.items.includes(itemId)) return { success: false, error: 'Already owned.' };
    if (player.gold < item.cost) return { success: false, error: 'Not enough gold.' };

    player.gold -= item.cost;
    player.bot.applyItem(item);
    this.touch();
    this._broadcastState();
    return { success: true };
  }

  allocateTalent(playerId, talentId) {
    if (this.phase === 'battle') return { success: false, error: 'Cannot allocate talents during battle.' };
    const player = this.players.get(playerId);
    if (!player || !player.bot) return { success: false, error: 'Player not found.' };
    const talent = TALENT_TREES[talentId];
    if (!talent) return { success: false, error: 'Talent not found.' };
    if (talent.className !== player.bot.className) return { success: false, error: 'Wrong class for this talent.' };
    const ok = player.bot.allocateTalent(talentId);
    if (!ok) return { success: false, error: 'Cannot allocate that talent right now.' };
    this.touch();
    this._broadcastState();
    return { success: true };
  }

  /* ── CHAT ─────────────────────────────────────────────── */
  addChatMessage(playerId, text, socketId) {
    const clean = sanitizeText(text);
    if (!clean) return;
    const player = this.players.get(playerId);
    const now = Date.now();
    if (player) {
      if (now - (player.lastChatAt || 0) < CHAT_COOLDOWN_MS) return;
      player.lastChatAt = now;
    }
    const authorName = player ? player.name : 'Spectator';
    const msg = {
      id: uuidv4(), authorName, text: clean, system: false, ts: now,
      classColor: player && player.bot ? CLASSES[player.bot.className].color : '#999999'
    };
    this.chatLog.push(msg);
    if (this.chatLog.length > CHAT_HISTORY_MAX) this.chatLog.shift();
    this.touch();
    this._emit('chatMessage', msg);
  }

  /* ── PHASE: PREP ──────────────────────────────────────── */
  _startPrepPhase() {
    this.round += 1;
    this.phase = 'prep';
    this.phaseEndsAt = Date.now() + PREP_MS;
    this._systemMessage(`Round ${this.round} — Prep phase! Shop and assign talents. ${PREP_MS / 1000}s remaining.`);
    this._broadcastState();

    clearTimeout(this.phaseTimeout);
    this.phaseTimeout = setTimeout(() => this._startBattlePhase(), PREP_MS);
  }

  /* ── PHASE: BATTLE ────────────────────────────────────── */
  _startBattlePhase() {
    clearTimeout(this.phaseTimeout);
    const activePlayers = [...this.players.values()].filter(p => p.bot);
    if (activePlayers.length < 2) {
      // Not enough bots to fight (shouldn't normally happen) — wait and retry
      this.phaseTimeout = setTimeout(() => this._startBattlePhase(), 5000);
      return;
    }

    this.phase = 'battle';
    this.phaseEndsAt = null;
    const bots = activePlayers.map(p => p.bot);
    this.combatEngine = new CombatEngine(bots);
    this._systemMessage(`Round ${this.round} — Fight!`);
    this._broadcastState();

    clearInterval(this.battleInterval);
    this.battleInterval = setInterval(() => {
      const result = this.combatEngine.tick(TICK_MS);
      this._emit('combatTick', { bots: result.bots, events: result.events, elapsed: result.elapsed });
      if (result.finished) {
        clearInterval(this.battleInterval);
        this.battleInterval = null;
        this._endBattlePhase();
      }
    }, TICK_MS);
  }

  _endBattlePhase() {
    const results = this.combatEngine.getResults();
    const activePlayers = [...this.players.values()].filter(p => p.bot);

    /* Rank: winner first, then by remaining HP%, then by damage dealt */
    const ranked = [...activePlayers].sort((a, b) => {
      const aWin = a.bot.id === results.winnerId ? 1 : 0;
      const bWin = b.bot.id === results.winnerId ? 1 : 0;
      if (aWin !== bWin) return bWin - aWin;
      const aHpPct = a.bot.alive ? a.bot.hp / a.bot.maxHp : 0;
      const bHpPct = b.bot.alive ? b.bot.hp / b.bot.maxHp : 0;
      if (aHpPct !== bHpPct) return bHpPct - aHpPct;
      return (results.damageDealt[b.bot.id] || 0) - (results.damageDealt[a.bot.id] || 0);
    });

    const goldPlacementBonus = [180, 90, 30];
    const xpPlacementBonus = [120, 60, 20];
    const roundSummary = [];

    ranked.forEach((player, idx) => {
      const dmg = results.damageDealt[player.bot.id] || 0;
      const heal = results.healingDone[player.bot.id] || 0;
      const goldGain = 120 + (goldPlacementBonus[idx] || 0) + Math.floor(dmg / 40);
      const xpGain = 100 + (xpPlacementBonus[idx] || 0) + Math.floor(dmg / 8);
      const leveledUp = player.bot.level;
      player.gold += goldGain;
      player.bot.addXP(xpGain);
      if (idx === 0) player.wins += 1;

      roundSummary.push({
        playerId: player.id, name: player.name, className: player.bot.className,
        placement: idx + 1, goldGain, xpGain, damageDealt: Math.floor(dmg), healingDone: Math.floor(heal),
        survived: player.bot.alive, wins: player.wins,
        leveledUp: player.bot.level > leveledUp
      });
    });

    if (ranked.length) {
      this._systemMessage(`${ranked[0].name} wins round ${this.round}!${results.timedOut ? ' (time limit)' : ''}`);
    }

    const matchWinner = [...this.players.values()].find(p => p.wins >= WINS_PER_MATCH);
    if (matchWinner) {
      this._systemMessage(`🏆 ${matchWinner.name} clinches the match at ${WINS_PER_MATCH} round wins! Starting a fresh match — gold, level, and gear carry over.`);
      for (const p of this.players.values()) p.wins = 0;
    }

    this.phase = 'roundEnd';
    this.phaseEndsAt = Date.now() + ROUND_END_MS;
    this._emit('roundResult', { round: this.round, summary: roundSummary, winnerId: results.winnerId, matchWinnerName: matchWinner ? matchWinner.name : null });
    this._broadcastState();

    clearTimeout(this.phaseTimeout);
    this.phaseTimeout = setTimeout(() => this._startPrepPhase(), ROUND_END_MS);
  }

  /* ── STATE SERIALIZATION ──────────────────────────────── */
  _broadcastState() { this._emit('roomState', this.getPublicState()); }

  getPublicState() {
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      phaseEndsAt: this.phaseEndsAt,
      winsPerMatch: WINS_PER_MATCH,
      spectatorCount: this.spectators.size,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, className: p.className, ready: p.ready,
        connected: p.connected, gold: p.gold, wins: p.wins,
        bot: p.bot ? p.bot.serialize() : null
      })),
      chatLog: this.chatLog.slice(-40),
      battleSnapshot: this.combatEngine && this.phase === 'battle'
        ? { bots: this.combatEngine.bots.map(b => b.serialize()), elapsed: this.combatEngine.elapsed }
        : null
    };
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.battleInterval);
    clearTimeout(this.phaseTimeout);
    for (const p of this.players.values()) {
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    }
  }
}

module.exports = GameRoom;
