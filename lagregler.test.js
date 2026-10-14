import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cards } from './kort.js';
import { deck as duelDeck, RULES_VERSION, DECK_VERSION, USAGE } from './matchregler.js';
import { TEAM_RULES_VERSION, TEAM_SIZES, teamRules, BASE_COPIES, TEAM_DECKS, teamDeck, minDeckSize, validateTeamDeck, buildTeamDeck, teamBattleCard, teamCanAttack, teamCanDefend } from './lagregler.js';
import { styrdSlump } from './teststod.js';
import { shuffle } from './matchregler.js';

test('Lagregeln är låst och skild från duellens', () => {
  assert.equal(TEAM_RULES_VERSION, 'lag-v1');
  assert.notEqual(TEAM_RULES_VERSION, RULES_VERSION);
  assert.deepEqual(TEAM_SIZES, [4, 6, 8]);
  assert.deepEqual({ ...teamRules, sizes: [...teamRules.sizes] }, { version: 'lag-v1', sizes: [4, 6, 8], maxPerTeam: 4, startLife: 3, maxLife: 3, startCards: 10, swapRounds: 2, maxCardsPerSwap: 2, refillCards: 5, simpleAttack: true, simpleAttackStrength: 1 });
  assert.ok(Object.isFrozen(teamRules) && Object.isFrozen(BASE_COPIES) && Object.isFrozen(TEAM_DECKS[4].copies));
});

test('11A: 30 korttyper, vanliga kort dubbelt så många som specialkort, 100/150/200 kort med egna versioner', () => {
  assert.deepEqual(BASE_COPIES, duelDeck.copies, 'baslistan är en kopia av duellens fördelning vid låsningen');
  assert.equal(DECK_VERSION, 'duell-50-v1', 'duellen behåller sina 50 kort');
  assert.equal(Object.values(duelDeck.copies).reduce((a, b) => a + b, 0), 50);
  const expected = { 4: ['lag-100-v1', 100, 4, 2, 56], 6: ['lag-150-v1', 150, 6, 3, 84], 8: ['lag-200-v1', 200, 8, 4, 112] };
  for (const size of TEAM_SIZES) {
    const d = teamDeck(size);
    const [version, total, normal, special, min] = expected[size];
    assert.equal(d.version, version);
    assert.equal(d.total, total);
    assert.equal(validateTeamDeck(size), total);
    assert.equal(minDeckSize(size), min);
    assert.equal(Object.keys(d.copies).length, 30);
    for (const card of cards) assert.equal(d.copies[card.id], card.ability ? special : normal, `${size}: ${card.id}`);
  }
  assert.throws(() => teamDeck(2), /4, 6 eller 8/);
  assert.throws(() => teamDeck(5), /4, 6 eller 8/);
  assert.throws(() => validateTeamDeck(8, BASE_COPIES), /behöver minst 112/);
  assert.throws(() => validateTeamDeck(4, { ...TEAM_DECKS[4].copies, okant: 1 }), /Okänt kort/);
});

test('buildTeamDeck ger unika exemplar, rätt antal per korttyp och samma ordning med samma slump', () => {
  for (const size of TEAM_SIZES) {
    const shuffleFn = list => shuffle(list, styrdSlump(size));
    const a = buildTeamDeck({ size, matchId: `m${size}`, shuffleFn });
    const b = buildTeamDeck({ size, matchId: `m${size}`, shuffleFn: list => shuffle(list, styrdSlump(size)) });
    assert.equal(a.length, TEAM_DECKS[size].total);
    assert.equal(new Set(a.map(c => c.id)).size, a.length);
    assert.ok(a.every(c => c.id.startsWith(`m${size}:kort:`)));
    assert.deepEqual(a, b);
    const counts = {};
    for (const c of a) counts[c.cardId] = (counts[c.cardId] ?? 0) + 1;
    assert.deepEqual(counts, { ...TEAM_DECKS[size].copies });
  }
});

test('23A: enkel attack blir vanlig attack 1 och tappar magi, specialeffekt, försvar och trumf för alla 30 kort', () => {
  for (const card of cards) {
    const simple = teamBattleCard(card.id, USAGE.simple);
    assert.deepEqual(Object.keys(simple).sort(), ['attack', 'id', 'name', 'type', 'usage']);
    assert.equal(simple.type, 'attack', `${card.id} är inte längre magi/försvar/hybrid`);
    assert.equal(simple.attack, 1);
    assert.equal(simple.usage, USAGE.simple);
    assert.match(simple.name, /\(enkel attack\)$/);
    assert.ok(Object.isFrozen(simple));
    assert.ok(teamCanAttack(card, USAGE.simple), `${card.id} kan alltid anfalla som enkel attack`);
    assert.equal(teamBattleCard(card.id, USAGE.normal), card, 'vanlig användning ger katalogkortet oförändrat');
  }
  const drakeld = teamBattleCard('drakeld', USAGE.simple);
  assert.ok(!('ability' in drakeld) && drakeld.type !== 'magic', 'Drakeld förlorar både magi och +2');
  assert.equal(cards.find(c => c.id === 'drakeld').ability, 'dragon', 'katalogen är orörd');
  assert.throws(() => teamBattleCard('drakeld', 'dubbel'), /Okänd användning/);
  assert.throws(() => teamBattleCard('finns-inte'), /Okänt kort/);
});

test('Vad kort får användas till: försvar har ingen enkel variant, barriär räknas som försvar', () => {
  const byId = id => cards.find(c => c.id === id);
  assert.ok(teamCanAttack(byId('stormning')) && !teamCanDefend(byId('stormning')));
  assert.ok(!teamCanAttack(byId('skoldmur')) && teamCanDefend(byId('skoldmur')));
  assert.ok(teamCanAttack(byId('bagskytt')) && teamCanDefend(byId('bagskytt')));
  assert.ok(teamCanDefend(byId('barriar')) && !teamCanAttack(byId('barriar')));
  assert.ok(teamCanAttack(byId('barriar'), USAGE.simple));
});

test('Granskning L10: storlekskontrollen kan inte kringgås med egna antal kopior och ett ogiltigt deltagarantal', () => {
  const copies = TEAM_DECKS[4].copies;
  for (const size of [undefined, null, 2, 5, 10, '4', NaN]) assert.throws(() => validateTeamDeck(size, copies), /4, 6 eller 8/, String(size));
  assert.throws(() => validateTeamDeck(8, copies), /behöver minst 112/, '100 kort räcker inte till 8 deltagare');
  assert.equal(validateTeamDeck(4, copies), 100);
});
