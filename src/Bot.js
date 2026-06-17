'use strict';
const { CLASSES, ABILITIES } = require('../public/js/gameData');

class Bot {
  constructor(id, name, className) {
    if (!CLASSES[className]) throw new Error(`Unknown class: ${className}`);

    this.id = id;
    this.name = name;
    this.className = className;
    this.level = 1;
    this.xp = 0;
    this.xpToNextLevel = 300;
    this.talentPoints = 0;
    this.talents = {};        // talentId -> rank
    this.items = [];          // purchased item ids

    /* position */
    this.x = 400;
    this.y = 300;
    this.facing = 1;          // 1 right, -1 left

    /* combat state */
    this.alive = true;
    this.state = 'idle';      // idle | moving | attacking | stunned | feared | immune
    this.stateTimer = 0;      // ms remaining in current state
    this.targetId = null;
    this.autoAttackTimer = 0;

    /* buffs / dots */
    this.buffs = [];   // { type, amount, duration, remaining }
    this.dots  = [];   // { sourceId, abilityId, damage, damageType, tickRate, remaining, tickTimer, healSourceId }

    /* cooldowns */
    this.abilityCooldowns = {};

    /* stat snapshot (recalculated on level/item/talent changes) */
    this._initBaseStats();
    this.hp   = this.maxHp;
    this.mana = this.maxMana;
  }

  /* ── STATS ─────────────────────────────────────────────── */
  _initBaseStats() {
    const cls = CLASSES[this.className];
    const base = cls.baseStats;
    const lm = 1 + (this.level - 1) * 0.10;   // 10% per level

    this.maxHp              = Math.floor(base.hp   * lm);
    this.maxMana            = Math.floor(base.mana * lm);
    this.baseAttackPower    = Math.floor(base.attackPower  * lm);
    this.baseSpellPower     = Math.floor(base.spellPower   * lm);
    this.armor              = Math.floor(base.armor        * lm);
    this.speed              = base.speed;
    this.baseCritChance     = base.critChance;
    this.baseDodgeChance    = base.dodgeChance;
    this.autoAttackInterval = base.autoAttackInterval;
    this.abilities          = cls.abilities;
    this.classColor         = cls.color;
    this.icon               = cls.icon;
  }

  /* Effective stats include buffs */
  get attackPower() {
    let ap = this.baseAttackPower;
    for (const b of this.buffs) {
      if (b.type === 'attackPower') ap *= (1 + b.amount);
    }
    return Math.floor(ap);
  }
  get spellPower()  { return Math.floor(this.baseSpellPower); }
  get critChance()  { return Math.min(0.80, this.baseCritChance); }
  get dodgeChance() {
    let d = this.baseDodgeChance;
    for (const b of this.buffs) if (b.type === 'dodgeBonus') d += b.amount;
    return Math.min(0.95, d);
  }

  isImmune()  { return this.buffs.some(b => b.type === 'immune'); }
  isStunned() { return this.state === 'stunned' || this.state === 'feared'; }

  /* ── PREP ─────────────────────────────────────────────── */
  prepareForBattle() {
    this.hp              = this.maxHp;
    this.mana            = this.maxMana;
    this.alive           = true;
    this.state           = 'idle';
    this.stateTimer      = 0;
    this.buffs           = [];
    this.dots            = [];
    this.targetId        = null;
    this.autoAttackTimer = 0;
    this.abilityCooldowns = {};
  }

  /* ── PROGRESSION ─────────────────────────────────────── */
  addXP(amount) {
    this.xp += amount;
    while (this.xp >= this.xpToNextLevel && this.level < 60) {
      this.xp -= this.xpToNextLevel;
      this._levelUp();
    }
    if (this.level >= 60) this.xp = Math.min(this.xp, this.xpToNextLevel - 1);
  }

  _levelUp() {
    this.level++;
    this.talentPoints++;
    this.xpToNextLevel = Math.floor(300 * Math.pow(1.14, this.level - 1));
    const prevHpRatio = this.hp / this.maxHp;
    this._initBaseStats();
    // Re-apply item bonuses
    this._reapplyItems();
    // Re-apply talent bonuses
    this._reapplyTalents();
    this.hp   = Math.floor(this.maxHp * prevHpRatio);
    this.mana = this.maxMana;
    return true;
  }

  _reapplyItems() {
    /* stored items are applied cumulatively - we track purchased item ids
       and re-apply their stat deltas on top of base */
    const { SHOP_ITEMS } = require('../public/js/gameData');
    for (const itemId of this.items) {
      const item = SHOP_ITEMS.find(i => i.id === itemId);
      if (item && item.stats) this._applyItemStats(item.stats);
    }
  }

  _reapplyTalents() {
    const { TALENT_TREES } = require('../public/js/gameData');
    for (const [talentId, rank] of Object.entries(this.talents)) {
      const talent = TALENT_TREES[talentId];
      if (talent) this._applyTalentEffect(talent, rank);
    }
  }

  _applyItemStats(stats) {
    if (stats.hp)          this.maxHp           += stats.hp;
    if (stats.mana)        this.maxMana         += stats.mana;
    if (stats.attackPower) this.baseAttackPower += stats.attackPower;
    if (stats.spellPower)  this.baseSpellPower  += stats.spellPower;
    if (stats.armor)       this.armor           += stats.armor;
    if (stats.critChance)  this.baseCritChance  += stats.critChance;
    if (stats.dodgeChance) this.baseDodgeChance += stats.dodgeChance;
    if (stats.speed)       this.speed           += stats.speed;
  }

  applyItem(item) {
    this.items.push(item.id);
    if (item.stats) this._applyItemStats(item.stats);
    // Refill HP/mana to new max on item equip
    this.hp   = Math.min(this.hp, this.maxHp);
    this.mana = Math.min(this.mana, this.maxMana);
  }

  allocateTalent(talentId) {
    const { TALENT_TREES } = require('../public/js/gameData');
    const talent = TALENT_TREES[talentId];
    if (!talent) return false;
    if (talent.className !== this.className) return false;
    const currentRank = this.talents[talentId] || 0;
    if (currentRank >= talent.maxRank) return false;
    if (this.talentPoints <= 0) return false;

    this.talents[talentId] = currentRank + 1;
    this.talentPoints--;
    this._applyTalentEffect(talent, 1); // apply one rank delta
    return true;
  }

  _applyTalentEffect(talent, ranks = 1) {
    const v = talent.value * ranks;
    switch (talent.effect) {
      case 'attackPower':  this.baseAttackPower  = Math.floor(this.baseAttackPower * (1 + v)); break;
      case 'spellPower':   this.baseSpellPower   = Math.floor(this.baseSpellPower  * (1 + v)); break;
      case 'hp':           this.maxHp            = Math.floor(this.maxHp           * (1 + v)); break;
      case 'mana':         this.maxMana          = Math.floor(this.maxMana         * (1 + v)); break;
      case 'armor':        this.armor            = Math.floor(this.armor           * (1 + v)); break;
      case 'critChance':   this.baseCritChance  += v; break;
      case 'dodgeChance':  this.baseDodgeChance += v; break;
      case 'speed':        this.speed           += v; break;
    }
  }

  /* ── TICK ─────────────────────────────────────────────── */
  tickEffects(dt) {
    const events = [];

    /* state timers (stun, fear, immune) */
    if (this.stateTimer > 0) {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) { this.state = 'idle'; this.stateTimer = 0; }
    }

    /* buff timers */
    this.buffs = this.buffs.filter(b => { b.remaining -= dt; return b.remaining > 0; });

    /* DoT ticks */
    for (const dot of this.dots) {
      dot.tickTimer  -= dt;
      dot.remaining  -= dt;
      if (dot.tickTimer <= 0) {
        dot.tickTimer = dot.tickRate;
        const power   = dot.damageType === 'physical' ? this.attackPower : this.baseSpellPower;
        const dmg     = Math.max(1, Math.floor(power * dot.damage));
        events.push({ type: 'damage', targetId: this.id, sourceId: dot.sourceId, amount: dmg, abilityId: dot.abilityId, isTick: true });
        if (dot.healSourceId) {
          events.push({ type: 'heal', targetId: dot.healSourceId, sourceId: this.id, amount: Math.floor(dmg * 0.8) });
        }
      }
    }
    this.dots = this.dots.filter(d => d.remaining > 0);

    /* cooldown ticks */
    for (const [aid] of Object.entries(this.abilityCooldowns)) {
      this.abilityCooldowns[aid] = Math.max(0, this.abilityCooldowns[aid] - dt);
    }

    /* mana regen (2% of max mana per second) */
    this.mana = Math.min(this.maxMana, this.mana + this.maxMana * 0.02 * (dt / 1000));

    return events;
  }

  /* ── SERIALIZE ─────────────────────────────────────────── */
  serialize() {
    return {
      id:                  this.id,
      name:                this.name,
      className:           this.className,
      classColor:          this.classColor,
      icon:                this.icon,
      level:               this.level,
      xp:                  this.xp,
      xpToNextLevel:       this.xpToNextLevel,
      talentPoints:        this.talentPoints,
      talents:             { ...this.talents },
      items:               [...this.items],
      hp:                  this.hp,
      maxHp:               this.maxHp,
      mana:                this.mana,
      maxMana:             this.maxMana,
      attackPower:         this.attackPower,
      spellPower:          this.spellPower,
      armor:               this.armor,
      critChance:          this.critChance,
      dodgeChance:         this.dodgeChance,
      speed:               this.speed,
      x:                   this.x,
      y:                   this.y,
      facing:              this.facing,
      alive:               this.alive,
      state:               this.state,
      buffs:               this.buffs.map(b => ({ type: b.type, remaining: b.remaining, amount: b.amount })),
      activeDots:          this.dots.map(d => ({ abilityId: d.abilityId, remaining: d.remaining })),
      abilityCooldowns:    { ...this.abilityCooldowns },
      abilities:           [...this.abilities]
    };
  }

  getStats() { return this.serialize(); }
}

module.exports = Bot;
