import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTeamMatch, confirmSwap, refillEmptyHands, playToTable, discardTable, discardTableCardsOf, discardHand, auditTeam, seatOrder, orderFrom, playerOf, isAlive, TEAM_PHASE, ROLE, Avvisning } from './lagkortlek.js';
import { TEAM_DECKS, TEAM_SIZES, USAGE } from './lagregler.js';
import { PLAYER_STATUS } from './kontrakt.js';
import { styrdSlump } from './teststod.js';

/* Rummets ordning: lag A:s spelare först, sedan lag B:s (a1, a2, …, b1, b2, …). */
const spelare = size => [...Array.from({ length: size / 2 }, (_, i) => ({ id: `a${i + 1}`, name: `Anna${i + 1}`, teamId: 'A' })), ...Array.from({ length: size / 2 }, (_, i) => ({ id: `b${i + 1}`, name: `Bo${i + 1}`, teamId: 'B' }))];
const oblandad = list => list;   // leken i byggordning: förutsägbar utdelning
const ny = (size, extra = {}) => newTeamMatch({ matchId: `m${size}`, players: spelare(size), random: styrdSlump(size), ...extra });
const avvisas = (fn, pattern) => assert.throws(fn, error => error instanceof Avvisning && pattern.test(error.message), `väntade avvisning ${pattern}`);
const hand = (m, id) => playerOf(m, id).hand;
function klaraByten(m, random = styrdSlump(99)) {
  while (m.phase === TEAM_PHASE.swap) for (const id of m.seats) if (m.swapsConfirmed[id] < m.swapRound) confirmSwap(m, id, [], random);
  return m;
}

test('Ny lagmatch för 4/6/8: rätt lek, tio kort var, fast lagordning och bordsordning A1, B1, A2, B2 …', () => {
  for (const size of TEAM_SIZES) {
    const m = ny(size, { shuffleFn: oblandad });
    assert.equal(m.rulesVersion, 'lag-v1');
    assert.equal(m.deckVersion, TEAM_DECKS[size].version);
    assert.equal(m.deckSize, TEAM_DECKS[size].total);
    assert.deepEqual(m.teams.A, spelare(size).filter(p => p.teamId === 'A').map(p => p.id));
    const k = size / 2;
    assert.deepEqual(m.seats, Array.from({ length: k }, (_, i) => [`a${i + 1}`, `b${i + 1}`]).flat());
    for (const p of m.players) { assert.equal(p.hand.length, 10); assert.equal(p.life, 3); assert.equal(p.status, PLAYER_STATUS.alive); }
    assert.equal(m.drawPile.length, m.deckSize - 10 * size);
    /* Ett kort i taget runt bordet: plats i får exemplar i+1, i+1+size, … */
    m.seats.forEach((id, i) => assert.deepEqual(hand(m, id), Array.from({ length: 10 }, (_, r) => `m${size}:kort:${i + 1 + r * size}`)));
    assert.equal(m.phase, TEAM_PHASE.swap);
    assert.ok(auditTeam(m));
  }
});

test('Ogiltiga uppställningar avvisas vid start', () => {
  const p = spelare(4);
  assert.throws(() => newTeamMatch({ players: spelare(2) }), /4, 6 eller 8/);
  assert.throws(() => newTeamMatch({ players: [...p, { id: 'c1', teamId: 'A' }] }), /4, 6 eller 8/);
  assert.throws(() => newTeamMatch({ players: p.map((q, i) => ({ ...q, teamId: i < 3 ? 'A' : 'B' })) }), /lika stora.*3 mot 1/);
  assert.throws(() => newTeamMatch({ players: [p[0], p[0], p[2], p[3]] }), /två gånger/);
  assert.throws(() => newTeamMatch({ players: p.map((q, i) => i === 0 ? { ...q, teamId: 'C' } : q) }), /lag A eller B/);
  assert.deepEqual(seatOrder({ A: ['x', 'y'], B: ['z'] }), ['x', 'z', 'y'], 'bordsordningen klarar ojämna lag (efter utslagning)');
});

test('Maximala startbyten för 4/6/8: alla byter två kort i båda omgångarna, varje exemplar finns på exakt ett ställe', () => {
  for (const size of TEAM_SIZES) {
    const m = ny(size);
    const total = m.deckSize;
    const bortbytta = [];
    for (let round = 1; round <= 2; round++) {
      assert.equal(m.swapRound, round);
      /* Vilken ordning som helst inom omgången – här baklänges runt bordet. */
      for (const [i, id] of [...m.seats].reverse().entries()) {
        const valda = hand(m, id).slice(0, 2);
        const { events } = confirmSwap(m, id, valda, styrdSlump(round * 100 + i));
        assert.match(events[0], /byter 2 kort/);
        for (const kort of valda) assert.ok(!hand(m, id).includes(kort), 'bortbytt kort lämnar handen');
        assert.equal(hand(m, id).length, 10);
        bortbytta.push(...valda);
        if (round === 1 && i === 0) avvisas(() => confirmSwap(m, id, []), /redan bekräftat/);   // omgång 2 öppnar först när alla bytt
        assert.ok(auditTeam(m));
      }
      if (round === 1) {
        assert.equal(m.setAside.length, 2 * size);
        for (const p of m.players) for (const kort of bortbytta) assert.ok(!p.hand.includes(kort), 'undanlagda kort delas inte ut i omgång 2');
      }
    }
    assert.equal(m.phase, TEAM_PHASE.swapsDone);
    assert.equal(m.setAside.length, 0);
    assert.equal(bortbytta.length, 4 * size);
    for (const kort of bortbytta) assert.ok(m.drawPile.includes(kort), 'bortbytta kort blandas tillbaka i draghögen');
    assert.equal(m.drawPile.length, total - 10 * size);
    assert.equal(m.deckSize, total);
    avvisas(() => confirmSwap(m, m.seats[0], []), /redan klara/);
  }
});

test('Felaktiga byten avvisas utan att något ändras', () => {
  const m = ny(4);
  const fore = JSON.stringify(m);
  const egen = hand(m, 'a1');
  avvisas(() => confirmSwap(m, 'a1', egen.slice(0, 3)), /högst 2 kort/);
  avvisas(() => confirmSwap(m, 'a1', [egen[0], egen[0]]), /två gånger/);
  avvisas(() => confirmSwap(m, 'a1', [hand(m, 'b1')[0]]), /finns inte på din hand/);
  avvisas(() => confirmSwap(m, 'x9', []), /Okänd spelare/);
  assert.equal(JSON.stringify(m), fore);
});

test('22A: bara levande spelare med helt tom hand får kort, ett per varv runt bordet från startspelaren, upp till fem', () => {
  const m = klaraByten(ny(6));
  /* a2 och b3 får tom hand, b1 får tre kort kvar, a3 slås ut med tom hand. */
  discardHand(m, 'a2'); discardHand(m, 'b3');
  for (const id of hand(m, 'b1').slice(0, 7)) playToTable(m, 'b1', id, { role: ROLE.attack, usage: USAGE.simple });
  discardTable(m);
  discardHand(m, 'a3'); playerOf(m, 'a3').status = PLAYER_STATUS.out;
  assert.equal(hand(m, 'b1').length, 3);
  const topp = m.drawPile.slice(0, 10);
  const { drawn, recipients, events, reshuffles } = refillEmptyHands(m, { startPlayerId: 'b2', refillId: 'strid-1' });
  /* Bordet: a1 b1 a2 b2 a3 b3 → från b2: b2 a3 b3 a1 b1 a2. Tomma och levande: b3, a2. */
  assert.deepEqual(orderFrom(m, 'b2'), ['b2', 'a3', 'b3', 'a1', 'b1', 'a2']);
  assert.deepEqual(recipients, ['b3', 'a2']);
  assert.deepEqual(drawn, { b3: 5, a2: 5 });
  assert.deepEqual(hand(m, 'b3'), [0, 2, 4, 6, 8].map(i => topp[i]), 'b3 får varannat kort med början på det översta');
  assert.deepEqual(hand(m, 'a2'), [1, 3, 5, 7, 9].map(i => topp[i]));
  assert.equal(hand(m, 'b1').length, 3, 'en hand med tre kort fylls inte på');
  assert.equal(hand(m, 'a3').length, 0, 'utslagen spelare får inga kort');
  assert.equal(reshuffles, 0);
  assert.deepEqual(events, ['Bo3 hade tom hand och drar 5 nya kort.', 'Anna2 hade tom hand och drar 5 nya kort.']);
  const igen = refillEmptyHands(m, { startPlayerId: 'b2', refillId: 'strid-1' });
  assert.equal(igen.already, true, 'samma påfyllning sker aldrig två gånger (upprepat Fortsätt, återanslutning)');
  discardHand(m, 'a2');
  assert.equal(refillEmptyHands(m, { startPlayerId: 'b2', refillId: 'strid-1' }).already, true);
  assert.deepEqual(refillEmptyHands(m, { startPlayerId: 'b2', refillId: 'strid-2' }).drawn, { a2: 5 }, 'nästa strids påfyllning går igenom');
});

test('22A: tom draghög blandar bara slänghögen – bordskort och händer blandas aldrig in; mottagarlistan ändras inte', () => {
  const m = klaraByten(ny(4));
  for (const id of ['a1', 'b1']) discardHand(m, id);
  /* Bordet har två kort som inte får blandas in; draghögen har bara tre kort kvar. */
  const pa = playToTable(m, 'a2', hand(m, 'a2')[0], { role: ROLE.attack, usage: USAGE.simple });
  const pb = playToTable(m, 'b2', hand(m, 'b2')[0], { role: ROLE.attack, usage: USAGE.simple });
  while (m.drawPile.length > 3) m.discardPile.push(m.drawPile.pop());
  auditTeam(m);
  const slang = m.discardPile.length;
  const r = refillEmptyHands(m, { startPlayerId: 'a1', refillId: 1, random: styrdSlump(4) });
  assert.equal(r.reshuffles, 1);
  assert.deepEqual(r.drawn, { a1: 5, b1: 5 });
  assert.deepEqual(m.table.map(e => e.instanceId), [pa.instanceId, pb.instanceId], 'bordskorten ligger kvar');
  assert.equal(m.discardPile.length, 0);
  assert.equal(m.drawPile.length, 3 + slang - 10);

  /* Nästan inga kort kvar någonstans: tre kort till två mottagare ger 2 + 1, och utdelningen slutar. */
  const n = klaraByten(ny(4));
  for (const id of ['a2', 'b2']) discardHand(n, id);
  const resten = [...n.drawPile, ...n.discardPile];
  n.drawPile = []; n.discardPile = resten.slice(0, 3);
  for (const id of resten.slice(3)) hand(n, 'a1').push(id);   // allt annat ligger i a1:s hand i provet
  auditTeam(n);
  const s = refillEmptyHands(n, { startPlayerId: 'a2', refillId: 'x', random: styrdSlump(5) });
  assert.deepEqual(s.drawn, { a2: 2, b2: 1 }, 'a2 fick sitt första kort men stod kvar som mottagare');
  assert.equal(s.reshuffles, 1);
  assert.equal(n.drawPile.length + n.discardPile.length, 0);
});

test('Påfyllning kräver ID och sker inte under startbytena', () => {
  const m = ny(4);
  assert.throws(() => refillEmptyHands(m, { startPlayerId: 'a1' }), /behöver ett ID/);
  assert.throws(() => refillEmptyHands(m, { startPlayerId: 'a1', refillId: 1 }), /startbytena/);
  klaraByten(m);
  assert.throws(() => refillEmptyHands(m, { startPlayerId: 'z9', refillId: 1 }), /Okänd startspelare/);
});

test('Bordet: användningen låses med kortet, enkel attack för alla kort, försvar kräver försvarskort', () => {
  const m = klaraByten(ny(4, { shuffleFn: oblandad }));
  const typ = id => m.instances[id];
  const forsta = (pid, pred) => hand(m, pid).find(id => pred(typ(id)));
  const forsvarskort = forsta('a1', t => ['skoldmur', 'palissad', 'tornvakt', 'jarnport', 'vallgrav', 'fastningsmur', 'livvakt', 'runskold'].includes(t));
  const rentForsvar = forsvarskort;
  avvisas(() => playToTable(m, 'a1', rentForsvar, { role: ROLE.attack }), /kan inte spelas som vanlig attack/);
  const enkel = playToTable(m, 'a1', rentForsvar, { role: ROLE.attack, usage: USAGE.simple });
  assert.deepEqual(enkel, { instanceId: rentForsvar, playerId: 'a1', role: 'attack', usage: 'simple', targetCard: null, targetPlayer: null });
  assert.ok(Object.isFrozen(enkel), 'användningen kan inte ändras efter godkänt drag');
  assert.throws(() => { enkel.usage = 'normal'; });
  const attackkort = forsta('b1', t => t === 'stormning' || t === 'katapult' || t === 'murbracka' || t === 'ryttaranfall');
  if (attackkort) avvisas(() => playToTable(m, 'b1', attackkort, { role: ROLE.defence }), /kan inte användas som försvar/);
  avvisas(() => playToTable(m, 'b1', hand(m, 'b1')[0], { role: ROLE.defence, usage: USAGE.simple }), /Enkel attack kan inte användas för försvar/);
  avvisas(() => playToTable(m, 'b1', hand(m, 'a2')[0], { role: ROLE.attack, usage: USAGE.simple }), /finns inte på din hand/);
  avvisas(() => playToTable(m, 'b1', hand(m, 'b1')[0], { role: 'mitten' }), /Okänd roll/);
  playerOf(m, 'b2').status = PLAYER_STATUS.out;
  avvisas(() => playToTable(m, 'b2', hand(m, 'b2')[0], { role: ROLE.attack, usage: USAGE.simple }), /utslagen/);
  playToTable(m, 'b1', hand(m, 'b1')[0], { role: ROLE.attack, usage: USAGE.simple });
  assert.deepEqual(discardTableCardsOf(m, 'a1'), [rentForsvar]);
  assert.equal(m.table.length, 1);
  assert.equal(discardTable(m), 1);
  assert.equal(discardHand(m, 'b2'), 10);
  assert.equal(m.deckSize, 100, 'leken krymper inte när någon slås ut');
  assert.ok(auditTeam(m));
});

test('Kortbokföringen upptäcker dubbletter, saknade exemplar och kvarglömda undanlagda kort', () => {
  const m = klaraByten(ny(4));
  const kopia = structuredClone(m); hand(kopia, 'a1').push(hand(kopia, 'b1')[0]);
  assert.throws(() => auditTeam(kopia), /stämmer inte|flera platser/);
  const saknas = structuredClone(m); hand(saknas, 'a1').pop();
  assert.throws(() => auditTeam(saknas), /stämmer inte/);
  const undan = structuredClone(m); undan.setAside.push(undan.drawPile.pop());
  assert.throws(() => auditTeam(undan), /Undanlagda kort/);
  const bytt = structuredClone(m); bytt.drawPile[0] = bytt.discardPile[0] ?? 'm4:kort:okänd';
  assert.throws(() => auditTeam(bytt));
});

test('Slumpad långkörning för 4/6/8: spel, slängning, utslagning och påfyllning bevarar varje exemplar', () => {
  for (const size of TEAM_SIZES) {
    for (const seed of [1, 2, 3]) {
      const random = styrdSlump(seed * 31 + size);
      const m = ny(size, { random });
      /* Slumpade byten med upp till två kort */
      while (m.phase === TEAM_PHASE.swap) for (const id of m.seats) if (m.swapsConfirmed[id] < m.swapRound) confirmSwap(m, id, hand(m, id).filter(() => random() < 0.2).slice(0, 2), random);
      let strid = 0;
      for (let steg = 0; steg < 300; steg++) {
        const levande = m.players.filter(isAlive);
        const p = levande[Math.floor(random() * levande.length)];
        const r = random();
        if (r < 0.6 && p.hand.length) playToTable(m, p.id, p.hand[Math.floor(random() * p.hand.length)], { role: ROLE.attack, usage: USAGE.simple });
        else if (r < 0.8) { discardTable(m); refillEmptyHands(m, { startPlayerId: m.seats[strid % m.seats.length], refillId: ++strid, random }); }
        else if (r < 0.83) {
          const lag = levande.filter(q => q.teamId === p.teamId);
          if (lag.length > 1) { discardTableCardsOf(m, p.id); discardHand(m, p.id); p.status = PLAYER_STATUS.out; }
        }
        assert.ok(auditTeam(m));
      }
      assert.equal(m.deckSize, TEAM_DECKS[size].total);
      assert.ok(strid > 10, `${size}/${seed}: ${strid} påfyllningar`);
      for (const p of m.players.filter(q => !isAlive(q))) assert.equal(p.hand.length, 0, 'utslagna får aldrig nya kort');
    }
  }
});

test('Granskning L10: korten att byta måste vara en lista – annat avvisas i stället för att tolkas som "behåll handen"', () => {
  const m = ny(4);
  const fore = JSON.stringify(m);
  for (const fel of [null, 'a1', 7, {}, { 0: hand(m, 'a1')[0], length: 1 }]) avvisas(() => confirmSwap(m, 'a1', fel), /lista/);
  assert.equal(JSON.stringify(m), fore, 'inget ändrades');
  confirmSwap(m, 'a1');   // utelämnad lista är fortfarande "behåll handen"
  assert.equal(m.swapsConfirmed.a1, 1);
});
