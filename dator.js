/* Datormotståndaren. Rena beslutsfunktioner: de läser bara sin
   egen spelarvy (playerView i match.js), kortkatalogen och en beslutsslump.
   De ändrar aldrig matchen och ser aldrig människans hand eller draghögens ordning.
   Hypotetiska strider räknas med samma resolve() som den riktiga striden. */
import { cards } from './kort.js';
import { resolve } from './strid.js';
import { USAGE, battleCard, canAttack, canDefend } from './matchregler.js';
import { PHASE, ACTION } from './match.js';

/* Strategins prioriteringar. De styr datorns val, inte spelreglerna. */
export const STRATEGY = Object.freeze({
  version: 'dator-v1',
  weights: Object.freeze({ win: 10000, loss: -10000, ownLife: 100, opponentDamage: 80, flexible: 2, ability: 2, barrier: 5 }),
  targetAttackCards: 3,      // startbyten: minst så här många naturliga anfall ...
  targetDefenceCards: 3,     // ... och försvarsmöjligheter i starthanden
  scenarios: Object.freeze(['skoldmur', 'runskold', 'barriar']),  // försvarsexempel vid anfall, utöver inget försvar
  valueNewHand: false,       // senare förbättring: värdera att sista kortet ger en ny hand
  newHandBonus: 10
});

export const STRATEGIES = Object.freeze({ smart: 'smart', random: 'random' });
export class DecisionError extends Error {}

const DECISION_PHASES = [PHASE.swap, PHASE.attack, PHASE.defence];
const cardType = id => cards.find(card => card.id === id);
const isAttackCard = type => Boolean(type.attack);
const isDefenceCard = type => canDefend(type);

/* ---- Giltiga val från spelarvyn (ingen dold information) ---- */
export function choicesFor(view) {
  if (view.activePlayer !== view.me.id) return [];
  const hand = view.me.hand;
  if (view.phase === PHASE.swap) {
    const choices = [{ type: ACTION.swap, cards: [] }];
    const max = view.rules.maxCardsPerSwap;
    const grow = (start, picked) => {
      for (let i = start; i < hand.length; i++) {
        const next = [...picked, hand[i].instanceId];
        choices.push({ type: ACTION.swap, cards: next });
        if (next.length < max) grow(i + 1, next);
      }
    };
    if (max > 0) grow(0, []);
    return choices;
  }
  if (view.phase === PHASE.attack) {
    const choices = [];
    for (const { instanceId, cardId } of hand) {
      if (canAttack(cardType(cardId))) choices.push({ type: ACTION.attack, card: instanceId, usage: USAGE.normal });
      if (view.rules.simpleAttack) choices.push({ type: ACTION.attack, card: instanceId, usage: USAGE.simple });
    }
    return choices;
  }
  if (view.phase === PHASE.defence) {
    return [{ type: ACTION.pass }, ...hand.filter(({ cardId }) => isDefenceCard(cardType(cardId))).map(({ instanceId }) => ({ type: ACTION.defend, card: instanceId }))];
  }
  return [];
}

export const packAction = (choice, view) => ({ matchId: view.matchId, revision: view.revision, playerId: view.me.id, ...choice });

/* ---- Värdering ---- */
export function keepValue(type, weights = STRATEGY.weights) {
  let value = Math.max(type.attack ?? 0, type.defence ?? 0);
  if (type.attack && type.defence) value += weights.flexible;
  if (type.ability) value += weights.ability;
  if (type.cancel) value += weights.barrier;
  return value;
}

export function outcomeUtility(result, role, view, weights = STRATEGY.weights) {
  const own = role === 'attacker' ? result.attackerLife : result.defenderLife;
  const opponent = role === 'attacker' ? result.defenderLife : result.attackerLife;
  if (own === 0) return weights.loss;
  if (opponent === 0) return weights.win;
  return weights.ownLife * (own - view.me.life) + weights.opponentDamage * (view.opponent.life - opponent);
}

export function refillBonus(view, choice, result, strategy = STRATEGY) {
  if (!strategy.valueNewHand) return 0;
  if (![PHASE.attack, PHASE.defence].includes(view.phase)) return 0;
  if (choice.type === ACTION.pass) return 0;
  if (view.me.hand.length !== 1) return 0;
  if (result.attackerLife === 0 || result.defenderLife === 0) return 0;
  if (!(view.rules.refillCards > 0)) return 0;
  return strategy.newHandBonus;
}

/* Högsta poäng; slumpa endast mellan exakt likvärdiga val. */
function best(scored, random) {
  const top = Math.max(...scored.map(s => s.score));
  const ties = scored.filter(s => s.score === top);
  return ties[Math.floor(random() * ties.length)];
}
const cardOf = (view, instanceId) => cardType(view.me.hand.find(c => c.instanceId === instanceId).cardId);
const mean = list => list.reduce((sum, n) => sum + n, 0) / list.length;

/* ---- Strategier per fas ---- */
export function chooseRandom(view, choices, random = Math.random) {
  if (!DECISION_PHASES.includes(view.phase) || view.activePlayer !== view.me.id) return null;
  if (!choices.length) throw new DecisionError('Inga giltiga val i datorns aktiva fas.');
  return { choice: choices[Math.floor(random() * choices.length)], reason: 'slumpmässigt giltigt drag' };
}

export function chooseSwap(view, choices, random = Math.random, strategy = STRATEGY) {
  const types = view.me.hand.map(c => cardType(c.cardId));
  const attacks = types.filter(isAttackCard).length;
  const defences = types.filter(isDefenceCard).length;
  const { targetAttackCards: tA, targetDefenceCards: tD } = strategy;
  const keep = { choice: choices.find(c => c.cards.length === 0), reason: `behåller handen: ${attacks} anfall och ${defences} försvar räcker mot målet ${tA}/${tD}` };
  if (attacks >= tA && defences >= tD) return keep;
  const candidates = choices.filter(choice => {
    const removed = choice.cards.map(id => cardOf(view, id));
    const removedAttacks = removed.filter(isAttackCard).length;
    const removedDefences = removed.filter(isDefenceCard).length;
    if (attacks < tA && removedAttacks) return false;
    if (defences < tD && removedDefences) return false;
    if (attacks >= tA && attacks - removedAttacks < tA) return false;
    if (defences >= tD && defences - removedDefences < tD) return false;
    return true;
  });
  const scored = candidates.map(choice => ({ choice, score: choice.cards.length * 1000 - choice.cards.map(id => keepValue(cardOf(view, id), strategy.weights)).reduce((a, b) => a + b, 0) }));
  const pick = best(scored, random);
  const n = pick.choice.cards.length;
  return { choice: pick.choice, reason: n ? `byter ${n} kort: handen har ${attacks} anfall och ${defences} försvar, målet är ${tA}/${tD}` : `behåller handen: inget byte förbättrar ${attacks} anfall och ${defences} försvar utan att offra det som behövs` };
}

export function chooseAttack(view, choices, random = Math.random, strategy = STRATEGY) {
  const scenarios = view.opponent.cardCount === 0 ? [null] : [null, ...strategy.scenarios.map(cardType)];
  const scored = choices.map(choice => {
    const type = cardOf(view, choice.card);
    const attacker = battleCard(type.id, choice.usage);
    const results = scenarios.map(defender => resolve({ attacker, defender, attackerLife: view.me.life, defenderLife: view.opponent.life }));
    const utilities = results.map(result => outcomeUtility(result, 'attacker', view, strategy.weights) + refillBonus(view, choice, result, strategy));
    // Den verkliga attackstyrkan (efter bonusar) är bara en skiljare när exemplen ger exakt samma nytta, t.ex. Armborst 2 före enkel attack 1.
    const strength = mean(results.map(result => result.attack)) / 100;
    return { choice, type, usage: choice.usage, average: mean(utilities), score: mean(utilities) - keepValue(type, strategy.weights) + strength };
  });
  const pick = best(scored, random);
  return { choice: pick.choice, reason: `anfaller med ${pick.type.name}${pick.usage === USAGE.simple ? ' som enkel attack 1' : ''}: medelnytta ${pick.average.toFixed(0)} mot ${scenarios.length} försvarsexempel, sparvärde ${keepValue(pick.type)}` };
}

export function chooseDefence(view, choices, random = Math.random, strategy = STRATEGY) {
  const open = view.battle?.attack;
  if (!open) throw new DecisionError('Inget öppet anfall att försvara mot.');
  const attacker = battleCard(open.cardId, open.usage);
  const lives = { attackerLife: view.battle.startLife[view.opponent.id], defenderLife: view.battle.startLife[view.me.id] };
  const scored = choices.map(choice => {
    const type = choice.type === ACTION.pass ? null : cardOf(view, choice.card);
    const result = resolve({ attacker, defender: type ? battleCard(type.id) : null, ...lives });
    const cost = type ? keepValue(type, strategy.weights) : 0;
    return { choice, type, result, score: outcomeUtility(result, 'defender', view, strategy.weights) - cost + refillBonus(view, choice, result, strategy) };
  });
  const pick = best(scored, random);
  const r = pick.result;
  return { choice: pick.choice, reason: pick.type ? `försvarar med ${pick.type.name}: ${r.defended ? 'anfallet stoppas' : 'försvaret håller inte'} (${r.attack} mot ${r.defence})` : `avstår försvar: ${r.attack} i attack, inget eget kort ändrar utfallet tillräckligt` };
}

/* Datorns beslut för aktuell vy. Returnerar { choice, reason } eller null när det inte är datorns tur. */
export function decide(view, { strategy = STRATEGIES.smart, random = Math.random, config = STRATEGY } = {}) {
  if (!DECISION_PHASES.includes(view.phase) || view.activePlayer !== view.me.id) return null;
  const choices = choicesFor(view);
  if (strategy === STRATEGIES.random) return chooseRandom(view, choices, random);
  if (!choices.length) throw new DecisionError('Inga giltiga val i datorns aktiva fas.');
  if (view.phase === PHASE.swap) return chooseSwap(view, choices, random, config);
  if (view.phase === PHASE.attack) return chooseAttack(view, choices, random, config);
  return chooseDefence(view, choices, random, config);
}
