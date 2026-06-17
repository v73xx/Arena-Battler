'use strict';
/* ============================================================
   UI MODULE
   Pure-ish DOM rendering. Holds no socket logic — app.js feeds
   it state and supplies action callbacks via bindActions().
   ============================================================ */
const UI = (function () {
  const GD = window.GAME_DATA;
  let actions = {};
  let renderedChatIds = new Set();
  let selectedShopCategory = 'all';
  let lastPhaseEndsAt = null;
  let myPlayerIdRef = null;

  const $ = (id) => document.getElementById(id);

  /* ── INIT ──────────────────────────────────────────────── */
  function bindActions(a) { actions = a; }

  function init() {
    $('createRoomBtn').addEventListener('click', () => {
      const name = $('nameInput').value.trim();
      actions.onCreateRoom && actions.onCreateRoom(name);
    });
    $('joinRoomBtn').addEventListener('click', () => {
      const name = $('nameInput').value.trim();
      const code = $('codeInput').value.trim();
      if (!code) { showToast('Enter a 4-character arena code.'); return; }
      actions.onJoinRoom && actions.onJoinRoom(name, code);
    });
    $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinRoomBtn').click(); });
    $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('createRoomBtn').click(); });

    $('copyCodeBtn').addEventListener('click', () => {
      const code = $('roomCodeDisplay').textContent;
      copyToClipboard(code);
      showToast('Arena code copied!');
    });

    $('readyBtn').addEventListener('click', () => {
      const nowReady = $('readyBtn').classList.contains('is-ready');
      actions.onSetReady && actions.onSetReady(!nowReady);
    });
    $('startBtn').addEventListener('click', () => actions.onStartGame && actions.onStartGame());

    document.querySelectorAll('.side-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.side-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        tab.classList.add('active');
        $(tab.dataset.tab).classList.remove('hidden');
      });
    });

    $('chatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('chatInput');
      const text = input.value.trim();
      if (!text) return;
      actions.onSendChat && actions.onSendChat(text);
      input.value = '';
    });

    $('menuToggleBtn').addEventListener('click', () => {
      $('sidePanel').classList.toggle('open');
    });
    $('arenaWrap').addEventListener('click', () => {
      $('sidePanel').classList.remove('open');
    });

    renderShopCategories();
    startPhaseTimerLoop();
  }

  function setMyPlayerId(id) { myPlayerIdRef = id; }

  /* ── SCREEN SWITCHING ─────────────────────────────────── */
  function showConnectionOverlay(text) {
    $('connectionStatus').textContent = text || 'Connecting…';
    $('connectionOverlay').classList.remove('hidden');
    $('connectionOverlay').style.opacity = '1';
  }
  function hideConnectionOverlay() {
    const el = $('connectionOverlay');
    el.style.opacity = '0';
    setTimeout(() => el.classList.add('hidden'), 400);
  }
  function showLobbyScreen() {
    $('lobbyScreen').classList.remove('hidden');
    $('gameScreen').classList.add('hidden');
  }
  function showGameScreen() {
    $('lobbyScreen').classList.add('hidden');
    $('gameScreen').classList.remove('hidden');
  }
  function showEntryPanel() {
    $('entryPanel').classList.remove('hidden');
    $('roomPanel').classList.add('hidden');
  }
  function showRoomPanel(code) {
    $('entryPanel').classList.add('hidden');
    $('roomPanel').classList.remove('hidden');
    $('roomCodeDisplay').textContent = code;
  }

  /* ── TOASTS ───────────────────────────────────────────── */
  function showToast(message) {
    const host = $('toastHost');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  /* ── CLASS GRID (lobby) ───────────────────────────────── */
  function renderClassGrid(selectedClassName) {
    const grid = $('classGrid');
    grid.innerHTML = '';
    for (const [key, cls] of Object.entries(GD.CLASSES)) {
      const card = document.createElement('div');
      card.className = 'class-card' + (key === selectedClassName ? ' selected' : '');
      card.innerHTML = `
        <span class="class-icon">${cls.icon}</span>
        <span class="class-name">${cls.name}</span>
        <span class="class-role">${cls.role}</span>`;
      card.title = cls.description;
      card.addEventListener('click', () => actions.onSelectClass && actions.onSelectClass(key));
      grid.appendChild(card);
    }
  }

  /* ── LOBBY ROSTER ─────────────────────────────────────── */
  function renderLobby(state) {
    showRoomPanel(state.code);
    const me = state.players.find(p => p.id === myPlayerIdRef);
    renderClassGrid(me ? me.className : null);

    const readyBtn = $('readyBtn');
    const startBtn = $('startBtn');
    if (me && me.className) {
      readyBtn.disabled = false;
      readyBtn.textContent = me.ready ? 'Cancel Ready' : 'Ready Up';
      readyBtn.classList.toggle('is-ready', !!me.ready);
    } else {
      readyBtn.disabled = true;
      readyBtn.textContent = 'Ready Up';
      readyBtn.classList.remove('is-ready');
    }
    const connected = state.players.filter(p => p.connected);
    const canStart = connected.length >= 2 && connected.every(p => p.ready && p.className);
    startBtn.disabled = !canStart;

    const roster = $('lobbyRoster');
    roster.innerHTML = '';
    const seats = 3;
    for (let i = 0; i < seats; i++) {
      const p = state.players[i];
      const row = document.createElement('div');
      row.className = 'lobby-roster-row';
      if (!p) {
        row.innerHTML = `<span class="seat-icon">⬚</span><span class="seat-name">Open seat</span><span class="seat-status status-empty">Waiting…</span>`;
      } else {
        const cls = p.className ? GD.CLASSES[p.className] : null;
        const statusClass = !p.connected ? 'status-waiting' : (p.ready ? 'status-ready' : 'status-waiting');
        const statusText = !p.connected ? 'Reconnecting…' : (p.ready ? 'Ready' : (p.className ? 'Choosing…' : 'Picking class'));
        row.innerHTML = `
          <span class="seat-icon">${cls ? cls.icon : '❔'}</span>
          <span class="seat-name">${escapeHtml(p.name)}${p.id === myPlayerIdRef ? ' (you)' : ''}</span>
          <span class="seat-status ${statusClass}">${statusText}</span>`;
      }
      roster.appendChild(row);
    }
    $('spectatorCount').textContent = state.spectatorCount > 0 ? `👁 ${state.spectatorCount} watching` : '';
  }

  /* ── TOP BAR ──────────────────────────────────────────── */
  function renderTopBar(state) {
    $('hudRoomCode').textContent = state.code;
    const phaseLabels = { lobby: 'Lobby', prep: 'Prep Phase', battle: 'Battle!', roundEnd: 'Round Results' };
    $('phaseLabel').textContent = `Round ${state.round || 0} — ${phaseLabels[state.phase] || state.phase}`;
    lastPhaseEndsAt = state.phaseEndsAt;

    const score = $('matchScore');
    score.innerHTML = '';
    for (const p of state.players) {
      const cls = p.className ? GD.CLASSES[p.className] : null;
      const item = document.createElement('span');
      item.className = 'ms-item';
      item.innerHTML = `${cls ? cls.icon : '❔'} ${p.wins}/${state.winsPerMatch}`;
      score.appendChild(item);
    }

    $('prepBanner').classList.toggle('hidden', state.phase !== 'prep');
  }

  function startPhaseTimerLoop() {
    setInterval(() => {
      const wrap = $('phaseTimerWrap');
      if (!lastPhaseEndsAt) { wrap.classList.add('hidden'); return; }
      const remainingMs = lastPhaseEndsAt - Date.now();
      if (remainingMs <= 0) { wrap.classList.add('hidden'); return; }
      wrap.classList.remove('hidden');
      const totalMs = 45000;
      const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
      $('phaseTimerBar').style.width = pct + '%';
      $('phaseTimerText').textContent = Math.ceil(remainingMs / 1000) + 's';
    }, 200);
  }

  /* ── ROSTER RAIL ──────────────────────────────────────── */
  function renderRosterRail(state) {
    const rail = $('rosterRail');
    rail.innerHTML = '';
    for (const p of state.players) {
      if (!p.bot) continue;
      const cls = GD.CLASSES[p.className];
      const card = document.createElement('div');
      card.className = 'roster-card' + (p.id === myPlayerIdRef ? ' is-self' : '') + (!p.bot.alive ? ' is-dead' : '');
      const hpPct = Math.max(0, Math.min(100, (p.bot.hp / p.bot.maxHp) * 100));
      const manaPct = Math.max(0, Math.min(100, (p.bot.mana / p.bot.maxMana) * 100));
      card.innerHTML = `
        <div class="roster-card-head">
          <div class="roster-class-icon" style="background:${cls.color}33; border-color:${cls.color};">${cls.icon}</div>
          <div class="roster-name-block">
            <div class="roster-name">${escapeHtml(p.name)}</div>
            <div class="roster-level">Lv${p.bot.level} ${cls.name}${!p.connected ? ' · offline' : ''}</div>
          </div>
        </div>
        <div class="roster-bar-track"><div class="roster-bar-fill bar-hp" style="width:${hpPct}%"></div></div>
        <div class="roster-bar-track"><div class="roster-bar-fill bar-mana" style="width:${manaPct}%"></div></div>
        <div class="roster-meta-row">
          <span class="roster-gold">${p.gold}g</span>
          <span>${p.bot.talentPoints > 0 ? `+${p.bot.talentPoints} talent` : ''}</span>
          <span>${p.wins} win${p.wins === 1 ? '' : 's'}</span>
        </div>`;
      rail.appendChild(card);
    }
  }

  /* ── SHOP PANEL ───────────────────────────────────────── */
  function renderShopCategories() {
    const cats = [['all', 'All'], ['weapon', 'Weapons'], ['armor', 'Armor'], ['trinket', 'Trinkets']];
    const host = $('shopCategories');
    host.innerHTML = '';
    cats.forEach(([key, label]) => {
      const btn = document.createElement('button');
      btn.className = 'shop-cat-btn' + (key === selectedShopCategory ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        selectedShopCategory = key;
        document.querySelectorAll('.shop-cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderShopList(window.__lastState);
      });
      host.appendChild(btn);
    });
  }

  function renderShopList(state) {
    if (!state) return;
    window.__lastState = state;
    const me = state.players.find(p => p.id === myPlayerIdRef);
    const list = $('shopList');
    list.innerHTML = '';
    if (!me || !me.bot) {
      list.innerHTML = '<p style="color:var(--parchment-dark);font-size:0.8rem;">Select a class to browse gear.</p>';
      return;
    }
    $('goldAmount').textContent = me.gold;

    const items = GD.SHOP_ITEMS.filter(it => selectedShopCategory === 'all' || it.category === selectedShopCategory);
    for (const item of items) {
      const compatible = item.classes.includes('all') || item.classes.includes(me.className);
      if (!compatible) continue;
      const owned = me.bot.items.includes(item.id);
      const affordable = me.gold >= item.cost;
      const card = document.createElement('div');
      card.className = 'shop-item-card' + (owned ? ' owned' : (affordable ? ' affordable' : ' unaffordable'));
      card.innerHTML = `
        <span class="shop-item-icon">${item.icon}</span>
        <div class="shop-item-info">
          <div class="shop-item-name">${item.name}</div>
          <div class="shop-item-desc">${item.description}</div>
          <span class="shop-item-tag">Tier ${item.tier}</span>
        </div>
        <div class="shop-item-cost">${owned ? 'Owned' : item.cost + 'g'}</div>`;
      if (!owned) {
        card.addEventListener('click', () => actions.onBuyItem && actions.onBuyItem(item.id));
      }
      list.appendChild(card);
    }
  }

  /* ── TALENT PANEL ─────────────────────────────────────── */
  const TREE_LABELS = { offense: 'Offense', defense: 'Defense', mastery: 'Mastery' };

  function renderTalentPanel(state) {
    const me = state.players.find(p => p.id === myPlayerIdRef);
    const host = $('talentTrees');
    if (!me || !me.bot) {
      $('talentPointsAmount').textContent = '0';
      host.innerHTML = '<p style="color:var(--parchment-dark);font-size:0.8rem;">Select a class to view talents.</p>';
      return;
    }
    $('talentPointsAmount').textContent = me.bot.talentPoints;

    const allTalents = Object.values(GD.TALENT_TREES).filter(t => t.className === me.className);
    const grouped = { offense: [], defense: [], mastery: [] };
    for (const t of allTalents) grouped[t.tree].push(t);
    for (const k in grouped) grouped[k].sort((a, b) => a.tier - b.tier);

    host.innerHTML = '';
    for (const tree of ['offense', 'defense', 'mastery']) {
      const group = document.createElement('div');
      group.className = 'talent-tree-group';
      const label = document.createElement('div');
      label.className = 'talent-tree-label';
      label.textContent = TREE_LABELS[tree];
      group.appendChild(label);

      for (const talent of grouped[tree]) {
        const rank = (me.bot.talents && me.bot.talents[talent.id]) || 0;
        const maxed = rank >= talent.maxRank;
        const locked = me.bot.talentPoints <= 0 && !maxed;
        const node = document.createElement('div');
        node.className = 'talent-node' + (maxed ? ' maxed' : '') + (locked ? ' locked' : '');
        const pips = Array.from({ length: talent.maxRank }, (_, i) =>
          `<span class="talent-pip${i < rank ? ' filled' : ''}"></span>`).join('');
        node.innerHTML = `
          <span class="talent-icon">${talent.icon}</span>
          <div class="talent-info">
            <div class="talent-name">${talent.name}</div>
            <div class="talent-desc">${talent.description}</div>
          </div>
          <div class="talent-pips">${pips}</div>`;
        if (!maxed) node.addEventListener('click', () => actions.onAllocateTalent && actions.onAllocateTalent(talent.id));
        group.appendChild(node);
      }
      host.appendChild(group);
    }
  }

  /* ── CHAT ─────────────────────────────────────────────── */
  function renderFullChat(messages) {
    const host = $('chatMessages');
    host.innerHTML = '';
    renderedChatIds = new Set();
    for (const m of messages) appendChatMessage(m, false);
    host.scrollTop = host.scrollHeight;
  }

  function appendChatMessage(msg, autoScroll = true) {
    if (renderedChatIds.has(msg.id)) return;
    renderedChatIds.add(msg.id);
    const host = $('chatMessages');
    const line = document.createElement('div');
    line.className = 'chat-line' + (msg.system ? ' system' : '');
    if (msg.system) {
      line.textContent = msg.text;
    } else {
      const authorSpan = document.createElement('span');
      authorSpan.className = 'chat-author';
      authorSpan.style.color = msg.classColor || '#D9A441';
      authorSpan.textContent = msg.authorName + ': ';
      line.appendChild(authorSpan);
      line.appendChild(document.createTextNode(msg.text));
    }
    host.appendChild(line);
    while (host.children.length > 80) host.removeChild(host.firstChild);
    if (autoScroll) host.scrollTop = host.scrollHeight;
  }

  /* ── ROUND OVERLAY ────────────────────────────────────── */
  function showRoundOverlay(data, classByPlayer) {
    $('roundOverlayTitle').textContent = `Round ${data.round} Results`;
    const list = $('roundOverlayList');
    list.innerHTML = '';
    for (const row of data.summary) {
      const cls = classByPlayer[row.playerId] ? GD.CLASSES[classByPlayer[row.playerId]] : null;
      const div = document.createElement('div');
      div.className = 'round-result-row';
      div.innerHTML = `
        <span class="placement-badge placement-${row.placement}">#${row.placement}</span>
        <span style="font-size:1.1rem;">${cls ? cls.icon : ''}</span>
        <span class="rr-name">${escapeHtml(row.name)}${row.leveledUp ? ' ⭐' : ''}</span>
        <span class="rr-gain">+${row.goldGain}g · +${row.xpGain}xp</span>`;
      list.appendChild(div);
    }
    const banner = $('matchWinnerBanner');
    if (data.matchWinnerName) {
      banner.textContent = `🏆 ${data.matchWinnerName} wins the match!`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
    $('roundOverlay').classList.remove('hidden');
  }
  function hideRoundOverlay() { $('roundOverlay').classList.add('hidden'); }

  /* ── HELPERS ──────────────────────────────────────────── */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  return {
    init, bindActions, setMyPlayerId,
    showConnectionOverlay, hideConnectionOverlay,
    showLobbyScreen, showGameScreen, showEntryPanel, showRoomPanel,
    showToast, renderLobby, renderTopBar, renderRosterRail,
    renderShopList, renderTalentPanel, renderFullChat, appendChatMessage,
    showRoundOverlay, hideRoundOverlay
  };
})();

if (typeof window !== 'undefined') window.UI = UI;
