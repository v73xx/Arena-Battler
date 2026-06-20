/* ============================================================
   GAME DATA — shared between server (Node.js) and client (browser)
   UMD pattern: works with require() and as a plain <script>
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.GAME_DATA = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* ── CLASS DEFINITIONS ─────────────────────────────────── */
  const CLASSES = {
    warrior: {
      name: 'Warrior', color: '#C8973A', glowColor: '#FFD700',
      icon: '⚔️', arenaIcon: 'W',
      description: 'Iron-willed melee fighter. High HP, devastating strikes.',
      role: 'Melee DPS / Tank',
      baseStats: {
        hp: 2400, mana: 600, attackPower: 180, spellPower: 20,
        armor: 215, speed: 1.3, critChance: 0.06, dodgeChance: 0.04,
        autoAttackInterval: 1600
      },
      abilities: ['heroicStrike', 'shieldBash', 'whirlwind', 'battleCry'],
      talentPrefix: 'warrior'
    },
    mage: {
      name: 'Mage', color: '#69CCF0', glowColor: '#00CCFF',
      icon: '🔮', arenaIcon: 'M',
      description: 'Arcane master. Glass cannon with freezes and fireballs.',
      role: 'Ranged Magic DPS',
      baseStats: {
        hp: 1650, mana: 2200, attackPower: 40, spellPower: 238,
        armor: 75, speed: 1.6, critChance: 0.08, dodgeChance: 0.03,
        autoAttackInterval: 2000
      },
      abilities: ['fireball', 'frostNova', 'arcaneBlast', 'iceBlock'],
      talentPrefix: 'mage'
    },
    paladin: {
      name: 'Paladin', color: '#F58CBA', glowColor: '#FFB0D4',
      icon: '🛡️', arenaIcon: 'P',
      description: 'Holy warrior. Heals while dealing damage, nearly unkillable.',
      role: 'Support Hybrid',
      baseStats: {
        hp: 2280, mana: 1500, attackPower: 130, spellPower: 150,
        armor: 210, speed: 1.4, critChance: 0.05, dodgeChance: 0.05,
        autoAttackInterval: 1800
      },
      abilities: ['holyStrike', 'divineShield', 'judgement', 'layOnHands'],
      talentPrefix: 'paladin'
    },
    hunter: {
      name: 'Hunter', color: '#ABD473', glowColor: '#88FF44',
      icon: '🏹', arenaIcon: 'H',
      description: 'Ranged predator. High crit chance and relentless DoTs.',
      role: 'Ranged Physical DPS',
      baseStats: {
        hp: 1900, mana: 1300, attackPower: 200, spellPower: 45,
        armor: 125, speed: 1.9, critChance: 0.10, dodgeChance: 0.07,
        autoAttackInterval: 1700
      },
      abilities: ['aimedShot', 'multiShot', 'serpentSting', 'deterrence'],
      talentPrefix: 'hunter'
    },
    rogue: {
      name: 'Rogue', color: '#FFF569', glowColor: '#FFFF00',
      icon: '🗡️', arenaIcon: 'R',
      description: 'Shadow assassin. Fastest attacker with brutal burst damage.',
      role: 'Burst Melee DPS',
      baseStats: {
        hp: 1800, mana: 850, attackPower: 222, spellPower: 20,
        armor: 90, speed: 2.1, critChance: 0.12, dodgeChance: 0.11,
        autoAttackInterval: 1200
      },
      abilities: ['sinisterStrike', 'backstab', 'evasion', 'shadowstep'],
      talentPrefix: 'rogue'
    },
    warlock: {
      name: 'Warlock', color: '#9482C9', glowColor: '#CC88FF',
      icon: '💀', arenaIcon: 'WL',
      description: 'Fel sorcerer. DoTs, fear, and soul-draining corruption.',
      role: 'DoT / Control Caster',
      baseStats: {
        hp: 1800, mana: 1900, attackPower: 50, spellPower: 260,
        armor: 85, speed: 1.5, critChance: 0.07, dodgeChance: 0.03,
        autoAttackInterval: 2000
      },
      abilities: ['curseOfAgony', 'drainLife', 'fear', 'chaosBolt'],
      talentPrefix: 'warlock'
    }
  };

  /* ── ABILITY DEFINITIONS ──────────────────────────────── */
  const ABILITIES = {
    /* WARRIOR */
    heroicStrike: {
      id: 'heroicStrike', name: 'Heroic Strike', icon: '⚔️',
      type: 'melee', damageType: 'physical',
      damage: 1.7, cooldown: 5000, manaCost: 30, range: 75,
      description: 'Brutal strike dealing 170% AP.',
      color: '#FFD700', particleColor: '#FFB800', sfxType: 'slash'
    },
    shieldBash: {
      id: 'shieldBash', name: 'Shield Bash', icon: '🛡️',
      type: 'melee', damageType: 'physical',
      damage: 0.85, cooldown: 12000, manaCost: 40, range: 75,
      stun: 1800,
      description: 'Bash with shield, stunning target for 1.8s.',
      color: '#C0C0C0', particleColor: '#DDDDDD', sfxType: 'bash'
    },
    whirlwind: {
      id: 'whirlwind', name: 'Whirlwind', icon: '🌀',
      type: 'aoe', damageType: 'physical',
      damage: 1.0, cooldown: 10000, manaCost: 60, range: 115,
      description: 'Spin and hit all nearby enemies.',
      color: '#FF8800', particleColor: '#FFAA44', sfxType: 'spin'
    },
    battleCry: {
      id: 'battleCry', name: 'Battle Cry', icon: '📣',
      type: 'buff', cooldown: 28000, manaCost: 20,
      buffType: 'attackPower', buffAmount: 0.55, buffDuration: 8000,
      description: '+55% Attack Power for 8s.',
      color: '#FFD700', particleColor: '#FFD700', sfxType: 'buff'
    },
    /* MAGE */
    fireball: {
      id: 'fireball', name: 'Fireball', icon: '🔥',
      type: 'projectile', damageType: 'magic',
      damage: 1.30, cooldown: 3000, manaCost: 85, range: 420,
      projectileSpeed: 380,
      description: 'Fiery bolt dealing 130% SP.',
      color: '#FF4400', particleColor: '#FF6600', sfxType: 'fire'
    },
    frostNova: {
      id: 'frostNova', name: 'Frost Nova', icon: '❄️',
      type: 'aoe', damageType: 'magic',
      damage: 0.55, cooldown: 20000, manaCost: 110, range: 160,
      freeze: 2200,
      description: 'Freeze all nearby enemies for 2.2s.',
      color: '#00CCFF', particleColor: '#88EEFF', sfxType: 'frost'
    },
    arcaneBlast: {
      id: 'arcaneBlast', name: 'Arcane Blast', icon: '✨',
      type: 'projectile', damageType: 'magic',
      damage: 1.55, cooldown: 8000, manaCost: 150, range: 420,
      projectileSpeed: 500,
      description: 'Arcane bolt dealing 155% SP.',
      color: '#CC00FF', particleColor: '#EE88FF', sfxType: 'arcane'
    },
    iceBlock: {
      id: 'iceBlock', name: 'Ice Block', icon: '🧊',
      type: 'defensive', cooldown: 60000, manaCost: 150,
      immune: 3200,
      description: 'Immune to all damage for 3.2s.',
      color: '#00CCFF', particleColor: '#88EEFF', sfxType: 'frost'
    },
    /* PALADIN */
    holyStrike: {
      id: 'holyStrike', name: 'Holy Strike', icon: '✝️',
      type: 'melee', damageType: 'holy',
      damage: 1.0, healSelf: 0.5, cooldown: 8000, manaCost: 65, range: 75,
      description: 'Deal damage and heal yourself for 50% SP.',
      color: '#FFD700', particleColor: '#FFFFAA', sfxType: 'holy'
    },
    divineShield: {
      id: 'divineShield', name: 'Divine Shield', icon: '🌟',
      type: 'defensive', cooldown: 100000, manaCost: 210,
      immune: 4500,
      description: 'Immune to all for 4.5s. (Bubble!)',
      color: '#FFD700', particleColor: '#FFFFFF', sfxType: 'holy'
    },
    judgement: {
      id: 'judgement', name: 'Judgement', icon: '⚡',
      type: 'projectile', damageType: 'holy',
      damage: 1.25, cooldown: 10000, manaCost: 85, range: 320,
      projectileSpeed: 450,
      description: 'Holy bolt dealing 125% combined power.',
      color: '#FFD700', particleColor: '#FFFF88', sfxType: 'holy'
    },
    layOnHands: {
      id: 'layOnHands', name: 'Lay on Hands', icon: '💚',
      type: 'heal', cooldown: 240000, manaCost: 0,
      healSelf: 1.0,
      description: 'Fully restore your HP. Long cooldown.',
      color: '#00FF88', particleColor: '#88FFCC', sfxType: 'holy'
    },
    /* HUNTER */
    aimedShot: {
      id: 'aimedShot', name: 'Aimed Shot', icon: '🎯',
      type: 'projectile', damageType: 'physical',
      damage: 1.95, cooldown: 10000, manaCost: 85, range: 460,
      projectileSpeed: 620,
      description: 'Precisely aimed shot dealing 195% AP.',
      color: '#ABD473', particleColor: '#CCFF88', sfxType: 'arrow'
    },
    multiShot: {
      id: 'multiShot', name: 'Multi-Shot', icon: '🏹',
      type: 'aoe_ranged', damageType: 'physical',
      damage: 0.72, cooldown: 8000, manaCost: 65, range: 420,
      description: 'Volley of arrows hitting all enemies.',
      color: '#88CC44', particleColor: '#AADDAA', sfxType: 'arrow'
    },
    serpentSting: {
      id: 'serpentSting', name: 'Serpent Sting', icon: '🐍',
      type: 'dot', damageType: 'nature',
      damage: 0.14, tickRate: 2000, ticks: 8,
      cooldown: 6000, manaCost: 45, range: 420,
      description: 'Poison dealing damage over 16s.',
      color: '#44FF44', particleColor: '#88FF88', sfxType: 'poison'
    },
    deterrence: {
      id: 'deterrence', name: 'Deterrence', icon: '🔄',
      type: 'defensive', cooldown: 90000, manaCost: 80,
      dodgeBonus: 1.0, duration: 3200,
      description: 'Dodge all attacks for 3.2s.',
      color: '#ABD473', particleColor: '#CCFFAA', sfxType: 'buff'
    },
    /* ROGUE */
    sinisterStrike: {
      id: 'sinisterStrike', name: 'Sinister Strike', icon: '🗡️',
      type: 'melee', damageType: 'physical',
      damage: 1.35, cooldown: 3000, manaCost: 22, range: 75,
      description: 'Quick strike dealing 135% AP.',
      color: '#FFF569', particleColor: '#FFFF88', sfxType: 'slash'
    },
    backstab: {
      id: 'backstab', name: 'Backstab', icon: '💀',
      type: 'melee', damageType: 'physical',
      damage: 2.3, cooldown: 9500, manaCost: 45, range: 75,
      description: 'Devastating stab dealing 230% AP.',
      color: '#FF0044', particleColor: '#FF4488', sfxType: 'stab'
    },
    evasion: {
      id: 'evasion', name: 'Evasion', icon: '💨',
      type: 'defensive', cooldown: 45000, manaCost: 0,
      dodgeBonus: 0.55, duration: 10000,
      description: '+55% dodge for 10s.',
      color: '#FFF569', particleColor: '#FFFFAA', sfxType: 'buff'
    },
    shadowstep: {
      id: 'shadowstep', name: 'Shadowstep', icon: '👤',
      type: 'gap_closer', damageType: 'physical',
      damage: 0.55, cooldown: 20000, manaCost: 35, range: 350,
      description: 'Teleport to target + deal 55% AP.',
      color: '#440088', particleColor: '#8800CC', sfxType: 'shadow'
    },
    /* WARLOCK */
    curseOfAgony: {
      id: 'curseOfAgony', name: 'Curse of Agony', icon: '☠️',
      type: 'dot', damageType: 'shadow',
      damage: 0.13, tickRate: 2000, ticks: 6,
      cooldown: 6000, manaCost: 55, range: 400,
      description: 'Shadow curse dealing damage over 12s.',
      color: '#9482C9', particleColor: '#CC88FF', sfxType: 'shadow'
    },
    drainLife: {
      id: 'drainLife', name: 'Drain Life', icon: '🩸',
      type: 'channel', damageType: 'shadow',
      damage: 0.32, healSelf: 0.32, tickRate: 1000, ticks: 5,
      cooldown: 10000, manaCost: 105, range: 320,
      description: 'Drain target life, healing yourself.',
      color: '#CC0000', particleColor: '#FF4444', sfxType: 'drain'
    },
    fear: {
      id: 'fear', name: 'Fear', icon: '😱',
      type: 'cc', cooldown: 20000, manaCost: 85, range: 360,
      fear: 3000,
      description: 'Cause target to flee for 3s.',
      color: '#440044', particleColor: '#8800CC', sfxType: 'shadow'
    },
    chaosBolt: {
      id: 'chaosBolt', name: 'Chaos Bolt', icon: '💥',
      type: 'projectile', damageType: 'fire',
      damage: 1.85, cooldown: 12000, manaCost: 170, range: 420,
      projectileSpeed: 340, piercing: true,
      description: 'Unstoppable chaos bolt dealing 185% SP.',
      color: '#FF4400', particleColor: '#FF8844', sfxType: 'fire'
    }
  };

  /* ── LOOT RARITY TIERS ────────────────────────────────── */
  /* weight = relative drop chance. statBudgetMult scales total stat points
     on a generated item relative to a baseline tier-2 shop item of the same
     level. Order is the standard ascending rarity ladder. */
  const RARITY_TIERS = {
    common:    { key: 'common',    label: 'Common',    color: '#B8B6BD', weight: 42, statBudgetMult: 0.85, statCount: [1, 2] },
    uncommon:  { key: 'uncommon',  label: 'Uncommon',  color: '#3FBF50', weight: 30, statBudgetMult: 1.10, statCount: [2, 2] },
    rare:      { key: 'rare',      label: 'Rare',      color: '#3F8FE0', weight: 17, statBudgetMult: 1.45, statCount: [2, 3] },
    epic:      { key: 'epic',      label: 'Epic',      color: '#A84FE8', weight: 8,  statBudgetMult: 1.90, statCount: [3, 4] },
    legendary: { key: 'legendary', label: 'Legendary', color: '#E89A3C', weight: 3,  statBudgetMult: 2.60, statCount: [3, 4] }
  };
  const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

  /* Procedural naming parts, organized by slot. The generator (server-side)
     picks one prefix + one base noun to build a flavorful item name. */
  const LOOT_NAME_PARTS = {
    weapon: {
      prefixes: ['Bloodforged', "Gladiator's", 'Runed', 'Savage', 'Doomforged', 'Sanctified', 'Berserker\'s', 'Venomstrike', 'Stormcaller\'s', 'Ashen'],
      nouns: ['Blade', 'Greataxe', 'Warstaff', 'Longbow', 'Dagger', 'Maul', 'Cleaver', 'Wand', 'Spellbook', 'Battlehammer']
    },
    armor: {
      prefixes: ['Reinforced', "Champion's", 'Hardened', 'Sanctified', 'Drakeforged', 'Grim', 'Resolute', 'Wyrmscale', 'Stonewoven', 'Battle-Worn'],
      nouns: ['Breastplate', 'Chestguard', 'Vestments', 'Hauberk', 'Plackart', 'Robes', 'Warplate', 'Carapace', 'Mantle', 'Aegis']
    },
    trinket: {
      prefixes: ['Forgotten', 'Glimmering', 'Cursed', 'Arcane', 'Eternal', "Victor's", 'Bloodstained', 'Fel-Touched', 'Sundered', 'Hallowed'],
      nouns: ['Talisman', 'Signet', 'Idol', 'Charm', 'Relic', 'Emblem', 'Sigil', 'Medallion', 'Trophy', 'Shard']
    }
  };

  /* Possible stat keys a generated item can roll, with relative weight
     toward "primary" combat stats vs defensive/utility stats.
     perPointValue is calibrated so a full single-stat budget dump at
     level 1/common lands near the weakest shop item of that stat, and
     at level 60/legendary lands well above the best shop item. */
  const LOOT_STAT_POOL = [
    { key: 'attackPower', weight: 5, perPointValue: 0.65 },
    { key: 'spellPower',  weight: 5, perPointValue: 0.65 },
    { key: 'hp',          weight: 5, perPointValue: 3.0 },
    { key: 'armor',       weight: 4, perPointValue: 1.3 },
    { key: 'critChance',  weight: 3, perPointValue: 0.0004 },
    { key: 'dodgeChance', weight: 3, perPointValue: 0.0004 },
    { key: 'mana',        weight: 3, perPointValue: 1.8 },
    { key: 'speed',       weight: 2, perPointValue: 0.001 }
  ];

  /* ── SHOP ITEMS ───────────────────────────────────────── */
  const SHOP_ITEMS = [
    /* Tier 1 — 100–175g */
    {
      id: 'rough_blade', name: "Rough Blade", tier: 1, cost: 110, icon: '🗡️',
      category: 'weapon', classes: ['warrior', 'rogue', 'paladin'],
      description: '+30 Attack Power',
      stats: { attackPower: 30 }
    },
    {
      id: 'crude_staff', name: 'Crude Staff', tier: 1, cost: 120, icon: '🪄',
      category: 'weapon', classes: ['mage', 'warlock'],
      description: '+35 Spell Power',
      stats: { spellPower: 35 }
    },
    {
      id: 'hunting_bow', name: 'Hunting Bow', tier: 1, cost: 115, icon: '🏹',
      category: 'weapon', classes: ['hunter'],
      description: '+35 Attack Power',
      stats: { attackPower: 35 }
    },
    {
      id: 'iron_shield', name: 'Iron Shield', tier: 1, cost: 130, icon: '🛡️',
      category: 'armor', classes: ['warrior', 'paladin'],
      description: '+80 Armor, +150 HP',
      stats: { armor: 80, hp: 150 }
    },
    {
      id: 'leather_chestpiece', name: 'Leather Chestpiece', tier: 1, cost: 115, icon: '🥋',
      category: 'armor', classes: ['rogue', 'hunter', 'warlock', 'mage'],
      description: '+55 Armor, +120 HP',
      stats: { armor: 55, hp: 120 }
    },
    {
      id: 'swift_boots', name: 'Swift Boots', tier: 1, cost: 150, icon: '👢',
      category: 'trinket', classes: ['all'],
      description: '+0.2 Speed, +4% Dodge',
      stats: { speed: 0.2, dodgeChance: 0.04 }
    },
    /* Tier 2 — 200–320g */
    {
      id: 'serrated_sword', name: 'Serrated Sword', tier: 2, cost: 240, icon: '⚔️',
      category: 'weapon', classes: ['warrior', 'rogue', 'paladin'],
      description: '+60 Attack Power, +4% Crit',
      stats: { attackPower: 60, critChance: 0.04 }
    },
    {
      id: 'arcane_focus', name: 'Arcane Focus', tier: 2, cost: 260, icon: '📖',
      category: 'weapon', classes: ['mage', 'warlock', 'paladin'],
      description: '+70 Spell Power, +250 Mana',
      stats: { spellPower: 70, mana: 250 }
    },
    {
      id: 'longbow_of_the_hunt', name: 'Longbow of the Hunt', tier: 2, cost: 250, icon: '🎯',
      category: 'weapon', classes: ['hunter'],
      description: '+65 Attack Power, +5% Crit',
      stats: { attackPower: 65, critChance: 0.05 }
    },
    {
      id: 'enchanted_plate', name: 'Enchanted Plate', tier: 2, cost: 280, icon: '🛡️',
      category: 'armor', classes: ['warrior', 'paladin'],
      description: '+150 Armor, +350 HP',
      stats: { armor: 150, hp: 350 }
    },
    {
      id: 'shadowweave_cloak', name: 'Shadowweave Cloak', tier: 2, cost: 220, icon: '🧣',
      category: 'trinket', classes: ['all'],
      description: '+4% Crit, +5% Dodge',
      stats: { critChance: 0.04, dodgeChance: 0.05 }
    },
    {
      id: 'bloodstone_pendant', name: 'Bloodstone Pendant', tier: 2, cost: 310, icon: '💎',
      category: 'trinket', classes: ['all'],
      description: '+400 HP, +3% Crit',
      stats: { hp: 400, critChance: 0.03 }
    },
    /* Tier 3 — 400–600g */
    {
      id: 'destroyers_axe', name: "Destroyer's Axe", tier: 3, cost: 480, icon: '🪓',
      category: 'weapon', classes: ['warrior', 'rogue'],
      description: '+110 Attack Power, +7% Crit',
      stats: { attackPower: 110, critChance: 0.07 }
    },
    {
      id: 'grand_arcanum', name: 'Grand Arcanum', tier: 3, cost: 520, icon: '📜',
      category: 'weapon', classes: ['mage', 'warlock'],
      description: '+130 Spell Power, +600 Mana, +5% Crit',
      stats: { spellPower: 130, mana: 600, critChance: 0.05 }
    },
    {
      id: 'blessed_warplate', name: 'Blessed Warplate', tier: 3, cost: 560, icon: '🛡️',
      category: 'armor', classes: ['warrior', 'paladin'],
      description: '+280 Armor, +700 HP',
      stats: { armor: 280, hp: 700 }
    },
    {
      id: 'bloodlust_pendant', name: 'Bloodlust Pendant', tier: 3, cost: 580, icon: '🔥',
      category: 'trinket', classes: ['all'],
      description: '+90 AP, +90 SP, +5% Crit',
      stats: { attackPower: 90, spellPower: 90, critChance: 0.05 }
    }
  ];

  /* ── TALENT TREES ─────────────────────────────────────── */
  /* Each class has 9 talents: 3 Offense, 3 Defense, 3 Mastery */
  /* maxRank 3, effect applied per rank */
  const TALENT_TREES = {
    /* ── WARRIOR ── */
    warrior_blood_fury: {
      id: 'warrior_blood_fury', className: 'warrior', tree: 'offense', tier: 1,
      name: 'Blood Fury', icon: '🩸', maxRank: 3,
      effect: 'attackPower', value: 0.09,
      description: '+9% Attack Power per rank'
    },
    warrior_weapon_mastery: {
      id: 'warrior_weapon_mastery', className: 'warrior', tree: 'offense', tier: 2,
      name: 'Weapon Mastery', icon: '⚔️', maxRank: 3,
      effect: 'critChance', value: 0.03,
      description: '+3% Crit Chance per rank'
    },
    warrior_berserker: {
      id: 'warrior_berserker', className: 'warrior', tree: 'offense', tier: 3,
      name: 'Berserker Stance', icon: '😤', maxRank: 3,
      effect: 'speed', value: 0.12,
      description: '+0.12 Attack Speed per rank'
    },
    warrior_iron_skin: {
      id: 'warrior_iron_skin', className: 'warrior', tree: 'defense', tier: 1,
      name: 'Iron Skin', icon: '🛡️', maxRank: 3,
      effect: 'armor', value: 0.10,
      description: '+10% Armor per rank'
    },
    warrior_endurance: {
      id: 'warrior_endurance', className: 'warrior', tree: 'defense', tier: 2,
      name: 'Endurance', icon: '❤️', maxRank: 3,
      effect: 'hp', value: 0.09,
      description: '+9% Max HP per rank'
    },
    warrior_thick_hide: {
      id: 'warrior_thick_hide', className: 'warrior', tree: 'defense', tier: 3,
      name: 'Thick Hide', icon: '🦏', maxRank: 3,
      effect: 'dodgeChance', value: 0.02,
      description: '+2% Dodge Chance per rank'
    },
    warrior_battle_hardened: {
      id: 'warrior_battle_hardened', className: 'warrior', tree: 'mastery', tier: 1,
      name: 'Battle-Hardened', icon: '💪', maxRank: 3,
      effect: 'armor', value: 0.08,
      description: '+8% Armor per rank'
    },
    warrior_warlords_fury: {
      id: 'warrior_warlords_fury', className: 'warrior', tree: 'mastery', tier: 2,
      name: "Warlord's Fury", icon: '🔥', maxRank: 3,
      effect: 'attackPower', value: 0.12,
      description: '+12% Attack Power per rank'
    },
    warrior_unyielding: {
      id: 'warrior_unyielding', className: 'warrior', tree: 'mastery', tier: 3,
      name: 'Unyielding', icon: '🗿', maxRank: 3,
      effect: 'hp', value: 0.12,
      description: '+12% Max HP per rank'
    },
    /* ── MAGE ── */
    mage_arcane_mind: {
      id: 'mage_arcane_mind', className: 'mage', tree: 'offense', tier: 1,
      name: 'Arcane Mind', icon: '🔮', maxRank: 3,
      effect: 'spellPower', value: 0.09,
      description: '+9% Spell Power per rank'
    },
    mage_critical_mass: {
      id: 'mage_critical_mass', className: 'mage', tree: 'offense', tier: 2,
      name: 'Critical Mass', icon: '💥', maxRank: 3,
      effect: 'critChance', value: 0.03,
      description: '+3% Crit Chance per rank'
    },
    mage_spell_surge: {
      id: 'mage_spell_surge', className: 'mage', tree: 'offense', tier: 3,
      name: 'Spell Surge', icon: '⚡', maxRank: 3,
      effect: 'spellPower', value: 0.13,
      description: '+13% Spell Power per rank'
    },
    mage_mana_shield: {
      id: 'mage_mana_shield', className: 'mage', tree: 'defense', tier: 1,
      name: 'Mana Shield', icon: '🧊', maxRank: 3,
      effect: 'hp', value: 0.08,
      description: '+8% effective HP per rank'
    },
    mage_prismatic_cloak: {
      id: 'mage_prismatic_cloak', className: 'mage', tree: 'defense', tier: 2,
      name: 'Prismatic Cloak', icon: '🌈', maxRank: 3,
      effect: 'dodgeChance', value: 0.03,
      description: '+3% Dodge per rank'
    },
    mage_arcane_fortitude: {
      id: 'mage_arcane_fortitude', className: 'mage', tree: 'defense', tier: 3,
      name: 'Arcane Fortitude', icon: '🔷', maxRank: 3,
      effect: 'armor', value: 0.15,
      description: '+15% Armor per rank'
    },
    mage_deep_freeze: {
      id: 'mage_deep_freeze', className: 'mage', tree: 'mastery', tier: 1,
      name: 'Deep Freeze', icon: '❄️', maxRank: 3,
      effect: 'spellPower', value: 0.10,
      description: '+10% Spell Power per rank'
    },
    mage_ley_surge: {
      id: 'mage_ley_surge', className: 'mage', tree: 'mastery', tier: 2,
      name: 'Ley Surge', icon: '✨', maxRank: 3,
      effect: 'mana', value: 0.10,
      description: '+10% Max Mana per rank'
    },
    mage_temporal_mastery: {
      id: 'mage_temporal_mastery', className: 'mage', tree: 'mastery', tier: 3,
      name: 'Temporal Mastery', icon: '⏳', maxRank: 3,
      effect: 'critChance', value: 0.04,
      description: '+4% Crit Chance per rank'
    },
    /* ── PALADIN ── */
    paladin_holy_power: {
      id: 'paladin_holy_power', className: 'paladin', tree: 'offense', tier: 1,
      name: 'Holy Power', icon: '✝️', maxRank: 3,
      effect: 'spellPower', value: 0.09,
      description: '+9% Spell Power per rank'
    },
    paladin_blessed_strikes: {
      id: 'paladin_blessed_strikes', className: 'paladin', tree: 'offense', tier: 2,
      name: 'Blessed Strikes', icon: '⚡', maxRank: 3,
      effect: 'attackPower', value: 0.09,
      description: '+9% Attack Power per rank'
    },
    paladin_divine_fury: {
      id: 'paladin_divine_fury', className: 'paladin', tree: 'offense', tier: 3,
      name: 'Divine Fury', icon: '🌟', maxRank: 3,
      effect: 'critChance', value: 0.03,
      description: '+3% Crit Chance per rank'
    },
    paladin_devotion_aura: {
      id: 'paladin_devotion_aura', className: 'paladin', tree: 'defense', tier: 1,
      name: 'Devotion Aura', icon: '🛡️', maxRank: 3,
      effect: 'armor', value: 0.12,
      description: '+12% Armor per rank'
    },
    paladin_sacred_duty: {
      id: 'paladin_sacred_duty', className: 'paladin', tree: 'defense', tier: 2,
      name: 'Sacred Duty', icon: '❤️', maxRank: 3,
      effect: 'hp', value: 0.10,
      description: '+10% Max HP per rank'
    },
    paladin_guardian: {
      id: 'paladin_guardian', className: 'paladin', tree: 'defense', tier: 3,
      name: 'Guardian', icon: '⚔️', maxRank: 3,
      effect: 'dodgeChance', value: 0.02,
      description: '+2% Dodge per rank'
    },
    paladin_light_of_dawn: {
      id: 'paladin_light_of_dawn', className: 'paladin', tree: 'mastery', tier: 1,
      name: 'Light of Dawn', icon: '☀️', maxRank: 3,
      effect: 'spellPower', value: 0.11,
      description: '+11% Spell Power per rank'
    },
    paladin_holy_avenger: {
      id: 'paladin_holy_avenger', className: 'paladin', tree: 'mastery', tier: 2,
      name: 'Holy Avenger', icon: '⚔️', maxRank: 3,
      effect: 'attackPower', value: 0.11,
      description: '+11% Attack Power per rank'
    },
    paladin_unbreakable: {
      id: 'paladin_unbreakable', className: 'paladin', tree: 'mastery', tier: 3,
      name: 'Unbreakable', icon: '💎', maxRank: 3,
      effect: 'hp', value: 0.13,
      description: '+13% Max HP per rank'
    },
    /* ── HUNTER ── */
    hunter_predator: {
      id: 'hunter_predator', className: 'hunter', tree: 'offense', tier: 1,
      name: 'Predator', icon: '🐾', maxRank: 3,
      effect: 'attackPower', value: 0.09,
      description: '+9% Attack Power per rank'
    },
    hunter_hawkeye: {
      id: 'hunter_hawkeye', className: 'hunter', tree: 'offense', tier: 2,
      name: 'Hawkeye', icon: '👁️', maxRank: 3,
      effect: 'critChance', value: 0.04,
      description: '+4% Crit Chance per rank'
    },
    hunter_lethal_shots: {
      id: 'hunter_lethal_shots', className: 'hunter', tree: 'offense', tier: 3,
      name: 'Lethal Shots', icon: '🎯', maxRank: 3,
      effect: 'attackPower', value: 0.13,
      description: '+13% Attack Power per rank'
    },
    hunter_thick_fur: {
      id: 'hunter_thick_fur', className: 'hunter', tree: 'defense', tier: 1,
      name: 'Thick Fur', icon: '🦊', maxRank: 3,
      effect: 'armor', value: 0.10,
      description: '+10% Armor per rank'
    },
    hunter_survivalist: {
      id: 'hunter_survivalist', className: 'hunter', tree: 'defense', tier: 2,
      name: 'Survivalist', icon: '🌿', maxRank: 3,
      effect: 'hp', value: 0.09,
      description: '+9% Max HP per rank'
    },
    hunter_evasive: {
      id: 'hunter_evasive', className: 'hunter', tree: 'defense', tier: 3,
      name: 'Evasive', icon: '💨', maxRank: 3,
      effect: 'dodgeChance', value: 0.03,
      description: '+3% Dodge per rank'
    },
    hunter_bestial_wrath: {
      id: 'hunter_bestial_wrath', className: 'hunter', tree: 'mastery', tier: 1,
      name: 'Bestial Wrath', icon: '😤', maxRank: 3,
      effect: 'speed', value: 0.10,
      description: '+0.10 Speed per rank'
    },
    hunter_serpent_mastery: {
      id: 'hunter_serpent_mastery', className: 'hunter', tree: 'mastery', tier: 2,
      name: 'Serpent Mastery', icon: '🐍', maxRank: 3,
      effect: 'attackPower', value: 0.10,
      description: '+10% Attack Power per rank'
    },
    hunter_rapid_fire: {
      id: 'hunter_rapid_fire', className: 'hunter', tree: 'mastery', tier: 3,
      name: 'Rapid Fire', icon: '🔥', maxRank: 3,
      effect: 'critChance', value: 0.04,
      description: '+4% Crit Chance per rank'
    },
    /* ── ROGUE ── */
    rogue_sinister: {
      id: 'rogue_sinister', className: 'rogue', tree: 'offense', tier: 1,
      name: 'Sinister Intent', icon: '🗡️', maxRank: 3,
      effect: 'attackPower', value: 0.09,
      description: '+9% Attack Power per rank'
    },
    rogue_blade_mastery: {
      id: 'rogue_blade_mastery', className: 'rogue', tree: 'offense', tier: 2,
      name: 'Blade Mastery', icon: '⚔️', maxRank: 3,
      effect: 'critChance', value: 0.04,
      description: '+4% Crit Chance per rank'
    },
    rogue_assassination: {
      id: 'rogue_assassination', className: 'rogue', tree: 'offense', tier: 3,
      name: 'Assassination', icon: '💀', maxRank: 3,
      effect: 'attackPower', value: 0.15,
      description: '+15% Attack Power per rank'
    },
    rogue_shadow_armor: {
      id: 'rogue_shadow_armor', className: 'rogue', tree: 'defense', tier: 1,
      name: 'Shadow Armor', icon: '🕶️', maxRank: 3,
      effect: 'armor', value: 0.12,
      description: '+12% Armor per rank'
    },
    rogue_iron_nerves: {
      id: 'rogue_iron_nerves', className: 'rogue', tree: 'defense', tier: 2,
      name: 'Iron Nerves', icon: '🧠', maxRank: 3,
      effect: 'hp', value: 0.09,
      description: '+9% Max HP per rank'
    },
    rogue_ghost_step: {
      id: 'rogue_ghost_step', className: 'rogue', tree: 'defense', tier: 3,
      name: 'Ghost Step', icon: '👻', maxRank: 3,
      effect: 'dodgeChance', value: 0.04,
      description: '+4% Dodge per rank'
    },
    rogue_shadow_dance: {
      id: 'rogue_shadow_dance', className: 'rogue', tree: 'mastery', tier: 1,
      name: 'Shadow Dance', icon: '🌑', maxRank: 3,
      effect: 'speed', value: 0.12,
      description: '+0.12 Speed per rank'
    },
    rogue_deadly_momentum: {
      id: 'rogue_deadly_momentum', className: 'rogue', tree: 'mastery', tier: 2,
      name: 'Deadly Momentum', icon: '🔥', maxRank: 3,
      effect: 'attackPower', value: 0.12,
      description: '+12% Attack Power per rank'
    },
    rogue_hemorrhage: {
      id: 'rogue_hemorrhage', className: 'rogue', tree: 'mastery', tier: 3,
      name: 'Hemorrhage', icon: '🩸', maxRank: 3,
      effect: 'critChance', value: 0.05,
      description: '+5% Crit Chance per rank'
    },
    /* ── WARLOCK ── */
    warlock_dark_pact: {
      id: 'warlock_dark_pact', className: 'warlock', tree: 'offense', tier: 1,
      name: 'Dark Pact', icon: '💀', maxRank: 3,
      effect: 'spellPower', value: 0.09,
      description: '+9% Spell Power per rank'
    },
    warlock_corruption: {
      id: 'warlock_corruption', className: 'warlock', tree: 'offense', tier: 2,
      name: 'Corruption', icon: '☠️', maxRank: 3,
      effect: 'critChance', value: 0.03,
      description: '+3% Crit Chance per rank'
    },
    warlock_fel_mastery: {
      id: 'warlock_fel_mastery', className: 'warlock', tree: 'offense', tier: 3,
      name: 'Fel Mastery', icon: '🔮', maxRank: 3,
      effect: 'spellPower', value: 0.14,
      description: '+14% Spell Power per rank'
    },
    warlock_soul_link: {
      id: 'warlock_soul_link', className: 'warlock', tree: 'defense', tier: 1,
      name: 'Soul Link', icon: '🔗', maxRank: 3,
      effect: 'hp', value: 0.10,
      description: '+10% Max HP per rank'
    },
    warlock_nether_ward: {
      id: 'warlock_nether_ward', className: 'warlock', tree: 'defense', tier: 2,
      name: 'Nether Ward', icon: '🛡️', maxRank: 3,
      effect: 'armor', value: 0.10,
      description: '+10% Armor per rank'
    },
    warlock_shadow_embrace: {
      id: 'warlock_shadow_embrace', className: 'warlock', tree: 'defense', tier: 3,
      name: 'Shadow Embrace', icon: '🌑', maxRank: 3,
      effect: 'dodgeChance', value: 0.02,
      description: '+2% Dodge per rank'
    },
    warlock_affliction: {
      id: 'warlock_affliction', className: 'warlock', tree: 'mastery', tier: 1,
      name: 'Affliction', icon: '😈', maxRank: 3,
      effect: 'spellPower', value: 0.11,
      description: '+11% Spell Power per rank'
    },
    warlock_demonology: {
      id: 'warlock_demonology', className: 'warlock', tree: 'mastery', tier: 2,
      name: 'Demonology', icon: '👹', maxRank: 3,
      effect: 'hp', value: 0.11,
      description: '+11% Max HP per rank'
    },
    warlock_destruction: {
      id: 'warlock_destruction', className: 'warlock', tree: 'mastery', tier: 3,
      name: 'Destruction', icon: '🔥', maxRank: 3,
      effect: 'critChance', value: 0.04,
      description: '+4% Crit Chance per rank'
    }
  };

  /* ── AI BEHAVIOR PROFILES ─────────────────────────────── */
  /* Drives how each class's bot moves and chooses abilities in combat.
     rotation = priority order the AI tries abilities in (first valid wins) */
  const AI_PROFILES = {
    warrior: {
      preferredRange: 70, autoAttackRange: 75, kiting: false,
      autoAttackPower: 'attackPower', autoAttackMultiplier: 0.55, autoAttackDamageType: 'physical',
      rotation: ['shieldBash', 'whirlwind', 'battleCry', 'heroicStrike']
    },
    mage: {
      preferredRange: 360, autoAttackRange: 380, kiting: true,
      autoAttackPower: 'spellPower', autoAttackMultiplier: 0.32, autoAttackDamageType: 'magic',
      rotation: ['iceBlock', 'frostNova', 'arcaneBlast', 'fireball']
    },
    paladin: {
      preferredRange: 70, autoAttackRange: 75, kiting: false,
      autoAttackPower: 'attackPower', autoAttackMultiplier: 0.5, autoAttackDamageType: 'physical',
      rotation: ['divineShield', 'layOnHands', 'judgement', 'holyStrike']
    },
    hunter: {
      preferredRange: 340, autoAttackRange: 400, kiting: true,
      autoAttackPower: 'attackPower', autoAttackMultiplier: 0.45, autoAttackDamageType: 'physical',
      rotation: ['deterrence', 'aimedShot', 'serpentSting', 'multiShot']
    },
    rogue: {
      preferredRange: 65, autoAttackRange: 75, kiting: false,
      autoAttackPower: 'attackPower', autoAttackMultiplier: 0.5, autoAttackDamageType: 'physical',
      rotation: ['evasion', 'shadowstep', 'backstab', 'sinisterStrike']
    },
    warlock: {
      preferredRange: 340, autoAttackRange: 380, kiting: true,
      autoAttackPower: 'spellPower', autoAttackMultiplier: 0.28, autoAttackDamageType: 'magic',
      rotation: ['fear', 'curseOfAgony', 'drainLife', 'chaosBolt']
    }
  };

  return { CLASSES, ABILITIES, SHOP_ITEMS, TALENT_TREES, AI_PROFILES, RARITY_TIERS, RARITY_ORDER, LOOT_NAME_PARTS, LOOT_STAT_POOL };
}));
