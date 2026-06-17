'use strict';
/* ============================================================
   ARENA RENDERER
   Canvas-based combat visualization. Two modes:
   - 'idle'   : champions stand on pedestals (lobby/prep/roundEnd)
   - 'battle' : live AI combat driven by server combatTick events
   ============================================================ */
const ArenaRenderer = (function () {
  const WORLD_W = 900, WORLD_H = 560;
  const BOT_DRAW_RADIUS = 22;
  const MAX_PARTICLES = 320;
  const MAX_BLOOD = 60;
  const MAX_FLOATERS = 80;
  const MAX_PROJECTILES = 40;
  const MAX_SLASHES = 40;
  const MAX_RINGS = 24;

  const BUFF_LABELS = {
    attackPower: { icon: '⚔️', label: 'Power Up', color: '#FFD27A' },
    dodgeBonus:  { icon: '💨', label: 'Evasive', color: '#BFFFD9' },
    immune:      { icon: '🌟', label: 'Shielded', color: '#FFE9A6' }
  };

  let canvas, ctx, wrapEl;
  let dpr = 1;
  let displayW = 800, displayH = 500;
  let scale = 1, offsetX = 0, offsetY = 0;

  let mode = 'idle';
  let running = false;
  let rafHandle = null;

  /** botId -> render state */
  const botStates = new Map();
  let particles = [];
  let bloodStains = [];
  let floaters = [];
  let projectiles = [];
  let slashes = [];
  let rings = [];
  let lastFrameTime = performance.now();

  const GD = (typeof window !== 'undefined' && window.GAME_DATA) ? window.GAME_DATA : { ABILITIES: {}, AI_PROFILES: {} };

  /* ── INIT / RESIZE ─────────────────────────────────────── */
  function init(canvasEl) {
    canvas = canvasEl;
    wrapEl = canvas.parentElement;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    if (typeof ResizeObserver !== 'undefined' && wrapEl) {
      new ResizeObserver(resize).observe(wrapEl);
    }
  }

  function resize() {
    if (!canvas || !wrapEl) return;
    const rect = wrapEl.getBoundingClientRect();
    displayW = Math.max(280, rect.width);
    displayH = Math.max(220, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(displayW * dpr);
    canvas.height = Math.floor(displayH * dpr);
    canvas.style.width = displayW + 'px';
    canvas.style.height = displayH + 'px';
    scale = Math.min(displayW / WORLD_W, displayH / WORLD_H) * 0.94;
    offsetX = (displayW - WORLD_W * scale) / 2;
    offsetY = (displayH - WORLD_H * scale) / 2;
  }

  function w2s(x, y) { return { x: offsetX + x * scale, y: offsetY + y * scale }; }

  /* ── PUBLIC: MODE CONTROL ─────────────────────────────── */
  function setIdleBots(playerList) {
    mode = 'idle';
    const n = playerList.length;
    const spacing = WORLD_W / (n + 1);
    playerList.forEach((p, i) => {
      if (!p.bot) return;
      const rs = getOrCreateState(p.bot.id, p.bot);
      rs.pedestalX = spacing * (i + 1);
      rs.pedestalY = WORLD_H * 0.62;
      rs.displayX = rs.pedestalX;
      rs.displayY = rs.pedestalY;
      rs.serverX = rs.pedestalX;
      rs.serverY = rs.pedestalY;
      rs.name = p.bot.name; rs.className = p.bot.className; rs.classColor = p.bot.classColor;
      rs.icon = p.bot.icon; rs.level = p.bot.level; rs.alive = true; rs.state = 'idle';
      rs.hp = p.bot.maxHp; rs.maxHp = p.bot.maxHp; rs.mana = p.bot.maxMana; rs.maxMana = p.bot.maxMana;
      rs.buffs = [];
      rs.isIdleDisplay = true;
    });
    // prune states no longer present
    const validIds = new Set(playerList.filter(p => p.bot).map(p => p.bot.id));
    for (const id of [...botStates.keys()]) if (!validIds.has(id)) botStates.delete(id);
  }

  function beginBattle(initialBots) {
    mode = 'battle';
    clearRoundEffects();
    for (const b of initialBots) {
      const rs = getOrCreateState(b.id, b);
      rs.displayX = b.x; rs.displayY = b.y; rs.serverX = b.x; rs.serverY = b.y;
      rs.displayHp = b.hp; rs.displayMana = b.mana;
      rs.isIdleDisplay = false;
      rs.deathAt = 0;
    }
  }

  function endBattle() { mode = 'idle'; }

  function clearRoundEffects() {
    particles = []; bloodStains = []; floaters = []; projectiles = []; slashes = []; rings = [];
  }

  function getOrCreateState(id, src) {
    let rs = botStates.get(id);
    if (!rs) {
      rs = {
        id, name: src.name, className: src.className, classColor: src.classColor || '#999', icon: src.icon || '?',
        level: src.level || 1, displayX: src.x || WORLD_W / 2, displayY: src.y || WORLD_H / 2,
        serverX: src.x || WORLD_W / 2, serverY: src.y || WORLD_H / 2,
        hp: src.hp, maxHp: src.maxHp, mana: src.mana, maxMana: src.maxMana,
        displayHp: src.hp, displayMana: src.mana,
        alive: true, state: 'idle', buffs: [], facing: 1,
        lungeStart: 0, lungeDirX: 0, lungeDirY: 0, hitFlashUntil: 0, deathAt: 0,
        idlePhase: Math.random() * Math.PI * 2, pedestalX: src.x, pedestalY: src.y,
        isIdleDisplay: true
      };
      botStates.set(id, rs);
    }
    return rs;
  }

  /* ── PUBLIC: TICK INGEST ──────────────────────────────── */
  function applyTick(data) {
    if (mode !== 'battle') return;
    for (const b of data.bots) {
      const rs = getOrCreateState(b.id, b);
      rs.serverX = b.x; rs.serverY = b.y;
      rs.hp = b.hp; rs.maxHp = b.maxHp; rs.mana = b.mana; rs.maxMana = b.maxMana;
      rs.alive = b.alive; rs.state = b.state; rs.buffs = b.buffs || []; rs.level = b.level;
      rs.facing = b.facing || rs.facing;
    }
    for (const ev of data.events) handleEvent(ev);
  }

  function getBotState(id) { return botStates.get(id); }

  /* ── EVENT → VISUAL EFFECT MAPPING ────────────────────── */
  function handleEvent(ev) {
    const now = performance.now();
    switch (ev.type) {
      case 'cast': {
        const src = botStates.get(ev.sourceId);
        const ability = GD.ABILITIES[ev.abilityId];
        if (!src || !ability) break;
        triggerLunge(src, ev.tx, ev.ty);
        spawnRing(ev.sx, ev.sy, ability.color || '#FFFFFF', 34, 260);
        if (ability.type === 'melee' || ability.type === 'gap_closer') {
          spawnSlash(ev.tx, ev.ty, ability.color || '#FFFFFF', Math.atan2(ev.ty - ev.sy, ev.tx - ev.sx));
        } else if (ability.type === 'projectile') {
          spawnProjectile(ev.sourceId, ev.targetId, ev.abilityId, ev.sx, ev.sy, ev.tx, ev.ty, ability);
        } else if (ability.type === 'aoe' || ability.type === 'aoe_ranged') {
          spawnRing(ev.sx, ev.sy, ability.color || '#FFFFFF', ability.range || 150, 420);
          spawnBurst(ev.sx, ev.sy, 14, ability.particleColor || ability.color, 90, 320);
        } else if (ability.type === 'buff' || ability.type === 'defensive' || ability.type === 'heal') {
          spawnBurst(ev.sx, ev.sy, 10, ability.particleColor || ability.color, 60, 420);
          spawnFloater(ev.sx, ev.sy - 30, '+' + ability.name, ability.color || '#FFE9A6', 13);
        } else if (ability.type === 'dot' || ability.type === 'channel') {
          spawnBurst(ev.tx, ev.ty, 8, ability.particleColor || ability.color, 60, 340);
        } else if (ability.type === 'cc') {
          spawnBurst(ev.tx, ev.ty, 10, '#3A1A4A', 80, 360);
        }
        break;
      }
      case 'autoattack': {
        const src = botStates.get(ev.sourceId);
        const tgt = botStates.get(ev.targetId);
        if (!src || !tgt) break;
        triggerLunge(src, tgt.displayX, tgt.displayY);
        const profile = GD.AI_PROFILES[src.className];
        if (profile && profile.kiting) {
          spawnTracer(src.displayX, src.displayY, tgt.displayX, tgt.displayY, src.classColor);
        } else {
          spawnSlash(tgt.displayX, tgt.displayY, '#E8E2D0', Math.atan2(tgt.displayY - src.displayY, tgt.displayX - src.displayX));
        }
        break;
      }
      case 'damage': {
        const tgt = botStates.get(ev.targetId);
        if (!tgt) break;
        tgt.hitFlashUntil = now + 140;
        const ability = GD.ABILITIES[ev.abilityId];
        const fx = tgt.displayX, fy = tgt.displayY - 36;
        const txt = (ev.isCrit ? ev.amount + '!' : String(ev.amount));
        spawnFloater(fx, fy, txt, ev.isCrit ? '#FFD24A' : '#F4EFE2', ev.isCrit ? 22 : 15, !!ev.isCrit);
        spawnBurst(tgt.displayX, tgt.displayY - 6, ev.isCrit ? 16 : 9, '#A21B27', 70, 360);
        if (ability && ability.particleColor && ability.damageType !== 'physical') {
          spawnBurst(tgt.displayX, tgt.displayY - 6, 6, ability.particleColor, 70, 320);
        }
        if (ev.amount >= Math.max(40, tgt.maxHp * 0.08)) {
          addBloodStain(tgt.displayX, tgt.displayY + 14);
        }
        break;
      }
      case 'heal': {
        const tgt = botStates.get(ev.targetId);
        if (!tgt) break;
        spawnFloater(tgt.displayX, tgt.displayY - 36, '+' + ev.amount, '#7CE38B', 16);
        spawnBurst(tgt.displayX, tgt.displayY, 8, '#7CE38B', 50, 420);
        break;
      }
      case 'dodge': {
        const tgt = botStates.get(ev.targetId);
        if (!tgt) break;
        spawnFloater(tgt.displayX, tgt.displayY - 36, 'Dodge!', '#C9C2D6', 14);
        break;
      }
      case 'absorb': {
        const tgt = botStates.get(ev.targetId);
        if (!tgt) break;
        spawnFloater(tgt.displayX, tgt.displayY - 36, 'Blocked', '#9FD4FF', 14);
        spawnRing(tgt.displayX, tgt.displayY, '#FFE9A6', 30, 260);
        break;
      }
      case 'dotApplied': {
        const tgt = botStates.get(ev.targetId);
        if (!tgt) break;
        const ability = GD.ABILITIES[ev.abilityId];
        spawnBurst(tgt.displayX, tgt.displayY, 6, ability ? ability.particleColor : '#9C6BD6', 50, 300);
        break;
      }
      case 'cc': {
        const tgt = botStates.get(ev.targetId);
        if (!tgt) break;
        const color = ev.ccType === 'freeze' ? '#9FE9FF' : (ev.ccType === 'fear' ? '#5A2A6E' : '#FFE9A6');
        spawnBurst(tgt.displayX, tgt.displayY - 10, 12, color, 80, 380);
        break;
      }
      case 'impact': {
        const ability = GD.ABILITIES[ev.abilityId];
        removeProjectile(ev.sourceId, ev.targetId, ev.abilityId);
        spawnBurst(ev.x, ev.y, 10, ability ? ability.particleColor : '#FFD27A', 90, 340);
        break;
      }
      case 'death': {
        const tgt = botStates.get(ev.id);
        if (!tgt) break;
        tgt.deathAt = now;
        addBloodStain(tgt.displayX, tgt.displayY + 10, true);
        spawnBurst(tgt.displayX, tgt.displayY, 22, '#7A1420', 120, 600);
        break;
      }
      case 'matchEnd': {
        if (ev.winnerId) {
          const w = botStates.get(ev.winnerId);
          if (w) spawnBurst(w.displayX, w.displayY - 20, 30, '#FFD24A', 140, 900);
        }
        break;
      }
      default: break;
    }
  }

  function triggerLunge(rs, tx, ty) {
    const now = performance.now();
    const dx = tx - rs.displayX, dy = ty - rs.displayY;
    const d = Math.hypot(dx, dy) || 1;
    rs.lungeStart = now; rs.lungeDirX = dx / d; rs.lungeDirY = dy / d;
  }

  /* ── PARTICLE / EFFECT FACTORIES ──────────────────────── */
  function spawnBurst(x, y, count, color, speed, life) {
    for (let i = 0; i < count; i++) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const spd = (speed || 80) * (0.4 + Math.random() * 0.9);
      particles.push({
        x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd - 20,
        life: 0, maxLife: (life || 320) * (0.7 + Math.random() * 0.6),
        color: color || '#A21B27', size: 2 + Math.random() * 3, gravity: 160
      });
    }
  }

  function spawnRing(x, y, color, maxRadius, duration) {
    if (rings.length >= MAX_RINGS) rings.shift();
    rings.push({ x, y, color: color || '#FFFFFF', life: 0, maxLife: duration || 300, maxRadius: maxRadius || 40 });
  }

  function spawnSlash(x, y, color, angle) {
    if (slashes.length >= MAX_SLASHES) slashes.shift();
    slashes.push({ x, y, color: color || '#FFFFFF', angle, life: 0, maxLife: 190 });
  }

  function spawnTracer(sx, sy, tx, ty, color) {
    if (slashes.length >= MAX_SLASHES) slashes.shift();
    slashes.push({ tracer: true, sx, sy, tx, ty, color: color || '#FFFFFF', life: 0, maxLife: 150 });
  }

  function spawnFloater(x, y, text, color, size, big) {
    if (floaters.length >= MAX_FLOATERS) floaters.shift();
    floaters.push({ x: x + (Math.random() * 14 - 7), y, text, color: color || '#FFFFFF', size: size || 14, life: 0, maxLife: 900, big: !!big });
  }

  function spawnProjectile(sourceId, targetId, abilityId, sx, sy, tx, ty, ability) {
    if (projectiles.length >= MAX_PROJECTILES) projectiles.shift();
    const dist = Math.hypot(tx - sx, ty - sy);
    const duration = Math.max(80, (dist / (ability.projectileSpeed || 300)) * 1000);
    projectiles.push({ sourceId, targetId, abilityId, sx, sy, tx, ty, life: 0, duration, color: ability.color || '#FFFFFF' });
  }

  function removeProjectile(sourceId, targetId, abilityId) {
    const idx = projectiles.findIndex(p => p.sourceId === sourceId && p.targetId === targetId && p.abilityId === abilityId);
    if (idx >= 0) projectiles.splice(idx, 1);
  }

  function addBloodStain(x, y, big) {
    if (bloodStains.length >= MAX_BLOOD) bloodStains.shift();
    bloodStains.push({ x, y, r: (big ? 26 : 13) * (0.7 + Math.random() * 0.7), rot: Math.random() * Math.PI, big: !!big });
  }

  /* ── UPDATE ────────────────────────────────────────────── */
  function update(dt) {
    const now = performance.now();

    for (const rs of botStates.values()) {
      const k = Math.min(1, dt * 9);
      rs.displayX += (rs.serverX - rs.displayX) * k;
      rs.displayY += (rs.serverY - rs.displayY) * k;
      rs.displayHp += ((rs.hp ?? rs.displayHp) - rs.displayHp) * Math.min(1, dt * 6);
      rs.displayMana += ((rs.mana ?? rs.displayMana) - rs.displayMana) * Math.min(1, dt * 6);
    }

    particles = particles.filter(p => {
      p.life += dt * 1000;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.gravity || 0) * dt;
      return p.life < p.maxLife;
    });
    rings = rings.filter(r => { r.life += dt * 1000; return r.life < r.maxLife; });
    slashes = slashes.filter(s => { s.life += dt * 1000; return s.life < s.maxLife; });
    floaters = floaters.filter(f => { f.life += dt * 1000; f.y -= dt * 28; return f.life < f.maxLife; });
    projectiles = projectiles.filter(p => { p.life += dt * 1000; return p.life < p.duration + 250; });
  }

  /* ── DRAW ──────────────────────────────────────────────── */
  function draw() {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displayW, displayH);

    drawArenaFloor();
    drawBloodStains();
    drawRings();

    const ordered = [...botStates.values()].sort((a, b) => a.displayY - b.displayY);
    for (const rs of ordered) drawBot(rs);

    drawSlashes();
    drawProjectiles();
    drawParticles();
    drawFloaters();

    ctx.restore();
  }

  function drawArenaFloor() {
    const tl = w2s(0, 0), br = w2s(WORLD_W, WORLD_H);
    const cx = (tl.x + br.x) / 2, cy = (tl.y + br.y) / 2;
    const rw = (br.x - tl.x) / 2, rh = (br.y - tl.y) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(cx, cy - rh * 0.2, rw * 0.1, cx, cy, rw * 1.05);
    grad.addColorStop(0, '#2B2536');
    grad.addColorStop(0.55, '#1B1623');
    grad.addColorStop(1, '#0B0913');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#3A2E1A';
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#D9A441';
    ctx.globalAlpha = 0.55;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // faint center sigil
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#D9A441';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, rw * (0.25 + i * 0.18), rh * (0.25 + i * 0.18), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // corner braziers
    const corners = [[0.08, 0.1], [0.92, 0.1], [0.08, 0.9], [0.92, 0.9]];
    const t = performance.now() / 260;
    corners.forEach(([fx, fy], i) => {
      const p = w2s(fx * WORLD_W, fy * WORLD_H);
      const flicker = 1 + Math.sin(t + i * 1.7) * 0.12;
      ctx.font = `${20 * flicker}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.85;
      ctx.fillText('🔥', p.x, p.y);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawBloodStains() {
    for (const b of bloodStains) {
      const p = w2s(b.x, b.y);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(b.rot);
      ctx.scale(1, 0.5);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, b.r * scale);
      grad.addColorStop(0, 'rgba(95,12,18,0.55)');
      grad.addColorStop(1, 'rgba(95,12,18,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, b.r * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawRings() {
    for (const r of rings) {
      const t = r.life / r.maxLife;
      const p = w2s(r.x, r.y);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r.maxRadius * scale * t, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawSlashes() {
    for (const s of slashes) {
      const t = s.life / s.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = s.color;
      ctx.lineCap = 'round';
      if (s.tracer) {
        const a = w2s(s.sx, s.sy), b = w2s(s.tx, s.ty);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else {
        const p = w2s(s.x, s.y);
        ctx.lineWidth = 4;
        ctx.translate(p.x, p.y);
        ctx.rotate(s.angle);
        ctx.beginPath();
        ctx.arc(0, 0, 20 + t * 10, -0.9, 0.9);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawProjectiles() {
    for (const p of projectiles) {
      const t = Math.min(1, p.life / p.duration);
      const x = p.sx + (p.tx - p.sx) * t, y = p.sy + (p.ty - p.sy) * t;
      const sp = w2s(x, y);
      ctx.save();
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const pt of particles) {
      const t = pt.life / pt.maxLife;
      const sp = w2s(pt.x, pt.y);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, pt.size * scale * 0.5 + 1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawFloaters() {
    for (const f of floaters) {
      const t = f.life / f.maxLife;
      const sp = w2s(f.x, f.y);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t * 1.1);
      ctx.font = `${f.big ? 'bold ' : ''}${f.size}px ${f.big ? "'Cinzel', serif" : "'Inter', sans-serif"}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = f.color;
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
      ctx.fillText(f.text, sp.x, sp.y);
      ctx.restore();
    }
  }

  function drawBot(rs) {
    const now = performance.now();
    let lunge = { x: 0, y: 0 };
    const lt = (now - rs.lungeStart) / 220;
    if (lt >= 0 && lt <= 1) {
      const mag = Math.sin(lt * Math.PI) * 10;
      lunge = { x: rs.lungeDirX * mag, y: rs.lungeDirY * mag };
    }
    const bob = rs.isIdleDisplay ? Math.sin(now / 600 + rs.idlePhase) * 4 : Math.sin(now / 420 + rs.idlePhase) * 1.6;

    const dying = !rs.alive;
    let deathT = 0;
    if (dying && rs.deathAt) deathT = Math.min(1, (now - rs.deathAt) / 650);
    else if (dying) deathT = 1;

    const p = w2s(rs.displayX + lunge.x, rs.displayY + lunge.y + bob);
    const r = BOT_DRAW_RADIUS * scale;

    ctx.save();
    ctx.translate(p.x, p.y);
    if (dying) {
      ctx.rotate((Math.PI / 2.4) * deathT * (rs.facing >= 0 ? 1 : -1));
      ctx.globalAlpha = 1 - deathT * 0.65;
    }

    // immune shimmer ring
    const immune = rs.buffs && rs.buffs.some(b => b.type === 'immune');
    if (immune) {
      ctx.save();
      ctx.globalAlpha = 0.55 + Math.sin(now / 110) * 0.15;
      ctx.strokeStyle = '#FFE9A6';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r + 7, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // class-colored glow disc
    const grad = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.15);
    grad.addColorStop(0, rs.classColor);
    grad.addColorStop(1, shade(rs.classColor, -40));
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = dying ? '#4A4550' : grad;
    ctx.shadowColor = rs.classColor; ctx.shadowBlur = dying ? 0 : 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.stroke();

    // hit flash
    if (now < rs.hitFlashUntil) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = dying ? 1 - deathT * 0.65 : 1;
    }

    // icon
    ctx.font = `${r * 1.05}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1A1320';
    ctx.fillText(rs.icon, 0, r * 0.06);

    if (dying && deathT >= 1) {
      ctx.font = `${r * 0.9}px serif`;
      ctx.fillText('💀', 0, -r * 1.3);
    }
    ctx.restore();

    if (!dying) {
      drawBotOverlay(rs, p, r);
    }
  }

  function drawBotOverlay(rs, p, r) {
    ctx.save();
    ctx.textAlign = 'center';

    // name + level
    ctx.font = `700 ${Math.max(10, 11 * scale)}px 'Inter', sans-serif`;
    ctx.fillStyle = '#F4EFE2';
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 3;
    ctx.fillText(`${rs.name} · Lv${rs.level}`, p.x, p.y - r - 24);
    ctx.shadowBlur = 0;

    if (!rs.isIdleDisplay) {
      // hp bar
      const barW = r * 2.1, barH = 5;
      const hpPct = Math.max(0, Math.min(1, rs.displayHp / Math.max(1, rs.maxHp)));
      drawBar(p.x - barW / 2, p.y - r - 17, barW, barH, hpPct, hpColor(hpPct), '#2A1416');
      const manaPct = Math.max(0, Math.min(1, rs.displayMana / Math.max(1, rs.maxMana)));
      drawBar(p.x - barW / 2, p.y - r - 10, barW, 3, manaPct, '#5FD3D9', '#13323A');

      // status badges
      const badges = [];
      if (rs.state === 'stunned') badges.push('💫');
      if (rs.state === 'feared') badges.push('😱');
      for (const b of rs.buffs || []) {
        if (b.type === 'attackPower') badges.push('⚔️');
        if (b.type === 'dodgeBonus') badges.push('💨');
      }
      if (badges.length) {
        ctx.font = `${Math.max(11, 13 * scale)}px serif`;
        ctx.fillText(badges.slice(0, 3).join(' '), p.x, p.y - r - 32);
      }
    }
    ctx.restore();
  }

  function drawBar(x, y, w, h, pct, color, bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * pct, h);
  }

  function hpColor(pct) {
    if (pct > 0.5) return '#5FBF6E';
    if (pct > 0.25) return '#E0A93C';
    return '#C73B45';
  }

  function shade(hex, amt) {
    const c = hex.replace('#', '');
    const num = parseInt(c.length === 3 ? c.split('').map(ch => ch + ch).join('') : c, 16);
    let r = (num >> 16) + amt, g = ((num >> 8) & 0xff) + amt, b = (num & 0xff) + amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return `rgb(${r},${g},${b})`;
  }

  /* ── LOOP ──────────────────────────────────────────────── */
  function loop() {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    update(dt);
    draw();
    rafHandle = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    lastFrameTime = performance.now();
    rafHandle = requestAnimationFrame(loop);
  }
  function stop() { running = false; if (rafHandle) cancelAnimationFrame(rafHandle); }

  return {
    init, start, stop, resize,
    setIdleBots, beginBattle, endBattle, applyTick, clearRoundEffects, getBotState
  };
})();

if (typeof window !== 'undefined') window.ArenaRenderer = ArenaRenderer;
