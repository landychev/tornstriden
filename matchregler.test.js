import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cards, MAX_LIFE } from './kort.js';
import { resolve } from './strid.js';
import { rules, deck, USAGE, MIN_DECK_SIZE, RULES_VERSION, DECK_VERSION, validateDeck, buildDeck, shuffle, battleCard, canAttack, canDefend } from './matchregler.js';
const card = id => cards.find(item => item.id === id);
const fight = (attacker, defenderId, attackerLife = 3, defenderLife = 3) => resolve({ attacker, defender: defenderId ? card(defenderId) : null, attackerLife, defenderLife });

test('Regelversionen är låst och följer SPELREGLER.md avsnitt 13', () => {
  assert.equal(RULES_VERSION, 'duell-v1');
  assert.equal(rules.version, RULES_VERSION);
  assert.ok(!RULES_VERSION.includes('utkast') && !DECK_VERSION.includes('utkast'));
  assert.deepEqual([rules.players, rules.startLife, rules.maxLife, rules.startCards], [2, 3, MAX_LIFE, 10]);
  assert.deepEqual([rules.swapRounds, rules.maxCardsPerSwap, rules.refillCards], [2, 2, 5]);
  assert.equal(rules.simpleAttack, true);
  assert.equal(rules.simpleAttackStrength, 1);
  assert.equal(rules.surrender, true);
  assert.equal(MIN_DECK_SIZE, 28);
});
test('Kortleken duell-50-v1: 30 kända kort-ID, 2 av varje vanligt kort, 1 av varje specialkort, summa 50', () => {
  assert.equal(DECK_VERSION, 'duell-50-v1');
  assert.equal(deck.version, DECK_VERSION);
  const ids = Object.keys(deck.copies);
  assert.equal(ids.length, 30);
  for (const id of ids) {
    assert.ok(card(id), `okänt kort i leken: ${id}`);
    assert.equal(deck.copies[id], card(id).ability ? 1 : 2, `${id}: fel antal exemplar`);
  }
  assert.equal(validateDeck(), 50);
  assert.equal(Object.values(deck.copies).reduce((sum, n) => sum + n, 0), 50);
});
test('Valideringen avvisar okända kort, ogiltiga antal och för små lekar', () => {
  assert.throws(() => validateDeck({ ...deck.copies, drakkung: 1 }), /Okänt kort/);
  assert.throws(() => validateDeck({ ...deck.copies, stormning: 0 }), /positivt heltal/);
  assert.throws(() => validateDeck({ ...deck.copies, stormning: 1.5 }), /positivt heltal/);
  assert.throws(() => validateDeck({ stormning: 10, skoldmur: 10 }), /minst 28/);
  assert.equal(validateDeck({ stormning: 14, skoldmur: 14 }), 28);
});
test('buildDeck ger 50 exemplar med unika ID, rätt antal per korttyp och utbytbar slump', () => {
  const built = buildDeck({ matchId: 'm1' });
  assert.equal(built.length, 50);
  assert.equal(new Set(built.map(c => c.id)).size, 50);
  assert.ok(built.every(c => c.id.startsWith('m1:kort:') && Object.isFrozen(c)));
  const perType = {};
  for (const c of built) perType[c.cardId] = (perType[c.cardId] ?? 0) + 1;
  assert.deepEqual(perType, { ...deck.copies });
  assert.equal(built.filter(c => c.cardId === 'stormning').length, 2);
  const ordered = buildDeck({ matchId: 'm2', shuffleFn: list => list });
  assert.deepEqual(ordered.slice(0, 2).map(c => c.cardId), ['stormning', 'stormning']);
  assert.throws(() => buildDeck({ shuffleFn: list => list.slice(1) }), /antalet exemplar/);
  assert.throws(() => buildDeck({ copies: { stormning: 1 } }), /minst 28/);
});
test('shuffle ändrar varken antal eller innehåll och lämnar originalet orört', () => {
  const original = [1, 2, 3, 4, 5, 6, 7, 8];
  const mixed = shuffle(original, () => 0.5);
  assert.equal(mixed.length, original.length);
  assert.deepEqual([...mixed].sort(), [...original].sort());
  assert.deepEqual(original, [1, 2, 3, 4, 5, 6, 7, 8]);
});
test('Enkel attack blir ett tillfälligt vanligt attackkort med styrka 1 utan specialeffekt', () => {
  for (const original of cards) {
    const simple = battleCard(original.id, USAGE.simple);
    assert.equal(simple.attack, 1);
    assert.equal(simple.type, 'attack');
    assert.equal(simple.name, `${original.name} (enkel attack)`);
    assert.ok(!('ability' in simple) && !('cancel' in simple) && !('defence' in simple));
    assert.equal(battleCard(original.id), original, 'vanlig användning returnerar katalogkortet');
    assert.equal(card(original.id), original, 'originalet ändras inte');
  }
  assert.throws(() => battleCard('eldklot', 'dubbel'), /Okänd användning/);
  assert.throws(() => battleCard('drakkung'), /Okänt kort/);
});
test('Barriär stoppar enkel attack; Försegling stoppar den inte och Spegelsköld kopierar den inte', () => {
  const simpleEldklot = battleCard('eldklot', USAGE.simple);
  assert.equal(fight(simpleEldklot, 'barriar').stopped, true);
  const sealed = fight(simpleEldklot, 'forsegling');
  assert.equal(sealed.stopped, false);
  assert.deepEqual([sealed.attack, sealed.defence, sealed.defended], [1, 2, true]);
  const mirrored = fight(simpleEldklot, 'spegelskold');
  assert.deepEqual([mirrored.attack, mirrored.defence, mirrored.defended], [1, 1, true]);
  assert.equal(fight(battleCard('drakeld', USAGE.simple), 'skoldmur').attack, 1, 'ingen Drakeld-bonus vid enkel attack');
  assert.equal(fight(battleCard('sprangladdning', USAGE.simple), 'palissad').defence, 1, 'ingen Sprängladdning-effekt vid enkel attack');
  assert.equal(fight(simpleEldklot, null).defenderLife, 2, 'utan försvar kostar enkel attack ett liv');
});
test('En hand med bara försvarskort kan anfalla med enkel attack', () => {
  const defenceOnly = cards.filter(c => !c.attack);
  assert.ok(defenceOnly.length > 0);
  for (const c of defenceOnly) {
    assert.equal(canAttack(c), false);
    assert.equal(canAttack(c, USAGE.simple), true);
    assert.equal(fight(battleCard(c.id, USAGE.simple), 'palissad').defended, true);
  }
  assert.equal(canDefend(card('barriar')), true);
  assert.equal(canDefend(card('stormning')), false);
  assert.equal(canDefend(card('riddare')), true);
});
test('Regelexempel: lika styrka stoppar, överstyrka kostar ett liv, motstöt kan fälla anfallaren', () => {
  assert.equal(fight(card('stormning'), 'skoldmur').defended, true);           // attack 3 mot försvar 3
  assert.equal(fight(card('belagringstorn'), 'palissad').defenderLife, 2);    // attack 6 mot försvar 1
  assert.equal(fight(card('katapult'), null).defenderLife, 2);                // avstå mot attack 5
  assert.equal(fight(card('murbracka'), null).defenderLife, 2);               // avstå mot attack 4
  const thorns = fight(card('stormning'), 'torneskold', 1, 3);               // anfallare på ett liv mot lyckad Törnesköld
  assert.deepEqual([thorns.defended, thorns.attackerLife, thorns.defenderLife], [true, 0, 3]);
});
