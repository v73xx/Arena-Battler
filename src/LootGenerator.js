'use strict';
/* ============================================================
   LOOT GENERATOR
   Server-authoritative procedural item generation for round-end
   crates and world drops. Items scale to the average level of
   the arena and roll a rarity tier, then a stat budget split
   across 1–4 randomly weighted stats.
   ============================================================ */
const { RARITY_TIERS, RARITY_ORDER, LOOT_NAME_PARTS, LOOT_STAT_POOL, CLASSES } = require('../public/js/gameData');
const { v4: uuidv4 } = require('uuid');

const SLOTS = ['weapon', 'armor', 'trinket'];

function pickWeighted(entries, weightFn) {
  const total = entries.reduce((sum, e) => sum + weightFn(e), 0);
  let roll = Math.random() * total;
  for (const e of entries) {
    roll -= weightFn(e);
    if (roll <= 0) return e;
  }
  return entries[entries.length - 1];
}

function rollRarity() {
  const tiers = RARITY_ORDER.map(k => RARITY_TIERS[k]);
  return pickWeighted(tiers, t => t.weight).key;
}

function rollSlot() { return SLOTS[Math.floor(Math.random() * SLOTS.length)]; }

function buildName(slot, rarity) {
  const parts = LOOT_NAME_PARTS[slot];
  const prefix = parts.prefixes[Math.floor(Math.random() * parts.prefixes.length)];
  const noun = parts.nouns[Math.floor(Math.random() * parts.nouns.length)];
  return `${prefix} ${noun}`;
}

function slotIcon(slot) {
  return slot === 'weapon' ? '⚔️' : (slot === 'armor' ? '🛡️' : '💍');
}

/**
 * Generate a single procedural loot item.
 * @param {number} avgLevel - average level of bots currently in the arena (clamped 1-60)
 * @param {string|null} forClassName - if provided, item is restricted to that class;
 *   if null, item is usable by 'all' (a generic world-drop trinket-style item)
 */
function generateLootItem(avgLevel, forClassName) {
  const level = Math.max(1, Math.min(60, Math.round(avgLevel || 1)));
  const rarity = rollRarity();
  const tierInfo = RARITY_TIERS[rarity];
  const slot = forClassName ? rollSlot() : 'trinket';

  // Total stat "budget" scales with level and rarity multiplier.
  // Baseline is tuned so a level-1 common item feels roughly like the
  // weakest tier-1 shop item, and a level-60 legendary dwarfs tier-3 shop gear.
  const levelMult = 1 + (level - 1) * 0.045;
  const budget = 38 * levelMult * tierInfo.statBudgetMult;

  const [minStats, maxStats] = tierInfo.statCount;
  const numStats = minStats + Math.floor(Math.random() * (maxStats - minStats + 1));

  // Pick distinct stats weighted by pool weight, biased toward the
  // recipient class's strengths when a class is known.
  const pool = LOOT_STAT_POOL.map(s => ({ ...s }));
  if (forClassName && CLASSES[forClassName]) {
    const base = CLASSES[forClassName].baseStats;
    if (base.spellPower > base.attackPower) {
      pool.find(s => s.key === 'spellPower').weight += 4;
    } else {
      pool.find(s => s.key === 'attackPower').weight += 4;
    }
  }

  const chosen = [];
  const poolCopy = [...pool];
  for (let i = 0; i < numStats && poolCopy.length > 0; i++) {
    const pick = pickWeighted(poolCopy, s => s.weight);
    chosen.push(pick);
    const idx = poolCopy.indexOf(pick);
    poolCopy.splice(idx, 1);
  }

  // Split the budget across chosen stats with some randomness, then
  // convert "budget points" into actual stat values via perPointValue.
  const weights = chosen.map(() => 0.5 + Math.random());
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const stats = {};
  chosen.forEach((statDef, i) => {
    const points = budget * (weights[i] / weightSum);
    let value = points * statDef.perPointValue;
    if (['attackPower', 'spellPower', 'hp', 'armor', 'mana'].includes(statDef.key)) {
      value = Math.max(1, Math.round(value));
    } else {
      // critChance / dodgeChance / speed are small decimals
      value = Math.round(value * 1000) / 1000;
      if (value <= 0) value = statDef.key === 'speed' ? 0.02 : 0.01;
    }
    stats[statDef.key] = value;
  });

  const name = buildName(slot, rarity);
  return {
    id: 'loot-' + uuidv4(),
    name,
    icon: slotIcon(slot),
    category: slot,
    rarity,
    rarityLabel: tierInfo.label,
    rarityColor: tierInfo.color,
    classes: forClassName ? [forClassName] : ['all'],
    level,
    stats,
    isLoot: true
  };
}

module.exports = { generateLootItem };
