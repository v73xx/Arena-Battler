'use strict';
const { ABILITIES, AI_PROFILES } = require('../public/js/gameData');
const NeuralTargeting = require('./NeuralTargeting');

const ARENA_WIDTH    = 900;
const ARENA_HEIGHT   = 560;
const PIXELS_PER_SEC = 110;   // base movement speed multiplier
const ARMOR_K        = 400;   // physical armor mitigation constant
const MAGIC_ARMOR_K  = 1100;  // magic/nature/fire/shadow get weaker mitigation from armor ("spell resist" lite)
const CRIT_MULTIPLIER = 1.6;  // was a flat 2x — toned down so bursts aren't one-shots
const MATCH_TIMEOUT  = 90000; // sudden-death fallback (ms)
const BOT_RADIUS     = 21;    // for separation / arena clamping

class CombatEngine {
  constructor(bots) {
    if (!Array.isArray(bots) || bots.length < 2) {
      throw new Error('CombatEngine requires at least 2 bots');
    }
    this.bots = bots;
    this.arenaWidth  = ARENA_WIDTH;
    this.arenaHeight = ARENA_HEIGHT;
    this.elapsed  = 0;
    this.finished = false;
    this.winnerId = null;
    this.timedOut = false;
    this.pendingProjectiles = [];
    this.damageDealt  = {};
    this.healingDone  = {};

    for (const bot of this.bots) bot.prepareForBattle();
    this._setStartPositions();
  }

  /* ── SETUP ─────────────────────────────────────────────── */
  _setStartPositions() {
    const cx = this.arenaWidth / 2;
    const cy = this.arenaHeight / 2;
    const radius = 200;
    const n = this.bots.length;
    this.bots.forEach((bot, i) => {
      const angle = (-90 + (360 / n) * i) * (Math.PI / 180);
      bot.x = cx + radius * Math.cos(angle);
      bot.y = cy + radius * Math.sin(angle);
      bot.facing = 1;
      bot.targetId = null;
    });
  }

  /* ── HELPERS ──────────────────────────────────────────── */
  getBot(id) { return this.bots.find(b => b.id === id) || null; }
  getAlive() { return this.bots.filter(b => b.alive); }
  _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  _clamp(bot) {
    bot.x = Math.max(BOT_RADIUS, Math.min(this.arenaWidth - BOT_RADIUS, bot.x));
    bot.y = Math.max(BOT_RADIUS, Math.min(this.arenaHeight - BOT_RADIUS, bot.y));
  }

  /* ── MAIN TICK ────────────────────────────────────────── */
  tick(dt) {
    if (this.finished) {
      return { events: [], bots: this.bots.map(b => b.serialize()), finished: true, winnerId: this.winnerId };
    }
    this.elapsed += dt;
    const events = [];

    /* 1. status effects, dots, cooldowns, mana regen */
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const effectEvents = bot.tickEffects(dt);
      for (const ev of effectEvents) {
        if (ev.type === 'damage') this._applyTickDamage(ev, events);
        else if (ev.type === 'heal') this._applyTickHeal(ev, events);
      }
    }

    /* 2. projectiles in flight */
    this._tickProjectiles(dt, events);

    /* 3. AI decisions + movement */
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      this._updateBotAI(bot, dt, events);
    }

    /* 4. keep bots from total overlap */
    this._applySeparation();

    /* 5. win condition */
    const alive = this.getAlive();
    if (alive.length <= 1 && !this.finished) {
      this.finished = true;
      this.winnerId = alive.length === 1 ? alive[0].id : null;
      events.push({ type: 'matchEnd', winnerId: this.winnerId });
    } else if (!this.finished && this.elapsed > MATCH_TIMEOUT) {
      this.finished = true;
      this.timedOut = true;
      const ranked = [...alive].sort((a, b) => (b.hp / b.maxHp) - (a.hp / a.maxHp));
      this.winnerId = ranked.length ? ranked[0].id : null;
      events.push({ type: 'matchEnd', winnerId: this.winnerId, timedOut: true });
    }

    return {
      events,
      bots: this.bots.map(b => b.serialize()),
      finished: this.finished,
      winnerId: this.winnerId,
      elapsed: this.elapsed
    };
  }

  /* ── DOT / HOT RESOLUTION FROM Bot.tickEffects() ────────── */
  _applyTickDamage(ev, events) {
    const source = this.getBot(ev.sourceId);
    const target = this.getBot(ev.targetId);
    if (!target || !target.alive) return;
    if (target.isImmune()) { events.push({ type: 'absorb', sourceId: ev.sourceId, targetId: ev.targetId, abilityId: ev.abilityId }); return; }
    const dmg = Math.max(1, Math.floor(ev.amount));
    target.hp = Math.max(0, target.hp - dmg);
    events.push({ type: 'damage', sourceId: ev.sourceId, targetId: ev.targetId, amount: dmg, abilityId: ev.abilityId, isCrit: false, isDot: true });
    if (source) this.damageDealt[source.id] = (this.damageDealt[source.id] || 0) + dmg;
    if (target.hp <= 0 && target.alive) {
      target.alive = false; target.state = 'dead';
      events.push({ type: 'death', id: target.id, killerId: ev.sourceId });
    }
  }

  _applyTickHeal(ev, events) {
    const target = this.getBot(ev.targetId);
    if (!target || !target.alive) return;
    const healed = Math.min(target.maxHp - target.hp, Math.max(0, Math.floor(ev.amount)));
    if (healed <= 0) return;
    target.hp += healed;
    events.push({ type: 'heal', sourceId: ev.sourceId, targetId: ev.targetId, amount: healed });
    this.healingDone[ev.sourceId] = (this.healingDone[ev.sourceId] || 0) + healed;
  }

  /* ── PROJECTILES ──────────────────────────────────────── */
  _tickProjectiles(dt, events) {
    for (const p of this.pendingProjectiles) p.remaining -= dt;
    const arrived = this.pendingProjectiles.filter(p => p.remaining <= 0);
    this.pendingProjectiles = this.pendingProjectiles.filter(p => p.remaining > 0);

    for (const p of arrived) {
      const source = this.getBot(p.sourceId);
      const target = this.getBot(p.targetId);
      events.push({ type: 'impact', sourceId: p.sourceId, targetId: p.targetId, abilityId: p.abilityId, x: target ? target.x : p.tx, y: target ? target.y : p.ty });
      if (source && source.alive && target && target.alive) {
        this._dealDamage(source, target, p.power * p.damage, p.damageType, p.abilityId, events, { piercing: p.piercing });
      }
    }
  }

  /* ── CORE DAMAGE / HEAL ───────────────────────────────── */
  _dealDamage(source, target, rawAmount, damageType, abilityId, events, options = {}) {
    if (!target.alive) return 0;
    if (target.isImmune() && !options.piercing) {
      events.push({ type: 'absorb', sourceId: source.id, targetId: target.id, abilityId });
      return 0;
    }
    if (Math.random() < target.dodgeChance) {
      events.push({ type: 'dodge', sourceId: source.id, targetId: target.id, abilityId });
      return 0;
    }
    const isCrit = Math.random() < source.critChance;
    let dmg = rawAmount * (isCrit ? CRIT_MULTIPLIER : 1);
    if (damageType === 'physical') {
      const reduction = Math.min(0.75, target.armor / (target.armor + ARMOR_K));
      dmg *= (1 - reduction);
    } else if (damageType === 'magic' || damageType === 'fire' || damageType === 'shadow' || damageType === 'nature') {
      // Spells aren't fully unmitigated — armor offers a smaller amount of
      // protection against them too, so casters can't ignore tankier targets.
      const reduction = Math.min(0.45, target.armor / (target.armor + MAGIC_ARMOR_K));
      dmg *= (1 - reduction);
    }
    // 'holy' damage ignores armor entirely (thematically: holy magic
    // bypasses worldly protection — and it's the Paladin's own damage type,
    // so this doesn't compound the burst problem).
    dmg = Math.max(1, Math.floor(dmg));
    target.hp = Math.max(0, target.hp - dmg);
    events.push({ type: 'damage', sourceId: source.id, targetId: target.id, amount: dmg, abilityId, isCrit: !!isCrit });
    this.damageDealt[source.id] = (this.damageDealt[source.id] || 0) + dmg;
    if (target.hp <= 0 && target.alive) {
      target.alive = false; target.state = 'dead';
      events.push({ type: 'death', id: target.id, killerId: source.id });
    }
    return dmg;
  }

  _heal(source, target, amount, events) {
    if (!target.alive) return 0;
    const healed = Math.min(target.maxHp - target.hp, Math.max(0, Math.floor(amount)));
    if (healed <= 0) return 0;
    target.hp += healed;
    events.push({ type: 'heal', sourceId: source.id, targetId: target.id, amount: healed });
    this.healingDone[source.id] = (this.healingDone[source.id] || 0) + healed;
    return healed;
  }

  /* ── AI ────────────────────────────────────────────────── */
  _pickTarget(bot) {
    const enemies = this.bots.filter(b => b.id !== bot.id && b.alive);
    if (!enemies.length) return null;
    const profile = AI_PROFILES[bot.className];
    return NeuralTargeting.selectTarget(bot, enemies, (a, b) => this._dist(a, b), {
      maxRange: profile ? profile.autoAttackRange : 400,
      temperature: 0.45
    });
  }

  _moveToward(bot, target, dt) {
    const d = this._dist(bot, target);
    if (d < 1) return;
    const move = Math.min(d, bot.speed * PIXELS_PER_SEC * (dt / 1000));
    const dx = (target.x - bot.x) / d, dy = (target.y - bot.y) / d;
    bot.x += dx * move; bot.y += dy * move;
    bot.facing = dx >= 0 ? 1 : -1;
    this._clamp(bot);
  }

  _moveAway(bot, target, dt) {
    const d = this._dist(bot, target);
    if (d < 1) return;
    const move = Math.min(d, bot.speed * PIXELS_PER_SEC * (dt / 1000));
    const dx = (bot.x - target.x) / d, dy = (bot.y - target.y) / d;
    bot.x += dx * move; bot.y += dy * move;
    bot.facing = (target.x - bot.x) >= 0 ? 1 : -1;
    this._clamp(bot);
  }

  _canCast(bot, ability, target, dist) {
    if ((bot.abilityCooldowns[ability.id] || 0) > 0) return false;
    if (bot.mana < ability.manaCost) return false;

    const singleTarget = ['melee', 'gap_closer', 'projectile', 'dot', 'channel', 'cc'].includes(ability.type);
    if (singleTarget) {
      if (!target || !target.alive) return false;
      if (ability.range && dist > ability.range) return false;
    }
    if (ability.type === 'aoe' || ability.type === 'aoe_ranged') {
      const inRange = this.bots.some(b => b.alive && b.id !== bot.id && this._dist(bot, b) <= ability.range);
      if (!inRange) return false;
    }
    if (ability.type === 'defensive') {
      const hpPct = bot.hp / bot.maxHp;
      if (hpPct > 0.45) return false;
      if (ability.immune && bot.buffs.some(b => b.type === 'immune')) return false;
      if (ability.dodgeBonus && bot.buffs.some(b => b.type === 'dodgeBonus')) return false;
    }
    if (ability.type === 'heal') {
      if (bot.hp / bot.maxHp > 0.30) return false;
    }
    if (ability.type === 'buff') {
      if (bot.buffs.some(b => b.type === ability.buffType)) return false;
    }
    return true;
  }

  _castAbility(bot, ability, target, events) {
    bot.abilityCooldowns[ability.id] = ability.cooldown;
    bot.mana = Math.max(0, bot.mana - ability.manaCost);
    events.push({
      type: 'cast', sourceId: bot.id, targetId: target ? target.id : null, abilityId: ability.id,
      sx: bot.x, sy: bot.y, tx: target ? target.x : bot.x, ty: target ? target.y : bot.y
    });

    const powerSource = ability.damageType === 'physical' ? bot.attackPower : (ability.damageType ? bot.spellPower : 0);

    switch (ability.type) {
      case 'melee': {
        const dmg = this._dealDamage(bot, target, powerSource * ability.damage, ability.damageType, ability.id, events);
        if (dmg > 0 && ability.stun) {
          target.state = 'stunned'; target.stateTimer = ability.stun;
          events.push({ type: 'cc', targetId: target.id, ccType: 'stun', duration: ability.stun });
        }
        if (ability.healSelf) this._heal(bot, bot, powerSource * ability.healSelf, events);
        break;
      }
      case 'gap_closer': {
        const angle = Math.atan2(bot.y - target.y, bot.x - target.x);
        bot.x = target.x + Math.cos(angle) * 60;
        bot.y = target.y + Math.sin(angle) * 60;
        this._clamp(bot);
        this._dealDamage(bot, target, powerSource * ability.damage, ability.damageType, ability.id, events);
        break;
      }
      case 'aoe': case 'aoe_ranged': {
        const hits = this.bots.filter(b => b.alive && b.id !== bot.id && this._dist(bot, b) <= ability.range);
        for (const t of hits) {
          const dmg = this._dealDamage(bot, t, powerSource * ability.damage, ability.damageType, ability.id, events);
          if (dmg > 0 && ability.freeze) {
            t.state = 'stunned'; t.stateTimer = ability.freeze;
            events.push({ type: 'cc', targetId: t.id, ccType: 'freeze', duration: ability.freeze });
          }
        }
        break;
      }
      case 'projectile': {
        const dist = this._dist(bot, target);
        const travel = Math.max(80, (dist / ability.projectileSpeed) * 1000);
        this.pendingProjectiles.push({
          sourceId: bot.id, targetId: target.id, abilityId: ability.id,
          remaining: travel, total: travel, power: powerSource, damage: ability.damage,
          damageType: ability.damageType, piercing: !!ability.piercing,
          sx: bot.x, sy: bot.y, tx: target.x, ty: target.y
        });
        break;
      }
      case 'dot': {
        target.dots.push({
          sourceId: bot.id, abilityId: ability.id, damage: ability.damage, damageType: ability.damageType,
          tickRate: ability.tickRate, remaining: ability.tickRate * ability.ticks, tickTimer: ability.tickRate
        });
        events.push({ type: 'dotApplied', sourceId: bot.id, targetId: target.id, abilityId: ability.id });
        break;
      }
      case 'channel': {
        target.dots.push({
          sourceId: bot.id, abilityId: ability.id, damage: ability.damage, damageType: ability.damageType,
          tickRate: ability.tickRate, remaining: ability.tickRate * ability.ticks, tickTimer: ability.tickRate,
          healSourceId: bot.id
        });
        events.push({ type: 'dotApplied', sourceId: bot.id, targetId: target.id, abilityId: ability.id });
        break;
      }
      case 'buff': {
        bot.buffs = bot.buffs.filter(b => b.type !== ability.buffType);
        bot.buffs.push({ type: ability.buffType, amount: ability.buffAmount, remaining: ability.buffDuration });
        events.push({ type: 'buffApplied', id: bot.id, buffType: ability.buffType, duration: ability.buffDuration });
        break;
      }
      case 'defensive': {
        if (ability.immune) {
          bot.buffs = bot.buffs.filter(b => b.type !== 'immune');
          bot.buffs.push({ type: 'immune', amount: 1, remaining: ability.immune });
          events.push({ type: 'buffApplied', id: bot.id, buffType: 'immune', duration: ability.immune });
        }
        if (ability.dodgeBonus) {
          bot.buffs = bot.buffs.filter(b => b.type !== 'dodgeBonus');
          bot.buffs.push({ type: 'dodgeBonus', amount: ability.dodgeBonus, remaining: ability.duration });
          events.push({ type: 'buffApplied', id: bot.id, buffType: 'dodgeBonus', duration: ability.duration });
        }
        break;
      }
      case 'heal': {
        this._heal(bot, bot, bot.maxHp, events);
        break;
      }
      case 'cc': {
        target.state = 'feared'; target.stateTimer = ability.fear; target.fearSourceId = bot.id;
        events.push({ type: 'cc', targetId: target.id, ccType: 'fear', duration: ability.fear });
        break;
      }
    }
  }

  _updateBotAI(bot, dt, events) {
    if (bot.state === 'stunned') return;
    if (bot.state === 'feared') {
      const enemies = this.bots.filter(b => b.id !== bot.id && b.alive);
      if (enemies.length) {
        const nearest = enemies.sort((a, b) => this._dist(bot, a) - this._dist(bot, b))[0];
        this._moveAway(bot, nearest, dt);
      }
      return;
    }

    const target = this._pickTarget(bot);
    if (!target) return;
    bot.targetId = target.id;
    const dist = this._dist(bot, target);
    const profile = AI_PROFILES[bot.className];

    /* movement */
    if (profile.kiting && dist < profile.preferredRange * 0.65) {
      this._moveAway(bot, target, dt);
    } else if (dist > profile.preferredRange) {
      this._moveToward(bot, target, dt);
    } else {
      bot.facing = (target.x - bot.x) >= 0 ? 1 : -1;
    }

    /* ability rotation — first valid ability in priority order */
    const curDist = this._dist(bot, target);
    for (const abilityId of profile.rotation) {
      const ability = ABILITIES[abilityId];
      if (this._canCast(bot, ability, target, curDist)) {
        this._castAbility(bot, ability, target, events);
        break;
      }
    }

    /* auto-attack — runs on its own independent timer */
    bot.autoAttackTimer -= dt;
    if (bot.autoAttackTimer <= 0) {
      if (curDist <= profile.autoAttackRange) {
        const power = profile.autoAttackPower === 'attackPower' ? bot.attackPower : bot.spellPower;
        this._dealDamage(bot, target, power * profile.autoAttackMultiplier, profile.autoAttackDamageType, 'autoattack', events);
        events.push({ type: 'autoattack', sourceId: bot.id, targetId: target.id });
        bot.autoAttackTimer = bot.autoAttackInterval;
      } else {
        bot.autoAttackTimer = 0;
      }
    }
  }

  _applySeparation() {
    for (let i = 0; i < this.bots.length; i++) {
      for (let j = i + 1; j < this.bots.length; j++) {
        const a = this.bots[i], b = this.bots[j];
        if (!a.alive || !b.alive) continue;
        const d = this._dist(a, b);
        const minDist = BOT_RADIUS * 2;
        if (d < minDist && d > 0.01) {
          const overlap = (minDist - d) / 2;
          const dx = (a.x - b.x) / d, dy = (a.y - b.y) / d;
          a.x += dx * overlap; a.y += dy * overlap;
          b.x -= dx * overlap; b.y -= dy * overlap;
          this._clamp(a); this._clamp(b);
        }
      }
    }
  }

  getResults() {
    return {
      winnerId: this.winnerId,
      timedOut: this.timedOut,
      elapsed: this.elapsed,
      damageDealt: { ...this.damageDealt },
      healingDone: { ...this.healingDone }
    };
  }
}

module.exports = CombatEngine;
