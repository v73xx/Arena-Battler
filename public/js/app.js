'use strict';
/* ============================================================
   APP — entry point. Owns the socket connection and game state;
   delegates rendering to UI and ArenaRenderer.
   ============================================================ */
(function () {
  const STORAGE_PLAYER_ID = 'aetherfall_playerId';
  const STORAGE_NAME = 'aetherfall_name';
  const STORAGE_ROOM_CODE = 'aetherfall_roomCode';

  let socket = null;
  let myPlayerId = null;
  let myRoomCode = null;
  let isSpectator = false;
  let lastState = null;
  let currentScreen = null; // 'lobby' | 'game'
  let lastPhase = null;
  let roundOverlayShowing = false;
  let lootOverlayShowing = false;
  let gameOverOverlayShowing = false;
  let currentLootData = null;

  function generateId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function loadOrCreatePlayerId() {
    let id = localStorage.getItem(STORAGE_PLAYER_ID);
    if (!id) { id = generateId(); localStorage.setItem(STORAGE_PLAYER_ID, id); }
    return id;
  }

  /* ── SCREEN MANAGEMENT ────────────────────────────────── */
  function ensureScreen(target) {
    if (currentScreen === target) return;
    currentScreen = target;
    if (target === 'game') {
      UI.showGameScreen();
      ArenaRenderer.resize();
      ArenaRenderer.start();
    } else {
      ArenaRenderer.stop();
      UI.showLobbyScreen();
    }
  }

  /* ── STATE HANDLING ───────────────────────────────────── */
  function handleRoomState(state) {
    lastState = state;

    if (isSpectator) {
      ensureScreen('game');
    } else {
      ensureScreen(state.phase === 'lobby' ? 'lobby' : 'game');
    }

    if (currentScreen === 'lobby') {
      UI.renderLobby(state);
      return;
    }

    UI.renderTopBar(state);
    UI.renderRosterRail(state);
    UI.renderShopList(state);
    UI.renderTalentPanel(state);

    if (state.phase === 'battle' && lastPhase !== 'battle') {
      const initialBots = state.battleSnapshot ? state.battleSnapshot.bots : [];
      ArenaRenderer.beginBattle(initialBots);
    } else if (state.phase !== 'battle' && lastPhase === 'battle') {
      ArenaRenderer.endBattle();
    }
    if (state.phase !== 'battle') {
      ArenaRenderer.setIdleBots(state.players);
    }

    // Round-result overlay only belongs to the roundEnd phase. A client that
    // reconnects mid-roundEnd won't have the original roundResult payload
    // (it's a one-shot event, not part of room state) — but that window is
    // brief and they'll see loot/prep moments later regardless.
    if (state.phase !== 'roundEnd' && roundOverlayShowing) {
      UI.hideRoundOverlay();
      roundOverlayShowing = false;
    }

    // Loot overlay is reconnect-safe: state.lootState carries everything
    // needed to render it, so a client joining mid-loot-phase still sees it.
    if (state.phase === 'loot' && state.lootState) {
      currentLootData = state.lootState;
      UI.showLootOverlay(currentLootData);
      lootOverlayShowing = true;
    } else if (state.phase !== 'loot' && lootOverlayShowing) {
      UI.hideLootOverlay();
      lootOverlayShowing = false;
      currentLootData = null;
    }

    // Game-over overlay is also reconnect-safe via cached standings.
    if (state.phase === 'gameOver' && state.gameOverStandings) {
      const isHost = state.hostId === myPlayerId;
      UI.showGameOverOverlay({ standings: state.gameOverStandings }, isHost);
      gameOverOverlayShowing = true;
    } else if (state.phase !== 'gameOver' && gameOverOverlayShowing) {
      UI.hideGameOverOverlay();
      gameOverOverlayShowing = false;
    }

    lastPhase = state.phase;
  }

  function updateRosterFromTick(tickBots) {
    if (!lastState) return;
    const merged = {
      ...lastState,
      players: lastState.players.map(p => {
        if (!p.bot) return p;
        const live = tickBots.find(b => b.id === p.bot.id);
        return live ? { ...p, bot: live } : p;
      })
    };
    UI.renderRosterRail(merged);
  }

  /* ── SOCKET SETUP ─────────────────────────────────────── */
  function setupSocket() {
    socket = io();

    socket.on('connect', () => {
      const savedCode = localStorage.getItem(STORAGE_ROOM_CODE);
      const savedName = localStorage.getItem(STORAGE_NAME) || '';
      if (savedCode) {
        UI.showConnectionOverlay('Rejoining the arena…');
        socket.emit('joinRoom', { code: savedCode, name: savedName, playerId: myPlayerId });
      } else {
        UI.hideConnectionOverlay();
        document.getElementById('nameInput').value = savedName;
        ensureScreen('lobby');
        UI.showEntryPanel();
      }
    });

    socket.on('disconnect', () => {
      UI.showConnectionOverlay('Connection lost — reconnecting…');
    });

    socket.on('connect_error', () => {
      UI.showConnectionOverlay('Having trouble reaching the arena…');
    });

    socket.on('roomJoined', ({ roomCode, playerId, state }) => {
      isSpectator = false;
      myPlayerId = playerId;
      myRoomCode = roomCode;
      localStorage.setItem(STORAGE_PLAYER_ID, playerId);
      localStorage.setItem(STORAGE_ROOM_CODE, roomCode);
      UI.setMyPlayerId(playerId);
      UI.renderFullChat(state.chatLog);
      handleRoomState(state);
      UI.hideConnectionOverlay();
    });

    socket.on('spectating', ({ roomCode, playerId, reason, state }) => {
      isSpectator = true;
      myPlayerId = playerId;
      myRoomCode = roomCode;
      UI.setMyPlayerId(playerId);
      UI.renderFullChat(state.chatLog);
      if (reason) UI.showToast(reason);
      handleRoomState(state);
      UI.hideConnectionOverlay();
    });

    socket.on('roomState', handleRoomState);

    socket.on('combatTick', (data) => {
      ArenaRenderer.applyTick(data);
      updateRosterFromTick(data.bots);
    });

    socket.on('roundResult', (data) => {
      const classByPlayer = {};
      if (lastState) for (const p of lastState.players) classByPlayer[p.id] = p.className;
      UI.showRoundOverlay(data, classByPlayer);
      roundOverlayShowing = true;
    });

    socket.on('lootPhaseStart', (data) => {
      currentLootData = data;
      UI.showLootOverlay(currentLootData);
      lootOverlayShowing = true;
    });

    socket.on('lootRollUpdate', (rollData) => {
      if (!currentLootData) return;
      UI.updateLootRoll(rollData, currentLootData);
    });

    socket.on('crateOpened', (evt) => {
      if (currentLootData && currentLootData.winnerCrate) currentLootData.winnerCrate.opened = true;
      UI.updateLootCrateOpened(evt);
    });

    socket.on('lootPhaseResult', (data) => {
      currentLootData = data;
      UI.markLootResolved(data);
    });

    socket.on('gameOver', (data) => {
      const isHost = lastState && lastState.hostId === myPlayerId;
      UI.showGameOverOverlay(data, isHost);
      gameOverOverlayShowing = true;
    });

    socket.on('chatMessage', (msg) => UI.appendChatMessage(msg));

    socket.on('actionError', ({ error }) => UI.showToast(error || 'Something went wrong.'));
  }

  /* ── ACTIONS ──────────────────────────────────────────── */
  function bindActions() {
    UI.bindActions({
      onCreateRoom: (name) => {
        localStorage.setItem(STORAGE_NAME, name);
        localStorage.removeItem(STORAGE_ROOM_CODE);
        UI.showConnectionOverlay('Carving out a new arena…');
        socket.emit('createRoom', { name, playerId: myPlayerId });
      },
      onJoinRoom: (name, code) => {
        localStorage.setItem(STORAGE_NAME, name);
        UI.showConnectionOverlay('Entering the arena…');
        socket.emit('joinRoom', { name, code: code.toUpperCase(), playerId: myPlayerId });
      },
      onSelectClass: (className) => socket.emit('selectClass', { className }),
      onSetReady: (ready) => socket.emit('setReady', { ready }),
      onStartGame: () => socket.emit('startGame'),
      onBuyItem: (itemId) => socket.emit('buyItem', { itemId }),
      onAllocateTalent: (talentId) => socket.emit('allocateTalent', { talentId }),
      onRespecTalents: () => socket.emit('respecTalents'),
      onSendChat: (text) => socket.emit('chatMessage', { text }),
      onEndGame: () => socket.emit('endGame'),
      onPlayAgain: () => socket.emit('playAgain'),
      onOpenCrate: () => socket.emit('openCrate'),
      onRollForLoot: () => socket.emit('rollForLoot')
    });
  }

  /* ── BOOT ─────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    myPlayerId = loadOrCreatePlayerId();
    UI.init();
    UI.setMyPlayerId(myPlayerId);
    ArenaRenderer.init(document.getElementById('arenaCanvas'));
    bindActions();
    setupSocket();
  });
})();
