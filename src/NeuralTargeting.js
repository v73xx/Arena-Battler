'use strict';
/* ============================================================
   NEURAL TARGETING — a small feedforward neural network that
   scores candidate targets for each bot every AI decision tick.

   HONEST NOTE ON WHAT THIS IS: this is a genuine FFNN — a real
   forward pass through weighted layers with nonlinear activations
   (8 inputs -> 6-neuron ReLU hidden layer -> 1 linear output per
   candidate). What it is NOT is a network trained via backprop on
   match data; there's no training corpus or offline training loop
   in this project. The weight matrices below are hand-authored to
   encode sensible arena heuristics (finish off low-HP targets,
   prioritize dangerous glass cannons, don't waste time on immune
   targets, keep some target stickiness, leave room for randomness).
   That's the practical, honest version of "neural network for
   attack logic" without a training pipeline — the architecture and
   inference are real; the weights are designed, not learned.

   Scores are turned into a target *choice* via temperature-based
   softmax sampling (not argmax), so two fights with the same
   starting conditions won't always play out identically — directly
   addressing "it repeated exactly the same way every round."
   ============================================================ */

// ── Hand-authored weight matrices ──────────────────────────
// Layer 1: 8 inputs -> 6 hidden neurons (ReLU)
const W1 = [
  // missingHpFrac, threatScore, distNorm, inRange, isCCdOrImmune, isCurrentTarget, lowestHpAmongAll, jitter
  [ 1.6, 0.4, 0.3, 0.2, -2.0,  0.5,  0.9, 0.3],  // neuron 0: "easy kill" detector
  [ 0.2, 1.7, 0.1, 0.1, -1.2,  0.1,  0.2, 0.2],  // neuron 1: "dangerous glass cannon" detector
  [-0.3,-0.2, 1.4, 0.6,  0.0, -0.1, -0.2, 0.1],  // neuron 2: "in striking range" detector
  [ 0.1, 0.1, 0.1, 0.1, -3.0,  0.1,  0.1, 0.0],  // neuron 3: hard veto on CC'd/immune targets
  [ 0.6, 0.3,-0.2, 0.1,  0.0,  1.5,  0.4, 0.2],  // neuron 4: "stick with current target" momentum
  [ 0.9, 0.9, 0.5, 0.3, -1.5,  0.3,  1.1, 0.4]   // neuron 5: overall aggregate desirability
];
const B1 = [0.05, -0.1, 0.0, 0.0, 0.0, -0.2];

// Layer 2: 6 hidden -> 1 output (linear)
const W2 = [1.1, 0.9, 0.5, 1.3, 0.5, 1.0];
const B2 = 0.0;

function relu(x) { return x > 0 ? x : 0; }

function forward(inputs) {
  const hidden = new Array(6);
  for (let h = 0; h < 6; h++) {
    let sum = B1[h];
    for (let i = 0; i < inputs.length; i++) sum += W1[h][i] * inputs[i];
    hidden[h] = relu(sum);
  }
  let out = B2;
  for (let h = 0; h < 6; h++) out += W2[h] * hidden[h];
  return out;
}

/**
 * Score and select a target for `bot` among `candidates` (array of enemy Bot
 * instances, already filtered to alive). Returns the chosen Bot, or null.
 *
 * @param {object} bot - the acting bot
 * @param {object[]} candidates - alive enemy bots
 * @param {function} distFn - (a,b) => distance
 * @param {object} options - { maxRange, temperature }
 */
function selectTarget(bot, candidates, distFn, options = {}) {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const temperature = options.temperature ?? 0.45;
  const lowestHpFrac = Math.min(...candidates.map(c => c.hp / Math.max(1, c.maxHp)));

  const scored = candidates.map(c => {
    const hpFrac = c.hp / Math.max(1, c.maxHp);
    const missingHpFrac = 1 - hpFrac;
    const threatScore = Math.min(1, (c.attackPower + c.spellPower) / 420);
    const dist = distFn(bot, c);
    const distNorm = Math.max(0, 1 - dist / 520);
    const inRange = (options.maxRange && dist <= options.maxRange) ? 1 : 0;
    const isCCdOrImmune = (c.isImmune && c.isImmune()) || c.state === 'stunned' || c.state === 'feared' ? 1 : 0;
    const isCurrentTarget = bot.targetId === c.id ? 1 : 0;
    const isLowestHp = hpFrac <= lowestHpFrac + 0.001 ? 1 : 0;
    const jitter = Math.random() * 0.6 - 0.3;

    const score = forward([missingHpFrac, threatScore, distNorm, inRange, isCCdOrImmune, isCurrentTarget, isLowestHp, jitter]);
    return { bot: c, score };
  });

  // Temperature-scaled softmax sampling over scores — smarter on average
  // than pure-random, but not perfectly deterministic like pure-argmax.
  const maxScore = Math.max(...scored.map(s => s.score));
  const weights = scored.map(s => Math.exp((s.score - maxScore) / Math.max(0.05, temperature)));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let roll = Math.random() * totalWeight;
  for (let i = 0; i < scored.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return scored[i].bot;
  }
  return scored[scored.length - 1].bot;
}

module.exports = { selectTarget, forward };
