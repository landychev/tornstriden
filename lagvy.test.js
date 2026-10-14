/* Lagvyn och lagmatchens händelser (L14/L15), med rättelser från granskningen av L10–L15. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newLagmatch, processLag, LAG_FAS, LAG_HANDLING as H, STATUS } from './lagmatch.js';
import { playerOf, discardHand, auditTeam, isAlive } from './lagkortlek.js';
import { lagVy, lagHandelser, LAG_EVENT } from './lagvy.js';
import { USAGE } from './lagregler.js';
import { validatePrivateView, assertNoSecrets } from './kontrakt.js';
import { styrdSlump } from './teststod.js';

const spelare = size => ['A', 'B'].flatMap(t => Array.from({ length: size / 2 }, (_, i) => ({ id: `${t.toLowerCase()}${i + 1}`, name: `${t.toLowerCase()}${i + 1}`, teamId: t })));
/* Kör en handling och returnerar både läget och händelserna, som servern gör. */
function gor(m, type, playerId, extra = {}, random = styrdSlump(3)) {
  const action = { matchId: m.id, revision: m.revision, type, playerId, ...extra };
  const r = processLag(m, action, random);
  assert.equal(r.status, STATUS.ok, `${type} ${playerId}: ${r.message}`);
  r.match.handelser = lagHandelser({ before: m, after: r.match, replyEvents: r.events, action, nextEventId: 1, at: 0 });
  return r.match;
}
function tillStrid(size) {
  let m = newLagmatch({ matchId: `v${size}`, players: spelare(size), random: styrdSlump(size) });
  while (m.phase === LAG_FAS.swap) for (const id of m.seats) if (m.swapsConfirmed[id] < m.swapRound) m = gor(m, H.swap, id, { cards: [] }, () => 0.1);
  for (const p of m.players.filter(isAlive)) m = gor(m, H.confirmStart, p.id);
  return m;
}
function ge(m, pid, ...cardIds) {
  const hand = playerOf(m, pid).hand;
  const givna = [];
  return cardIds.map(cardId => {
    const egen = hand.find(id => m.instances[id] === cardId && !givna.includes(id));
    if (egen) { givna.push(egen); return egen; }
    const plats = hand.findIndex(id => !givna.includes(id) && !cardIds.includes(m.instances[id]));
    for (const pile of [m.drawPile, m.discardPile, ...m.players.filter(p => p.id !== pid).map(p => p.hand)]) {
      const at = pile.findIndex(id => m.instances[id] === cardId);
      if (at !== -1) { const id = pile[at]; pile[at] = hand[plats]; hand[plats] = id; givna.push(id); auditTeam(m); return id; }
    }
    throw new Error(`Inget ledigt ${cardId}`);
  });
}
/* Lämnar bara de angivna exemplaren kvar i handen; resten slängs. */
function behallBara(m, pid, ids) {
  const p = playerOf(m, pid);
  m.discardPile.push(...p.hand.filter(id => !ids.includes(id)));
  p.hand = [...ids];
  auditTeam(m);
}

test('Granskning L14: påfyllningshändelsen anger hela antalet även när det sista försvarskortet avgör striden', () => {
  let m = tillStrid(4);
  const [mur] = ge(m, 'b2', 'skoldmur');
  behallBara(m, 'b2', [mur]);
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', { card: playerOf(m, 'a1').hand[0], usage: USAGE.simple });
  m = gor(m, H.passAttack, 'a2');
  m = gor(m, H.passDefence, 'b1');
  m = gor(m, H.defend, 'b2', { card: mur });   // sista kortet: striden avgörs och handen fylls i samma steg
  assert.equal(m.phase, LAG_FAS.result);
  assert.equal(playerOf(m, 'b2').hand.length, 5);
  assert.deepEqual(m.handelser.filter(e => e.type === LAG_EVENT.refill).map(e => e.data), [{ playerId: 'b2', count: 5 }]);
  /* Byten och vanliga drag ger ingen påfyllningshändelse */
  const n = tillStrid(4);
  assert.ok(!n.handelser.some(e => e.type === LAG_EVENT.refill));
});

test('Granskning L15: vyn förhandsvisar attack, försvar, bonusar, stopp och avdrag under striden utan att avgöra den', () => {
  let m = tillStrid(6);
  const [drake] = ge(m, 'a1', 'drakeld');
  const [mur] = ge(m, 'b1', 'skoldmur');
  const [bar] = ge(m, 'b2', 'barriar');
  assert.equal(lagVy(m, 'b1').battle.preview, null, 'ingen förhandsvisning innan måltavlan är vald');
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', { card: drake });
  let p = lagVy(m, 'b3').battle.preview;
  assert.deepEqual([p.attack, p.defence], [4, 0], 'anfallet hittills');
  m = gor(m, H.attack, 'a2', { card: playerOf(m, 'a2').hand[0], usage: USAGE.simple });
  m = gor(m, H.passAttack, 'a3');
  m = gor(m, H.defend, 'b1', { card: mur });
  p = lagVy(m, 'b2').battle.preview;
  assert.deepEqual([p.attack, p.defence, p.defended], [4 + 2 + 1, 3, false], 'Drakeld får +2 mot ett blått försvarskort');
  assert.deepEqual([p.cards[drake].value, p.cards[drake].bonus], [6, 2]);
  m = gor(m, H.defend, 'b2', { card: bar, targetCard: drake });
  const vy = lagVy(m, 'a3');
  p = vy.battle.preview;
  assert.deepEqual([p.attack, p.defence, p.defended, p.stopped, p.cards[drake].stoppedBy], [1, 3, true, [drake], [bar]], 'Barriären stoppar Drakeld');
  assert.deepEqual(p.deductions, { frost: 0, pierce: 0 });
  for (const key of ['lifeDelta', 'life', 'eliminated', 'events', 'outcome']) assert.ok(!(key in p), `förhandsvisningen avgör inget: ${key}`);
  assert.deepEqual([m.phase, m.lastResult, playerOf(m, 'b1').life], [LAG_FAS.defence, null, 3], 'striden är inte avgjord');
  validatePrivateView(vy);
  assertNoSecrets(vy, 'a3');
  /* Avdrag: en Isrustning i nästa strid sänker lagets attack */
  let n = tillStrid(4);
  const [is] = ge(n, 'b1', 'isrustning');
  n = gor(n, H.target, 'a1', { target: 'b1' });
  n = gor(n, H.attack, 'a1', { card: ge(n, 'a1', 'stormning')[0] });
  n = gor(n, H.passAttack, 'a2');
  n = gor(n, H.defend, 'b1', { card: is });
  assert.equal(n.phase, LAG_FAS.defence, 'b2 har kvar att välja');
  p = lagVy(n, 'a1').battle.preview;
  assert.deepEqual([p.attack, p.defence, p.deductions.frost], [1, 2, 2], 'Stormning 3 − Isrustning 2 mot försvar 2');
});
