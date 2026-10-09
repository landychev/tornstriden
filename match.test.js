import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USAGE } from './matchregler.js';
import { newMatch, process, playerView, allowedActions, audit, PHASE, ACTION, STATUS, END } from './match.js';

/* Förutbestämd lek: korten i `top` hamnar överst i draghögen i angiven ordning,
   så att växelvis utdelning ger A och B bestämda händer (referensmatchen nedan). */
const fixedDeck = top => list => {
  const pool = [...list];
  const ordered = top.map(cardId => {
    const index = pool.findIndex(card => card.cardId === cardId);
    if (index === -1) throw new Error(`Kortet ${cardId} finns inte kvar i leken.`);
    return pool.splice(index, 1)[0];
  });
  return [...ordered, ...pool];
};
const interleave = (a, b) => a.flatMap((card, i) => [card, b[i]]);
const A_HAND = ['katapult', 'belagringstorn', 'drakeld', 'skoldmur', 'jarnport', 'spejare', 'armborst', 'bagskytt', 'eldklot', 'livvakt'];
const B_HAND = ['palissad', 'tornvakt', 'stormning', 'armborst', 'skoldmur', 'bagskytt', 'runskold', 'barriar', 'eldklot', 'riddare'];
const firstA = () => 0.1; // lotten ger A

const hand = (match, id) => match.players.find(p => p.id === id).hand;
const handCards = (match, id) => hand(match, id).map(i => match.instances[i]);
const life = (match, id) => match.players.find(p => p.id === id).life;
const inHand = (match, id, cardId) => hand(match, id).find(i => match.instances[i] === cardId);
const counts = m => ({ life: `${life(m, 'A')}/${life(m, 'B')}`, hands: `${hand(m, 'A').length}/${hand(m, 'B').length}`, piles: `${m.drawPile.length}/${m.discardPile.length}` });

/* Hjälpare som skickar en handling med aktuell revision och installerar resultatet. */
function play(match, type, extra = {}, random = firstA) {
  const reply = process(match, { matchId: match.id, revision: match.revision, type, ...extra }, random);
  assert.equal(reply.status, STATUS.ok, `${type}: ${reply.message}`);
  return reply.match;
}
function keepHands(match) {
  for (const id of ['A', 'B', 'A', 'B']) match = play(match, ACTION.swap, { playerId: id, cards: [] });
  return match;
}
function startReference() {
  return newMatch({ matchId: 'ref', shuffleFn: fixedDeck(interleave(A_HAND, B_HAND)), random: firstA });
}
const attack = (m, cardId, usage) => play(m, ACTION.attack, { playerId: m.activePlayer, card: inHand(m, m.activePlayer, cardId), usage });
const defend = (m, cardId) => play(m, ACTION.defend, { playerId: m.activePlayer, card: inHand(m, m.activePlayer, cardId) });

test('Ny match: 50 exemplar, tio kort och tre liv var, KORTBYTE med A aktiv', () => {
  const m = newMatch({ matchId: 'ny' });
  assert.equal(m.deckSize, 50);
  assert.equal(Object.keys(m.instances).length, 50);
  assert.deepEqual([m.phase, m.activePlayer, m.swapRound, m.revision], [PHASE.swap, 'A', 1, 0]);
  assert.deepEqual(counts(m), { life: '3/3', hands: '10/10', piles: '30/0' });
  assert.deepEqual([m.rulesVersion, m.deckVersion], ['duell-v1', 'duell-50-v1']);
  audit(m);
});
test('Referensmatch från utdelning till vinst, rad för rad (duell-50-v1)', () => {
  let m = startReference();
  assert.deepEqual(handCards(m, 'A'), A_HAND);
  assert.deepEqual(handCards(m, 'B'), B_HAND);
  m = keepHands(m);
  assert.deepEqual([m.phase, m.activePlayer, m.attacker], [PHASE.attack, 'A', 'A']);
  assert.deepEqual(counts(m), { life: '3/3', hands: '10/10', piles: '30/0' });

  m = attack(m, 'katapult');
  assert.deepEqual([m.phase, m.activePlayer], [PHASE.defence, 'B']);
  assert.equal(m.instances[m.battle.attackInstance], 'katapult');
  assert.equal(hand(m, 'A').length, 9);
  m = defend(m, 'palissad');
  assert.deepEqual([m.phase, counts(m)], [PHASE.result, { life: '3/2', hands: '9/9', piles: '30/2' }]);
  assert.equal(m.lastResult.defended, false);

  m = play(m, ACTION.next);
  assert.deepEqual([m.phase, m.activePlayer, counts(m)], [PHASE.attack, 'B', { life: '3/2', hands: '9/9', piles: '30/2' }]);
  m = defend(attack(m, 'stormning'), 'skoldmur');
  assert.deepEqual([m.phase, m.lastResult.defended, counts(m)], [PHASE.result, true, { life: '3/2', hands: '8/8', piles: '30/4' }]);

  m = play(m, ACTION.next);
  assert.equal(m.activePlayer, 'A');
  m = defend(attack(m, 'belagringstorn'), 'tornvakt');
  assert.deepEqual(counts(m), { life: '3/1', hands: '7/7', piles: '30/6' });

  m = play(m, ACTION.next);
  assert.equal(m.activePlayer, 'B');
  m = defend(attack(m, 'armborst'), 'jarnport');
  assert.deepEqual([m.lastResult.defended, counts(m)], [true, { life: '3/1', hands: '6/6', piles: '30/8' }]);

  m = play(m, ACTION.next);
  assert.equal(m.activePlayer, 'A');
  m = defend(attack(m, 'drakeld'), 'skoldmur');
  assert.deepEqual([m.lastResult.attackStrength, m.lastResult.defenceStrength], [6, 3]);
  assert.deepEqual([m.phase, m.winner, m.endReason, m.activePlayer], [PHASE.over, 'A', END.fallen, null]);
  assert.deepEqual(counts(m), { life: '3/0', hands: '5/0', piles: '30/15' });
  assert.deepEqual(handCards(m, 'A'), ['spejare', 'armborst', 'bagskytt', 'eldklot', 'livvakt']);
  assert.equal(allowedActions(m, 'A').length, 0, 'ingen Fortsätt eller påfyllning efter segern');
  assert.equal(process(m, { matchId: m.id, revision: m.revision, type: ACTION.next }).status, STATUS.rejected);
  audit(m);
});
test('Startbyten: högst två kort per omgång, undanlagda kort kommer inte tillbaka, tio kort var efteråt', () => {
  let m = newMatch({ matchId: 'byte', random: firstA });
  const away = hand(m, 'A').slice(0, 2);
  assert.equal(process(m, { matchId: m.id, revision: 0, type: ACTION.swap, playerId: 'A', cards: hand(m, 'A').slice(0, 3) }).status, STATUS.rejected);
  assert.equal(process(m, { matchId: m.id, revision: 0, type: ACTION.swap, playerId: 'B', cards: [] }).message, 'Det är inte din tur.');
  m = play(m, ACTION.swap, { playerId: 'A', cards: away });
  assert.deepEqual([m.activePlayer, m.swapRound, m.setAside], ['B', 1, away]);
  assert.equal(hand(m, 'A').length, 10);
  assert.ok(away.every(id => !hand(m, 'A').includes(id)));
  m = play(m, ACTION.swap, { playerId: 'B', cards: hand(m, 'B').slice(0, 2) });
  assert.deepEqual([m.activePlayer, m.swapRound], ['A', 2]);
  const again = hand(m, 'A').slice(0, 2);
  m = play(m, ACTION.swap, { playerId: 'A', cards: again });
  assert.equal(m.setAside.length, 6);
  assert.ok(m.setAside.every(id => !hand(m, 'A').includes(id) && !hand(m, 'B').includes(id)), 'undanlagda kort får inte komma tillbaka under bytena');
  m = play(m, ACTION.swap, { playerId: 'B', cards: hand(m, 'B').slice(0, 2) });
  assert.deepEqual([m.phase, m.setAside.length, m.drawPile.length, m.discardPile.length], [PHASE.attack, 0, 30, 0]);
  assert.deepEqual([hand(m, 'A').length, hand(m, 'B').length], [10, 10]);
  assert.equal(process(m, { matchId: m.id, revision: m.revision, type: ACTION.swap, playerId: 'A', cards: [] }).status, STATUS.rejected);
});
test('Lotten kan ge B första anfallet', () => {
  const m = keepHandsWith(newMatch({ matchId: 'lott', random: () => 0.9 }), () => 0.9);
  assert.deepEqual([m.phase, m.attacker, m.activePlayer], [PHASE.attack, 'B', 'B']);
});
function keepHandsWith(match, random) {
  for (const id of ['A', 'B', 'A', 'B']) match = play(match, ACTION.swap, { playerId: id, cards: [] }, random);
  return match;
}
test('Spel av ett av två likadana kort lämnar det andra kvar', () => {
  let m = keepHands(newMatch({ matchId: 'dubbel', shuffleFn: fixedDeck(interleave(['stormning', 'stormning', ...A_HAND.slice(2)], ['ryttaranfall', ...B_HAND.slice(1).filter(c => c !== 'stormning'), 'vallgrav'])), random: firstA }));
  const both = hand(m, 'A').filter(i => m.instances[i] === 'stormning');
  assert.equal(both.length, 2);
  m = play(m, ACTION.attack, { playerId: 'A', card: both[1] });
  assert.ok(hand(m, 'A').includes(both[0]) && !hand(m, 'A').includes(both[1]));
  assert.equal(m.battle.attackInstance, both[1]);
});
test('Enkel attack: magiskt kort blir attack 1 utan magi; Barriär stoppar, Försegling inte', () => {
  let m = keepHands(startReference());
  const rejected = process(m, { matchId: m.id, revision: m.revision, type: ACTION.attack, playerId: 'A', card: inHand(m, 'A', 'skoldmur') });
  assert.equal(rejected.status, STATUS.rejected);
  assert.match(rejected.message, /enkel attack/);
  m = attack(m, 'skoldmur', USAGE.simple);
  assert.deepEqual(playerView(m, 'B').battle.attack, { cardId: 'skoldmur', usage: USAGE.simple });
  m = defend(m, 'barriar');
  assert.deepEqual([m.lastResult.stopped, m.lastResult.defended, m.lastResult.attack.name], [true, true, 'Sköldmur (enkel attack)']);
  assert.equal(life(m, 'B'), 3);

  let n = keepHands(newMatch({ matchId: 'enkel2', shuffleFn: fixedDeck(interleave(['eldklot', ...A_HAND.slice(1).filter(c => c !== 'eldklot'), 'vallgrav'], ['forsegling', ...B_HAND.slice(1)])), random: firstA }));
  n = defend(attack(n, 'eldklot', USAGE.simple), 'forsegling');
  assert.deepEqual([n.lastResult.stopped, n.lastResult.attackStrength, n.lastResult.defenceStrength, n.lastResult.defended], [false, 1, 2, true]);
});
test('Avstå försvar: handen oförändrad, skadan räknas av resolve', () => {
  let m = keepHands(startReference());
  m = attack(m, 'katapult');
  const before = [...hand(m, 'B')];
  m = play(m, ACTION.pass, { playerId: 'B' });
  assert.deepEqual(hand(m, 'B'), before);
  assert.deepEqual([life(m, 'B'), m.lastResult.defence, m.phase], [2, null, PHASE.result]);
});
test('Ogiltigt kort förbrukas inte: attackkort som försvar avvisas och matchen är orörd', () => {
  let m = attack(keepHands(startReference()), 'katapult');
  const snapshot = JSON.stringify(m);
  const reply = process(m, { matchId: m.id, revision: m.revision, type: ACTION.defend, playerId: 'B', card: inHand(m, 'B', 'stormning') });
  assert.equal(reply.status, STATUS.rejected);
  assert.equal(reply.match, m);
  assert.equal(JSON.stringify(m), snapshot);
  assert.equal(process(m, { matchId: m.id, revision: m.revision, type: ACTION.defend, playerId: 'B', card: 'ref:kort:999' }).message, 'Kortet finns inte på din hand.');
});
test('Gammal revision, fel match-ID och dubbla handlingar avvisas utan extra skada', () => {
  let m = attack(keepHands(startReference()), 'katapult');
  const action = { matchId: m.id, revision: m.revision, type: ACTION.pass, playerId: 'B' };
  const first = process(m, action);
  assert.equal(first.status, STATUS.ok);
  const second = process(first.match, action);
  assert.equal(second.status, STATUS.rejected);
  assert.equal(second.match, first.match);
  assert.equal(life(first.match, 'B'), 2);
  assert.equal(process(m, { ...action, matchId: 'annan' }).status, STATUS.rejected);
  assert.equal(process(m, { ...action, type: 'DANSA' }).status, STATUS.rejected);
});
test('Törnesköld fäller anfallaren på ett liv och försvararen vinner', () => {
  let m = keepHands(newMatch({ matchId: 'torne', shuffleFn: fixedDeck(interleave(['spejare', 'stormning', 'katapult', ...A_HAND.slice(3)], ['torneskold', 'palissad', 'tornvakt', ...B_HAND.slice(3)])), random: firstA }));
  m = play(play(m, ACTION.attack, { playerId: 'A', card: inHand(m, 'A', 'spejare') }), ACTION.pass, { playerId: 'B' }); // 3/2
  m = play(m, ACTION.next);
  m = play(play(m, ACTION.attack, { playerId: 'B', card: inHand(m, 'B', 'palissad'), usage: USAGE.simple }), ACTION.pass, { playerId: 'A' }); // 2/2
  m = play(m, ACTION.next);
  m = play(play(m, ACTION.attack, { playerId: 'A', card: inHand(m, 'A', 'stormning') }), ACTION.pass, { playerId: 'B' }); // 2/1
  m = play(m, ACTION.next);
  m = play(play(m, ACTION.attack, { playerId: 'B', card: inHand(m, 'B', 'tornvakt'), usage: USAGE.simple }), ACTION.pass, { playerId: 'A' }); // 1/1
  m = play(m, ACTION.next);
  assert.deepEqual([life(m, 'A'), life(m, 'B'), m.activePlayer], [1, 1, 'A']);
  m = defend(attack(m, 'katapult'), 'torneskold'); // 5 mot 3: träff, ingen motstöt
  assert.deepEqual([life(m, 'A'), life(m, 'B'), m.phase, m.winner], [1, 0, PHASE.over, 'A']);

  let n = newMatch({ matchId: 'torne2', shuffleFn: fixedDeck(interleave(['spejare', ...A_HAND.slice(1)], ['torneskold', ...B_HAND.slice(1)])), random: firstA });
  n.players[0].life = 1; // anfallaren på sitt sista liv, satt innan striden börjar
  n = keepHands(n);
  assert.equal(n.battle.startLife.A, 1);
  n = defend(attack(n, 'spejare'), 'torneskold'); // 1 mot 3: motstöt
  assert.deepEqual([life(n, 'A'), life(n, 'B'), n.phase, n.winner, n.endReason], [0, 3, PHASE.over, 'B', END.fallen]);
  assert.equal(hand(n, 'A').length, 0, 'den fallnes hand slängs');
  assert.equal(n.discardPile.length, 2 + 9);
});
test('Tom hand fylls med fem kort efter striden; slänghögen blandas när draghögen tar slut', () => {
  let m = keepHands(startReference());
  // Töm A:s hand genom att flytta nio kort till slänghögen i testet (utanför motorn) och lämna Katapult.
  const keep = inHand(m, 'A', 'katapult');
  for (const id of hand(m, 'A').filter(i => i !== keep)) { m.players[0].hand.splice(m.players[0].hand.indexOf(id), 1); m.discardPile.push(id); }
  audit(m);
  m = play(play(m, ACTION.attack, { playerId: 'A', card: keep }), ACTION.pass, { playerId: 'B' });
  assert.deepEqual([hand(m, 'A').length, m.phase, life(m, 'B')], [0, PHASE.result, 2]);
  const drawBefore = m.drawPile.length;
  m = play(m, ACTION.next);
  assert.deepEqual([hand(m, 'A').length, hand(m, 'B').length, m.drawPile.length], [5, 10, drawBefore - 5]);
  assert.ok(m.log.some(line => line.includes('Södra tornet hade tom hand och drar 5 nya kort')));
  assert.deepEqual([m.phase, m.activePlayer], [PHASE.attack, 'B']);
  audit(m);

  // Tom draghög: flytta hela draghögen till slänghögen och töm B:s hand utom ett kort.
  let n = keepHands(startReference());
  n.discardPile.push(...n.drawPile); n.drawPile = [];
  const keepB = inHand(n, 'B', 'palissad');
  for (const id of hand(n, 'B').filter(i => i !== keepB)) { n.players[1].hand.splice(n.players[1].hand.indexOf(id), 1); n.discardPile.push(id); }
  audit(n);
  n = play(play(n, ACTION.attack, { playerId: 'A', card: inHand(n, 'A', 'spejare') }), ACTION.defend, { playerId: 'B', card: keepB });
  assert.deepEqual([hand(n, 'B').length, n.drawPile.length, n.discardPile.length], [0, 0, 41]);
  n = play(n, ACTION.next);
  assert.ok(n.log.some(line => line.includes('slänghögen blandas')));
  assert.deepEqual([hand(n, 'B').length, n.drawPile.length, n.discardPile.length], [5, 36, 0]);
  assert.equal(n.deckSize, 50);
  audit(n);
});
test('Ge upp: motståndaren vinner direkt, liv och händer oförändrade, inga fler drag', () => {
  let m = attack(keepHands(startReference()), 'katapult');
  const handsBefore = [hand(m, 'A').length, hand(m, 'B').length];
  m = play(m, ACTION.surrender, { playerId: 'A' });
  assert.deepEqual([m.phase, m.winner, m.endReason, m.battle, m.activePlayer], [PHASE.over, 'B', END.surrendered, null, null]);
  assert.deepEqual([life(m, 'A'), life(m, 'B')], [3, 3]);
  assert.deepEqual([hand(m, 'A').length, hand(m, 'B').length], handsBefore);
  assert.equal(m.discardPile.length, 1, 'det spelade attackkortet slängs utan att räknas');
  audit(m);
  assert.equal(process(m, { matchId: m.id, revision: m.revision, type: ACTION.surrender, playerId: 'B' }).status, STATUS.rejected);
  const during = keepHands(startReference());
  assert.equal(process(during, { matchId: during.id, revision: during.revision, type: ACTION.surrender, playerId: 'B' }).status, STATUS.ok, 'tillåtet under motståndarens tur');
});
test('Spelarvyn döljer motståndarens hand och draghögens ordning men visar liv, kortantal och öppet anfall', () => {
  let m = attack(keepHands(startReference()), 'katapult');
  const view = playerView(m, 'B');
  assert.equal(view.me.id, 'B');
  assert.equal(view.me.hand.length, 10);
  assert.deepEqual(view.opponent, { id: 'A', name: 'Södra tornet', life: 3, cardCount: 9 });
  assert.deepEqual(view.battle.attack, { cardId: 'katapult', usage: USAGE.normal });
  assert.equal(view.drawPileSize, 30);
  assert.ok(!('drawPile' in view) && !('instances' in view) && !('players' in view));
  assert.ok(!JSON.stringify(view).includes('belagringstorn'), 'A:s handkort får inte synas i B:s vy');
  const actions = allowedActions(m, 'B');
  assert.deepEqual(actions.map(a => a.type), [ACTION.defend, ACTION.pass, ACTION.surrender]);
  assert.equal(actions[0].cards.length, 7, 'Palissad, Tornvakt, Sköldmur, Bågskytt, Runsköld, Barriär, Riddare');
  assert.deepEqual(allowedActions(m, 'A').map(a => a.type), [ACTION.surrender]);
});
test('Internt fel ger fasen FEL utan delvisa ändringar', () => {
  let m = keepHands(startReference());
  m.deckSize = 49; // framkalla bokföringsfel
  const reply = process(m, { matchId: m.id, revision: m.revision, type: ACTION.attack, playerId: 'A', card: inHand(m, 'A', 'katapult') });
  assert.equal(reply.status, STATUS.error);
  assert.deepEqual([reply.match.phase, reply.match.activePlayer, reply.match.revision], [PHASE.error, null, m.revision + 1]);
  assert.equal(reply.match.players[0].hand.length, 10, 'inget kort flyttades');
  assert.match(reply.match.error, /Kortbokföringen/);
  assert.equal(process(reply.match, { matchId: m.id, revision: reply.match.revision, type: ACTION.next }).status, STATUS.rejected);
});
