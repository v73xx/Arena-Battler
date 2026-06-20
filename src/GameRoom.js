'use strict';
const { v4: uuidv4 } = require('uuid');
const { CLASSES, SHOP_ITEMS, TALENT_TREES } = require('../public/js/gameData');
const Bot = require('./Bot');
const CombatEngine = require('./CombatEngine');
const { generateLootItem } = require('./LootGenerator');

const MAX_PLAYERS      = 3;
const PREP_MS          = parseInt(process.env.ARENA_PREP_MS, 10)       || 45000;
const ROUND_END_MS     = parseInt(process.env.ARENA_ROUND_END_MS, 10)  || 7000;
const LOOT_MS          = parseInt(process.env.ARENA_LOOT_MS, 10)       || 14000;
const TICK_MS          = 100;
const MAX_ROUNDS       = parseInt(process.env.ARENA_MAX_ROUNDS, 10)    || 5;
const MATCH_POINT_WINS = 3; // flavor-text milestone only, no longer force-ends the game
const DISCONNECT_GRACE = 120000; // 2 minutes
const STARTING_GOLD    = 500;
const CHAT_MAX_LEN     = 240;
const CHAT_HISTORY_MAX = 60;
const CHAT_COOLDOWN_MS = 300;

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
    this.phase = 'lobby';         // lobby | prep | battle | roundEnd | loot | gameOver
    this.round = 0;
    this.hostId = null;
    this.chatLog = [];
    this.combatEngine = null;
    this.battleInterval = null;
    this.phaseTimeout = null;
    this.phaseEndsAt = null;
    this.lootState = null;        // { winnerCrate, worldDrop } — see _startLootPhase
    this.lastGameOverStandings = null;
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

  _assignHostIfNeeded() {
    if (this.hostId && this.players.has(this.hostId)) return; // current host still valid
    const connected = [...this.players.values()].filter(p => p.connected);
    const fallback = connected[0] || [...this.players.values()][0];
    this.hostId = fallback ? fallback.id : null;
  }

  /* ── PLAYER MANAGEMENT ────────────────────────────────── */
  addPlayer(playerId, name, socket) {
    const existing = this.players.get(playerId);
    if (existing) {
      existing.connected = true;
      existing.socketId = socket.id;
      if (existing.disconnectTimer) { clearTimeout(existing.disconnectTimer); existing.disconnectTimer = null; }
      socket.join(this.code);
      this._assignHostIfNeeded();
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
    const wasEmpty = this.players.size === 0;
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
    if (wasEmpty) this.hostId = playerId;
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
    this._assignHostIfNeeded();
    this._broadcastState();
    player.disconnectTimer = setTimeout(() => {
      this.players.delete(playerId);
      this._assignHostIfNeeded();
      this._broadcastState();
      if (this._isEmpty() && onEmptyCallback) onEmptyCallback();
    }, DISCONNECT_GRACE);
  }

  _isEmpty() {
    if (this.spectators.size > 0) return false;
    for (const p of this.players.values()) if (p.connected) return false;
    return this.players.size === 0;
  }

  isHost(playerId) { return this.hostId === playerId; }

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
    this._systemMessage(`The gates open! First to the most wins after ${MAX_ROUNDS} rounds takes the arena.`);
    this._startPrepPhase();
    return { success: true };
  }

  /* ── HOST CONTROLS ────────────────────────────────────── */
  endGame(playerId) {
    if (!this.isHost(playerId)) return { success: false, error: 'Only the host can end the game.' };
    if (this.phase === 'lobby') return { success: false, error: 'The game has not started yet.' };
    if (this.phase === 'gameOver') return { success: false, error: 'The game has already ended.' };

    clearTimeout(this.phaseTimeout);
    clearInterval(this.battleInterval);
    this.battleInterval = null;
    this._systemMessage('The host has called an end to the match.');
    this._goToGameOver();
    return { success: true };
  }

  playAgain(playerId) {
    if (!this.isHost(playerId)) return { success: false, error: 'Only the host can start a new game.' };
    if (this.phase !== 'gameOver') return { success: false, error: 'The current game has not ended yet.' };

    clearTimeout(this.phaseTimeout);
    clearInterval(this.battleInterval);
    this.battleInterval = null;
    this.combatEngine = null;
    this.lootState = null;
    this.lastGameOverStandings = null;
    this.round = 0;
    this.phase = 'lobby';
    this.phaseEndsAt = null;
    for (const player of this.players.values()) {
      player.className = null;
      player.bot = null;
      player.ready = false;
      player.gold = STARTING_GOLD;
      player.wins = 0;
    }
    this._systemMessage('A new game begins! Choose your champions.');
    this._broadcastState();
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
    if (player.bot.hasItem(itemId)) return { success: false, error: 'Already owned.' };
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
    if (!ok) return { success: false, error: 'That talent is locked, maxed, or you have no points to spend.' };
    this.touch();
    this._broadcastState();
    return { success: true };
  }

  respecTalents(playerId) {
    if (this.phase === 'battle') return { success: false, error: 'Cannot respec during battle.' };
    const player = this.players.get(playerId);
    if (!player || !player.bot) return { success: false, error: 'Player not found.' };
    const ok = player.bot.respecTalents();
    if (!ok) return { success: false, error: 'No talent points to refund.' };
    this.touch();
    this._systemMessage(`${player.name} reset their talents.`);
    this._broadcastState();
    return { success: true };
  }

  /* ── LOOT: CRATE + WORLD-DROP ROLL ─────────────────────── */
  openCrate(playerId) {
    if (this.phase !== 'loot' || !this.lootState) return { success: false, error: 'No crate available right now.' };
    const crate = this.lootState.winnerCrate;
    if (!crate || crate.playerId !== playerId) return { success: false, error: 'This crate is not yours to open.' };
    if (crate.opened) return { success: false, error: 'Already opened.' };
    const player = this.players.get(playerId);
    if (!player || !player.bot) return { success: false, error: 'Player not found.' };

    crate.opened = true;
    player.bot.applyItem(crate.item);
    this._emit('crateOpened', { playerId, playerName: player.name, item: crate.item });
    this.touch();
    this._broadcastState();
    return { success: true };
  }

  rollForLoot(playerId) {
    if (this.phase !== 'loot' || !this.lootState) return { success: false, error: 'No roll available right now.' };
    const drop = this.lootState.worldDrop;
    if (!drop || drop.resolved) return { success: false, error: 'That item has already been claimed.' };
    const player = this.players.get(playerId);
    if (!player || !player.bot) return { success: false, error: 'Player not found.' };
    if (Object.prototype.hasOwnProperty.call(drop.rolls, playerId)) return { success: false, error: 'You already rolled.' };

    const roll = 1 + Math.floor(Math.random() * 100);
    drop.rolls[playerId] = roll;
    this._emit('lootRollUpdate', { playerId, playerName: player.name, roll });
    this.touch();

    const activeIds = [...this.players.values()].filter(p => p.bot).map(p => p.id);
    const allRolled = activeIds.every(id => Object.prototype.hasOwnProperty.call(drop.rolls, id));
    if (allRolled) this._resolveLootPhase();
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
    this.lootState = null;
    this.phaseEndsAt = Date.now() + PREP_MS;
    this._systemMessage(`Round ${this.round}/${MAX_ROUNDS} — Prep phase! Shop and assign talents. ${PREP_MS / 1000}s remaining.`);
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
    this._systemMessage(`Round ${this.round}/${MAX_ROUNDS} — Fight!`);
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

    /* Reward formula: placement is the dominant factor. The damage-based
       bonus is normalized to each player's SHARE of total damage dealt in
       the fight (0..1), not a raw absolute number — this is the fix for a
       reported bug where one player consistently earned ~3x XP regardless
       of placement. The root cause: magic damage types weren't mitigated
       by armor at all, so caster classes racked up much larger raw damage
       totals than melee classes for the same relative performance, and the
       old formula added a flat amount per point of raw damage. Two fixes
       compound here: armor now partially mitigates magic damage too (see
       CombatEngine), AND the bonus is now a bounded share-of-total rather
       than an unbounded raw number. */
    const totalDamage = ranked.reduce((sum, p) => sum + (results.damageDealt[p.bot.id] || 0), 0) || 1;
    const goldPlacementBonus = [150, 80, 30];
    const xpPlacementBonus = [140, 70, 25];
    const roundSummary = [];

    ranked.forEach((player, idx) => {
      const dmg = results.damageDealt[player.bot.id] || 0;
      const heal = results.healingDone[player.bot.id] || 0;
      const dmgShare = dmg / totalDamage; // 0..1, bounded regardless of raw numbers
      const goldGain = 90 + (goldPlacementBonus[idx] || 0) + Math.floor(dmgShare * 70);
      const xpGain = 80 + (xpPlacementBonus[idx] || 0) + Math.floor(dmgShare * 90);
      const levelBefore = player.bot.level;
      player.gold += goldGain;
      player.bot.addXP(xpGain);
      if (idx === 0) player.wins += 1;

      roundSummary.push({
        playerId: player.id, name: player.name, className: player.bot.className,
        placement: idx + 1, goldGain, xpGain, damageDealt: Math.floor(dmg), healingDone: Math.floor(heal),
        survived: player.bot.alive, wins: player.wins,
        leveledUp: player.bot.level > levelBefore
      });
    });

    if (ranked.length) {
      this._systemMessage(`${ranked[0].name} wins round ${this.round}!${results.timedOut ? ' (time limit)' : ''}`);
    }

    const matchPointPlayer = [...this.players.values()].find(p => p.wins === MATCH_POINT_WINS);
    if (matchPointPlayer && this.round < MAX_ROUNDS) {
      this._systemMessage(`🔥 ${matchPointPlayer.name} is on a roll with ${MATCH_POINT_WINS} round wins!`);
    }

    this.phase = 'roundEnd';
    this.phaseEndsAt = Date.now() + ROUND_END_MS;
    this._emit('roundResult', { round: this.round, summary: roundSummary, winnerId: results.winnerId });
    this._broadcastState();

    const winnerPlayer = ranked.length ? ranked[0] : null;
    clearTimeout(this.phaseTimeout);
    this.phaseTimeout = setTimeout(() => this._startLootPhase(winnerPlayer ? winnerPlayer.id : null), ROUND_END_MS);
  }

  /* ── PHASE: LOOT ──────────────────────────────────────── */
  _startLootPhase(roundWinnerId) {
    const activePlayers = [...this.players.values()].filter(p => p.bot);
    if (activePlayers.length === 0) { this._goToGameOver(); return; }

    const avgLevel = activePlayers.reduce((sum, p) => sum + p.bot.level, 0) / activePlayers.length;
    const winner = roundWinnerId ? this.players.get(roundWinnerId) : null;

    const winnerCrateItem = winner && winner.bot
      ? generateLootItem(avgLevel, winner.bot.className)
      : null;
    const worldDropItem = generateLootItem(avgLevel, null);

    this.lootState = {
      winnerCrate: winnerCrateItem ? { playerId: winner.id, playerName: winner.name, item: winnerCrateItem, opened: false } : null,
      worldDrop: { item: worldDropItem, rolls: {}, resolved: false, winnerId: null }
    };

    this.phase = 'loot';
    this.phaseEndsAt = Date.now() + LOOT_MS;
    if (winner) {
      this._systemMessage(`🎁 ${winner.name} earned a crate! A world-drop item is also up for roll — type /roll or click Roll.`);
    } else {
      this._systemMessage(`🎁 A world-drop item is up for roll!`);
    }
    this._emit('lootPhaseStart', { ...this.lootState, lootEndsAt: this.phaseEndsAt });
    this._broadcastState();

    clearTimeout(this.phaseTimeout);
    this.phaseTimeout = setTimeout(() => this._resolveLootPhase(), LOOT_MS);
  }

  _resolveLootPhase() {
    if (!this.lootState) { this._afterLoot(); return; }
    clearTimeout(this.phaseTimeout);

    // Auto-open the winner crate if they never clicked it — nothing is lost.
    const crate = this.lootState.winnerCrate;
    if (crate && !crate.opened) {
      const player = this.players.get(crate.playerId);
      if (player && player.bot) {
        crate.opened = true;
        player.bot.applyItem(crate.item);
        this._emit('crateOpened', { playerId: crate.playerId, playerName: player.name, item: crate.item, autoOpened: true });
      }
    }

    // Resolve the world-drop roll among whoever rolled in time.
    const drop = this.lootState.worldDrop;
    if (drop && !drop.resolved) {
      drop.resolved = true;
      const entries = Object.entries(drop.rolls); // [playerId, roll][]
      if (entries.length > 0) {
        const maxRoll = Math.max(...entries.map(([, r]) => r));
        const topRollers = entries.filter(([, r]) => r === maxRoll).map(([id]) => id);
        const winnerId = topRollers[Math.floor(Math.random() * topRollers.length)];
        drop.winnerId = winnerId;
        const winnerPlayer = this.players.get(winnerId);
        if (winnerPlayer && winnerPlayer.bot) {
          winnerPlayer.bot.applyItem(drop.item);
        }
        this._systemMessage(`🎲 ${winnerPlayer ? winnerPlayer.name : 'Someone'} won the roll for ${drop.item.name} (${maxRoll})!`);
      } else {
        this._systemMessage(`No one rolled — the world-drop item goes unclaimed.`);
      }
    }

    this._emit('lootPhaseResult', { ...this.lootState });
    this._broadcastState();
    this._afterLoot();
  }

  _afterLoot() {
    if (this.round >= MAX_ROUNDS) {
      this._goToGameOver();
    } else {
      this._startPrepPhase();
    }
  }

  /* ── PHASE: GAME OVER ─────────────────────────────────── */
  _goToGameOver() {
    clearTimeout(this.phaseTimeout);
    clearInterval(this.battleInterval);
    this.battleInterval = null;
    this.phase = 'gameOver';
    this.phaseEndsAt = null;
    this.lootState = null;

    const standings = [...this.players.values()]
      .filter(p => p.bot)
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.bot.level !== a.bot.level) return b.bot.level - a.bot.level;
        return b.gold - a.gold;
      })
      .map((p, idx) => ({
        playerId: p.id, name: p.name, className: p.className,
        wins: p.wins, level: p.bot.level, gold: p.gold, placement: idx + 1
      }));

    if (standings.length) {
      this._systemMessage(`🏆 The arena falls silent. ${standings[0].name} takes the crown with ${standings[0].wins} round win${standings[0].wins === 1 ? '' : 's'}!`);
    }
    this.lastGameOverStandings = standings;
    this._emit('gameOver', { standings, roundsPlayed: this.round });
    this._broadcastState();
  }

  /* ── STATE SERIALIZATION ──────────────────────────────── */
  _broadcastState() { this._emit('roomState', this.getPublicState()); }

  getPublicState() {
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      maxRounds: MAX_ROUNDS,
      phaseEndsAt: this.phaseEndsAt,
      hostId: this.hostId,
      spectatorCount: this.spectators.size,
      lootState: this.lootState,
      gameOverStandings: this.phase === 'gameOver' ? this.lastGameOverStandings : null,
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
