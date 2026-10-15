/* Individuell utslagning och avhopp i lagmatch (arbetsordning L13; huvudplan §7 och §10; beslut 8A, 12B, 13A, 17A, 24B). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newLagmatch, processLag, slaUt, serveravbrott, allowedActions, leaderOf, LAG_FAS, LAG_HANDLING, LAG_SLUT, UTSLAG, STATUS } from './lagmatch.js';
import { playerOf, discardHand, auditTeam, isAlive } from './lagkortlek.js';
import { OUTCOME, ABORT } from './lagstrid.js';
import { USAGE } from './lagregler.js';
import { PLAYER_STATUS } from './kontrakt.js';
import { styrdSlump } from './teststod.js';

const H = LAG_HANDLING;
/* Rummets ordning: a1, a2, … (lag A) och b1, b2, … (lag B). */
const spelare = size => ['A', 'B'].flatMap(t => Array.from({ length: size / 2 }, (_, i) => ({ id: `${t.toLowerCase()}${i + 1}`, name: `${t.toLowerCase()}${i + 1}`, teamId: t })));
const fast = value => () => value;

function gor(m, type, playerId, extra = {}, random = styrdSlump(3)) {
  const r = processLag(m, { matchId: m.id, revision: m.revision, type, playerId, ...extra }, random);
  assert.equal(r.status, STATUS.ok, `${type} ${playerId}: ${r.message}`);
  assert.equal(r.match.revision, m.revision + 1);
  flodetGarVidare(r.match);
  return r.match;
}
const lamna = (m, playerId, random) => gor(m, H.leave, playerId, {}, random);
function avvisa(m, type, playerId, extra, pattern) {
  const r = processLag(m, { matchId: m.id, revision: m.revision, type, playerId, ...extra });
  assert.equal(r.status, STATUS.rejected, `${type} ${playerId} skulle avvisas`);
  assert.match(r.message, pattern);
  assert.equal(r.match, m, 'matchen är orörd');
}
function sla(m, ids, reason, random = styrdSlump(5)) {
  const r = slaUt(m, ids, reason, random);
  assert.equal(r.status, STATUS.ok, `slaUt ${ids}: ${r.message}`);
  assert.equal(r.match.revision, m.revision + 1, 'en gruppering är en händelse');
  flodetGarVidare(r.match);
  return r.match;
}
/* Byten (alla behåller) och lotten: 0.1 ger lag A, 0.9 lag B. */
function tillStart(size, forst = 'A') {
  let m = newLagmatch({ matchId: `l${size}`, players: spelare(size), random: styrdSlump(size) });
  while (m.phase === LAG_FAS.swap) for (const id of m.seats) if (m.swapsConfirmed[id] < m.swapRound) m = gor(m, H.swap, id, { cards: [] }, fast(forst === 'A' ? 0.1 : 0.9));
  return m;
}
const bekraftaAlla = (m, type) => { for (const p of m.players.filter(isAlive)) m = gor(m, type, p.id); return m; };
const tillStrid = (size, forst = 'A') => bekraftaAlla(tillStart(size, forst), H.confirmStart);
/* Lägger angivna kort i en spelares hand: ett exemplar som redan finns i handen används direkt, annars byts
   ett kort mot ett exemplar ur drag- eller slänghögen (i sista hand ur en annan spelares hand). */
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
const simpel = (m, pid) => ({ card: playerOf(m, pid).hand[0], usage: USAGE.simple });

/* Ingen låst kö: i varje pågående fas finns någon levande som kan föra matchen vidare, och utslagna
   har varken val, handkort eller kort på bordet. */
function flodetGarVidare(m) {
  for (const p of m.players.filter(p => !isAlive(p))) {
    assert.deepEqual(allowedActions(m, p.id), [], `${p.id} är utslagen och har inga val`);
    assert.equal(p.hand.length, 0, `${p.id}s hand är slängd`);
  }
  for (const e of m.table) assert.ok(isAlive(playerOf(m, e.playerId)), 'bordskort tillhör bara levande spelare');
  if (m.phase === LAG_FAS.over) return;
  const levande = m.players.filter(isAlive);
  switch (m.phase) {
    case LAG_FAS.swap:
      assert.ok(levande.some(p => m.swapsConfirmed[p.id] === m.swapRound - 1), 'någon levande kan byta');
      break;
    case LAG_FAS.start: case LAG_FAS.result:
      assert.ok(levande.some(p => !m.confirm.by[p.id]), 'någon levande har kvar att bekräfta');
      break;
    default: {
      assert.ok(isAlive(playerOf(m, m.activePlayer)), `${m.phase}: den aktiva spelaren ${m.activePlayer} lever`);
      assert.ok(allowedActions(m, m.activePlayer).length, `${m.phase}: ${m.activePlayer} har ett val`);
      if (m.phase !== LAG_FAS.target) assert.ok(isAlive(playerOf(m, m.battle.target)), 'måltavlan lever under en öppen strid');
    }
  }
}

test('Avhopp under startbytena: omgången går vidare utan den som lämnat, handen slängs och starten väntar bara på levande', () => {
  let m = newLagmatch({ matchId: 'byte', players: spelare(4), random: styrdSlump(4) });
  m = gor(m, H.swap, 'a1', { cards: [] });
  m = gor(m, H.swap, 'b1', { cards: [] });
  m = gor(m, H.swap, 'b2', { cards: playerOf(m, 'b2').hand.slice(0, 2) });
  assert.deepEqual([m.swapRound, m.setAside.length], [1, 2]);
  const handA2 = [...playerOf(m, 'a2').hand];
  const slangda = m.discardPile.length;
  m = lamna(m, 'a2');
  const a2 = playerOf(m, 'a2');
  assert.deepEqual([m.phase, m.swapRound, a2.status, a2.eliminationReason, a2.hand.length], [LAG_FAS.swap, 2, PLAYER_STATUS.out, UTSLAG.left, 0], 'a2 var sist i omgång 1');
  assert.equal(m.discardPile.length, slangda + 10);
  for (const id of handA2) assert.ok(m.discardPile.includes(id));
  avvisa(m, H.swap, 'a2', { cards: [] }, /utslagen/);
  avvisa(m, H.leave, 'a2', {}, /redan utslagen/);
  m = gor(m, H.swap, 'a1', { cards: [] });
  m = gor(m, H.swap, 'b1', { cards: [] });
  assert.equal(m.phase, LAG_FAS.swap, 'b2 har kvar att välja');
  m = lamna(m, 'b2', fast(0.9));
  assert.deepEqual([m.phase, m.attackingTeam, m.setAside.length], [LAG_FAS.start, 'B', 0], 'sista bytet klart: undanlagda kort tillbaka i draghögen');
  assert.deepEqual(allowedActions(m, 'b1'), [{ type: H.confirmStart }]);
  m = gor(m, H.confirmStart, 'a1');
  m = gor(m, H.confirmStart, 'b1');
  assert.deepEqual([m.phase, m.battleNumber, m.activePlayer], [LAG_FAS.target, 1, 'b1'], '1 mot 1 kan spela');
});

test('Avhopp vid startbekräftelsen: den sista som saknas lämnar → striden startar en gång; startspelaren som lämnar ersätts av nästa', () => {
  let m = tillStart(6, 'A');
  for (const id of ['a2', 'a3', 'b1', 'b2', 'b3']) m = gor(m, H.confirmStart, id);
  assert.equal(m.phase, LAG_FAS.start);
  m = lamna(m, 'a1');
  assert.deepEqual([m.phase, m.battleNumber, m.battle.leader, m.activePlayer], [LAG_FAS.target, 1, 'a2', 'a2']);
  assert.deepEqual(Object.keys(m.battle.startLife).sort(), ['a2', 'a3', 'b1', 'b2', 'b3']);
  assert.equal(m.log.filter(line => /^Strid 1:/.test(line)).length, 1, 'striden startade exakt en gång');
  avvisa(m, H.confirmStart, 'a1', {}, /väntar inte|utslagen/);

  let n = tillStart(6, 'A');
  n = lamna(n, 'b3');
  assert.deepEqual([n.phase, n.confirm.by], [LAG_FAS.start, {}], 'den som lämnar bekräftar inte åt andra');
  n = bekraftaAlla(n, H.confirmStart);   // fem levande räcker
  assert.deepEqual([n.phase, n.activePlayer], [LAG_FAS.target, 'a1']);
});

test('Avhopp vid målval: nästa levande lagkamrat tar över; 1 mot 4 kan fortsätta (8A)', () => {
  let m = tillStrid(8, 'A');
  m = lamna(m, 'a1');
  assert.deepEqual([m.phase, m.battleNumber, m.battle.leader, m.activePlayer], [LAG_FAS.target, 1, 'a2', 'a2']);
  avvisa(m, H.target, 'a1', { target: 'b1' }, /utslagen/);
  m = lamna(m, 'a2');
  m = lamna(m, 'a3');
  assert.deepEqual([m.activePlayer, leaderOf(m, 'A')], ['a4', 'a4']);
  assert.deepEqual(allowedActions(m, 'a4'), [{ type: H.target, players: ['b1', 'b2', 'b3', 'b4'] }]);
  m = gor(m, H.target, 'a4', { target: 'b1' });
  assert.deepEqual(m.battle.attackQueue, ['a4']);
  avvisa(m, H.passAttack, 'a4', {}, /minst ett kort/);
  m = gor(m, H.attack, 'a4', simpel(m, 'a4'));
  assert.deepEqual(m.battle.defenceQueue, ['b1', 'b2', 'b3', 'b4']);
  while (m.phase === LAG_FAS.defence) m = gor(m, H.passDefence, m.activePlayer);
  assert.deepEqual([m.lastResult.outcome, playerOf(m, 'b1').life, m.nextLeader.A], [OUTCOME.hit, 2, 'a4']);
  m = bekraftaAlla(m, H.next);
  assert.deepEqual([m.attackingTeam, m.activePlayer], ['B', 'b1']);
  assert.deepEqual(allowedActions(m, 'b1'), [{ type: H.target, players: ['a4'] }]);
  /* En försvarare som lämnar under målvalet försvinner bara ur listan. */
  m = lamna(m, 'b3');
  assert.deepEqual([m.activePlayer, m.battle.leader], ['b1', 'b1']);
});

test('Avhopp vid målval när resten av laget saknar handkort: skyddsregeln ger turen till det andra laget, samma stridsnummer', () => {
  let m = tillStrid(4, 'A');
  discardHand(m, 'a2');
  m = lamna(m, 'a1');
  assert.deepEqual([m.phase, m.attackingTeam, m.battleNumber, m.activePlayer], [LAG_FAS.target, 'B', 1, 'b1']);
  assert.ok(m.log.some(line => /Södra laget saknar handkort – turen går till Norra laget/.test(line)));
});

test('Avhopp under anfallet: nästa i kön tar över; ett spelat kort tas bort och attacken räknas om (3 + 2 → 2)', () => {
  let m = tillStrid(6);
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', simpel(m, 'a1'));
  m = lamna(m, 'a2');
  assert.deepEqual([m.activePlayer, m.battle.attackQueue, m.battle.attackIndex], ['a3', ['a1', 'a3'], 1]);
  m = gor(m, H.passAttack, 'a3');
  assert.deepEqual([m.phase, m.activePlayer], [LAG_FAS.defence, 'b1']);

  let n = tillStrid(6);
  const [trea] = ge(n, 'a1', 'ryttaranfall');
  const [tvaa] = ge(n, 'a2', 'armborst');
  n = gor(n, H.target, 'a1', { target: 'b1' });
  n = gor(n, H.attack, 'a1', { card: trea });
  n = gor(n, H.attack, 'a2', { card: tvaa });
  n = lamna(n, 'a1');
  assert.deepEqual(n.table.map(e => e.instanceId), [tvaa]);
  assert.ok(n.discardPile.includes(trea), '12B: kortet slängs');
  assert.equal(n.activePlayer, 'a3');
  n = gor(n, H.passAttack, 'a3');
  while (n.phase === LAG_FAS.defence) n = gor(n, H.passDefence, n.activePlayer);
  assert.deepEqual([n.lastResult.outcome, n.lastResult.attack, n.lastResult.lifeDelta], [OUTCOME.hit, 2, { b1: -1 }]);
  assert.deepEqual(n.lastResult.table.map(e => e.cardId), ['armborst']);
  assert.equal(n.nextLeader.A, 'a2', 'startspelaren som lämnade hoppas över i 21A');
});

test('Avhopp under anfallet: försvinner lagets enda kort måste den sista i kön bidra; finns ingen kvar som kan bidra håller försvaret (24B)', () => {
  let m = tillStrid(6);
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', simpel(m, 'a1'));
  m = gor(m, H.passAttack, 'a2');
  assert.ok(allowedActions(m, 'a3').some(a => a.type === H.passAttack));
  m = lamna(m, 'a1');
  assert.deepEqual([m.table.length, m.activePlayer], [0, 'a3']);
  assert.ok(!allowedActions(m, 'a3').some(a => a.type === H.passAttack), 'bidragskravet prövas om efter borttagningen');
  avvisa(m, H.passAttack, 'a3', {}, /minst ett kort/);
  m = gor(m, H.attack, 'a3', simpel(m, 'a3'));
  assert.equal(m.phase, LAG_FAS.defence);

  let n = tillStrid(4);
  n = gor(n, H.target, 'a1', { target: 'b1' });
  n = gor(n, H.passAttack, 'a1');
  n = lamna(n, 'a2');
  assert.deepEqual([n.phase, n.table.length, n.activePlayer], [LAG_FAS.defence, 0, 'b1'], 'kön är slut utan kort: anfallet låses tomt');
  n = gor(n, H.passDefence, 'b1');
  n = gor(n, H.passDefence, 'b2');
  assert.deepEqual([n.lastResult.outcome, n.lastResult.attack, n.lastResult.lifeDelta], [OUTCOME.held, 0, {}]);
  assert.equal(n.phase, LAG_FAS.result);
});

test('Avhopp under försvaret: nästa hjälpare tar över; ett spelat försvarskort tas bort och försvaret räknas om', () => {
  let m = tillStrid(6);
  const [storm] = ge(m, 'a1', 'stormning');
  const [port] = ge(m, 'b2', 'jarnport');
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', { card: storm });
  m = gor(m, H.passAttack, 'a2'); m = gor(m, H.passAttack, 'a3');
  m = gor(m, H.passDefence, 'b1');
  m = gor(m, H.defend, 'b2', { card: port });
  m = lamna(m, 'b2');
  assert.deepEqual([m.activePlayer, m.battle.defenceQueue, m.table.map(e => e.instanceId)], ['b3', ['b1', 'b3'], [storm]]);
  m = gor(m, H.passDefence, 'b3');
  assert.deepEqual([m.lastResult.outcome, m.lastResult.attack, m.lastResult.defence, playerOf(m, 'b1').life], [OUTCOME.hit, 3, 0, 2]);

  let n = tillStrid(6);
  n = gor(n, H.target, 'a1', { target: 'b1' });
  n = gor(n, H.attack, 'a1', simpel(n, 'a1'));
  n = gor(n, H.passAttack, 'a2'); n = gor(n, H.passAttack, 'a3');
  n = gor(n, H.passDefence, 'b1');
  n = lamna(n, 'b2');   // den aktiva hjälparen
  assert.deepEqual([n.activePlayer, n.battle.defenceQueue], ['b3', ['b1', 'b3']]);
  n = lamna(n, 'b3');   // den sista i försvarskön → striden avgörs
  assert.deepEqual([n.phase, n.lastResult.outcome, n.lastResult.turns.filter(t => t.role === 'defence').map(t => t.playerId)], [LAG_FAS.result, OUTCOME.hit, ['b1']]);
});

test('24B: anfallaren lämnar under försvaret – attacken blir 0, Helande ljus läker sin ägare och en Törnesköld mot den som lämnat skadar ingen (Mira-exemplet)', () => {
  let m = tillStart(6);
  playerOf(m, 'b1').life = 2;
  m = bekraftaAlla(m, H.confirmStart);
  const [storm] = ge(m, 'a1', 'stormning');
  const [ljus] = ge(m, 'b1', 'helande-ljus');
  const [torn] = ge(m, 'b2', 'torneskold');
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', { card: storm });
  m = gor(m, H.passAttack, 'a2'); m = gor(m, H.passAttack, 'a3');
  m = gor(m, H.defend, 'b1', { card: ljus });
  m = gor(m, H.defend, 'b2', { card: torn, targetPlayer: 'a1' });
  m = lamna(m, 'a1');
  assert.equal(m.phase, LAG_FAS.defence, 'kvarvarande val slutförs');
  m = gor(m, H.passDefence, 'b3');
  const r = m.lastResult;
  assert.deepEqual([r.outcome, r.attack, r.lifeDelta, r.eliminated], [OUTCOME.held, 0, { b1: 1 }, []]);
  assert.deepEqual(['a2', 'a3', 'b1'].map(id => playerOf(m, id).life), [3, 3, 3]);
  assert.ok(m.discardPile.includes(storm) && m.discardPile.includes(ljus) && m.discardPile.includes(torn));
});

test('17A: ett målkort som försvinner ersätts inte – Barriären mot Eldklot väljer inte om när Eldklot tas bort', () => {
  let m = tillStrid(6);
  const [eld] = ge(m, 'a1', 'eldklot');
  const [storm] = ge(m, 'a2', 'stormning');
  const [bar] = ge(m, 'b1', 'barriar');
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', { card: eld });
  m = gor(m, H.attack, 'a2', { card: storm });
  m = gor(m, H.passAttack, 'a3');
  m = gor(m, H.defend, 'b1', { card: bar, targetCard: eld });
  m = lamna(m, 'a1');
  assert.equal(m.table.find(e => e.instanceId === bar).targetCard, eld, 'målet ligger kvar bundet till exemplaret');
  m = gor(m, H.passDefence, 'b2'); m = gor(m, H.passDefence, 'b3');
  assert.deepEqual([m.lastResult.outcome, m.lastResult.attack, m.lastResult.stopped], [OUTCOME.hit, 3, []]);
});

test('13A: måltavlan lämnar under anfallet – striden avbryts utan effekter, bordet slängs, tomma händer fylls och det andra laget anfaller efter Fortsätt', () => {
  let m = tillStart(6);
  playerOf(m, 'a1').life = 2;
  m = bekraftaAlla(m, H.confirmStart);
  const [vamp] = ge(m, 'a1', 'vampyrbett');
  discardHand(m, 'a3');
  m = gor(m, H.target, 'a1', { target: 'b2' });
  m = gor(m, H.attack, 'a1', { card: vamp });
  const handB2 = [...playerOf(m, 'b2').hand];
  m = lamna(m, 'b2');
  const r = m.lastResult;
  assert.deepEqual([m.phase, r.outcome, r.reason, r.battleNumber, r.target], [LAG_FAS.result, OUTCOME.aborted, ABORT.targetGone, 1, 'b2']);
  assert.deepEqual([r.attack, r.lifeDelta, r.eliminated], [0, {}, []]);
  assert.deepEqual(r.table.map(e => e.cardId), ['vampyrbett']);
  assert.equal(playerOf(m, 'a1').life, 2, 'Vampyrbett läker inte i en avbruten strid');
  assert.equal(m.table.length, 0);
  for (const id of [vamp, ...handB2]) assert.ok(m.discardPile.includes(id));
  assert.deepEqual([playerOf(m, 'b2').status, playerOf(m, 'b2').eliminationReason], [PLAYER_STATUS.out, UTSLAG.left]);
  assert.equal(playerOf(m, 'a3').hand.length, 5, '22A gäller även efter en avbruten strid');
  assert.ok(m.refills.includes(1));
  assert.equal(m.nextLeader.A, 'a2');
  m = bekraftaAlla(m, H.next);
  assert.deepEqual([m.phase, m.attackingTeam, m.activePlayer, m.battleNumber], [LAG_FAS.target, 'B', 'b1', 2]);
});

test('13A: måltavlan lämnar under försvaret – ingen läkning, ingen motstöt och ingen skada', () => {
  let m = tillStart(6);
  playerOf(m, 'b1').life = 2;
  m = bekraftaAlla(m, H.confirmStart);
  const [storm] = ge(m, 'a1', 'stormning');
  const [ljus] = ge(m, 'b1', 'helande-ljus');
  const [torn] = ge(m, 'b2', 'torneskold');
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', { card: storm });
  m = gor(m, H.passAttack, 'a2'); m = gor(m, H.passAttack, 'a3');
  m = gor(m, H.defend, 'b1', { card: ljus });
  m = gor(m, H.defend, 'b2', { card: torn, targetPlayer: 'a1' });
  m = lamna(m, 'b1');
  const r = m.lastResult;
  assert.deepEqual([m.phase, r.outcome, r.lifeDelta], [LAG_FAS.result, OUTCOME.aborted, {}]);
  assert.deepEqual(r.table.map(e => e.cardId).sort(), ['helande-ljus', 'stormning', 'torneskold']);
  assert.deepEqual(m.players.map(p => p.life), [3, 3, 3, 2, 3, 3]);
  assert.equal(m.log.filter(line => /lämnade striden/.test(line)).length, 1);
});

test('Avhopp i resultatläget: sparat resultat ändras inte; den sista som saknas lämnar → nästa strid startar en gång', () => {
  let m = tillStrid(4);
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', simpel(m, 'a1'));
  m = gor(m, H.passAttack, 'a2');
  m = gor(m, H.passDefence, 'b1'); m = gor(m, H.passDefence, 'b2');
  const resultat = structuredClone(m.lastResult);
  m = lamna(m, 'a2');
  assert.deepEqual(m.lastResult, resultat);
  assert.equal(m.phase, LAG_FAS.result);
  m = gor(m, H.next, 'a1');
  m = gor(m, H.next, 'b1');
  m = lamna(m, 'b2');
  assert.deepEqual(m.lastResult, resultat, 'ett sent Lämna ändrar inte ett avgjort resultat');
  assert.deepEqual([m.phase, m.attackingTeam, m.activePlayer, m.battleNumber], [LAG_FAS.target, 'B', 'b1', 2]);
  assert.equal(m.log.filter(line => /^Strid 2:/.test(line)).length, 1);
});

test('Sista lagmedlemmen lämnar: matchslut prövas före 13A och före fortsatt strid; bordet slängs; sena avhopp avvisas', () => {
  /* Försvarande lagets sista spelare är måltavlan och lämnar under försvaret. */
  let m = tillStrid(4);
  m = lamna(m, 'b2');
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', simpel(m, 'a1'));
  m = gor(m, H.passAttack, 'a2');
  assert.deepEqual(m.battle.defenceQueue, ['b1']);
  m = lamna(m, 'b1');
  assert.deepEqual([m.phase, m.winnerTeam, m.endReason, m.lastResult, m.battle, m.activePlayer, m.table.length], [LAG_FAS.over, 'A', LAG_SLUT.teamOut, null, null, null, 0]);
  avvisa(m, H.leave, 'a1', {}, /avslutad/);
  for (const p of m.players) assert.deepEqual(allowedActions(m, p.id), []);

  /* Anfallande lagets sista spelare lämnar mitt i striden, med sitt kort på bordet. */
  let n = tillStrid(4);
  n = lamna(n, 'a2');
  n = gor(n, H.target, 'a1', { target: 'b1' });
  const { card } = simpel(n, 'a1');
  n = gor(n, H.attack, 'a1', { card, usage: USAGE.simple });
  n = gor(n, H.passDefence, 'b1');
  const refills = [...n.refills];
  n = lamna(n, 'a1');
  assert.deepEqual([n.phase, n.winnerTeam, n.endReason, n.table.length, n.lastResult], [LAG_FAS.over, 'B', LAG_SLUT.teamOut, 0, null]);
  assert.ok(n.discardPile.includes(card));
  assert.deepEqual(n.refills, refills, 'ingen påfyllning efter matchslut');

  /* En vanligt avgjord match ändras inte av ett sent Lämna eller en sen tidsgräns. */
  let x = tillStart(4);
  playerOf(x, 'b1').life = 1;
  x = lamna(x, 'b2');
  x = bekraftaAlla(x, H.confirmStart);
  const [kat] = ge(x, 'a1', 'katapult');
  x = gor(x, H.target, 'a1', { target: 'b1' });
  x = gor(x, H.attack, 'a1', { card: kat });
  x = gor(x, H.passAttack, 'a2');
  x = gor(x, H.passDefence, 'b1');
  assert.deepEqual([x.phase, x.winnerTeam, x.lastResult.eliminated], [LAG_FAS.over, 'A', ['b1']]);
  avvisa(x, H.leave, 'a1', {}, /avslutad/);
  const sen = slaUt(x, ['a1'], UTSLAG.timeout);
  assert.deepEqual([sen.status, sen.message, sen.match], [STATUS.rejected, 'Matchen är redan avgjord.', x]);
});

test('slaUt: flera samtidigt är en händelse – båda lagens sista ger ingen vinnare; måltavla och lagkamrat avbryter striden en gång; redan utslagna avvisas', () => {
  let m = tillStrid(4);
  m = lamna(m, 'a2');
  m = lamna(m, 'b2');
  m = sla(m, ['a1', 'b1'], UTSLAG.timeout);
  assert.deepEqual([m.phase, m.winnerTeam, m.endReason], [LAG_FAS.over, null, LAG_SLUT.noPlayers]);
  assert.deepEqual(m.players.map(p => p.eliminationReason), [UTSLAG.timeout, UTSLAG.left, UTSLAG.timeout, UTSLAG.left]);

  let n = tillStrid(6);
  n = gor(n, H.target, 'a1', { target: 'b1' });
  n = gor(n, H.attack, 'a1', simpel(n, 'a1'));
  n = gor(n, H.passAttack, 'a2'); n = gor(n, H.passAttack, 'a3');
  n = gor(n, H.passDefence, 'b1');
  n = sla(n, ['b1', 'b2', 'b2'], UTSLAG.disconnect);
  assert.deepEqual([n.phase, n.lastResult.outcome, n.lastResult.reason], [LAG_FAS.result, OUTCOME.aborted, ABORT.targetGone]);
  assert.equal(n.log.filter(line => /lämnade striden/.test(line)).length, 1);
  assert.equal(n.log.filter(line => /^b2 kom inte tillbaka/.test(line)).length, 1, 'dubbletter räknas en gång');
  const fore = n;
  for (const [ids, pattern] of [[['b1'], /redan utslagen/], [['b1', 'b2'], /redan utslagen/], [['x9'], /Okänd spelare/]]) {
    const r = slaUt(fore, ids, UTSLAG.timeout);
    assert.equal(r.status, STATUS.rejected);
    assert.match(r.message, pattern);
    assert.equal(r.match, fore);
  }
  n = sla(n, ['b1', 'a3'], UTSLAG.timeout);
  assert.deepEqual([playerOf(n, 'a3').status, playerOf(n, 'b1').eliminationReason], [PLAYER_STATUS.out, UTSLAG.disconnect], 'redan utslagna hoppas över; orsaken skrivs inte om');
  n = bekraftaAlla(n, H.next);
  assert.deepEqual([n.attackingTeam, n.activePlayer], ['B', 'b3'], 'startspelaren hoppar över b1 och b2');
});

/* ---- Hela matcher med slumpade avhopp och tidsgränser ---- */
test('Serveravbrott (27B): ingen vinnare, liv, händer och utslagningar står kvar och kortbokföringen stämmer', () => {
  const text = 'Servern startades om – matchen avbröts utan vinnare.';
  const kontroll = (m, namn) => {
    const slut = serveravbrott(m, text);
    assert.deepEqual([slut.phase, slut.winnerTeam, slut.endReason, slut.activePlayer, slut.confirm, slut.battle, slut.revision], [LAG_FAS.over, null, LAG_SLUT.serverAbort, null, null, null, m.revision + 1], namn);
    assert.deepEqual(slut.players.map(p => [p.id, p.life, p.status, p.hand]), m.players.map(p => [p.id, p.life, p.status, p.hand]), `${namn}: liv, status och händer`);
    assert.deepEqual([slut.table, slut.setAside, slut.log.at(-1)], [[], [], text], namn);
    auditTeam(slut);
    assert.deepEqual(m.players.map(p => allowedActions(slut, p.id)), m.players.map(() => []), `${namn}: inga val efteråt`);
  };
  let m = newLagmatch({ matchId: 's4', players: spelare(4), random: styrdSlump(4) });
  m = gor(m, H.swap, 'a1', { cards: playerOf(m, 'a1').hand.slice(0, 2) });
  assert.equal(m.setAside.length, 2);
  kontroll(m, 'startbyten');
  let n = tillStrid(6);
  n = gor(n, H.target, 'a1', { target: 'b1' });
  n = gor(n, H.attack, 'a1', simpel(n, 'a1'));
  assert.equal(n.table.length, 1);
  kontroll(n, 'anfall');
  const u = lamna(tillStrid(4), 'b2');
  assert.equal(isAlive(playerOf(u, 'b2')), false);
  kontroll(u, 'efter avhopp');
});
test('Hela lagmatcher 4/6/8 med slumpade avhopp och gruppvisa utslagningar: inga låsta köer, sparade resultat ändras inte, matchen tar alltid slut', () => {
  const tally = { avhopp: 0, grupper: 0, avbrutna: 0, utanVinnare: 0, matcher: 0 };
  for (const size of [4, 6, 8]) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const random = styrdSlump(seed * 31 + size);
      const pick = list => list[Math.floor(random() * list.length)];
      let m = newLagmatch({ matchId: `x${size}-${seed}`, players: spelare(size), random });
      let steps = 0;
      while (m.phase !== LAG_FAS.over) {
        assert.ok(++steps < 30000, `${size}/${seed}: matchen tog aldrig slut`);
        flodetGarVidare(m);
        const before = m;
        const levande = m.players.filter(isAlive);
        const roll = random();
        let r, avhopp = false;
        if (roll < 0.025) {
          r = processLag(m, { type: H.leave, matchId: m.id, revision: m.revision, playerId: pick(levande).id }, random);
          avhopp = true; tally.avhopp++;
        } else if (roll < 0.035) {
          const grupp = levande.filter(() => random() < 0.3).map(p => p.id);
          if (!grupp.length) continue;
          r = slaUt(m, grupp, pick([UTSLAG.timeout, UTSLAG.disconnect]), random);
          avhopp = true; tally.grupper++;
        } else {
          const actors = m.players.filter(p => allowedActions(m, p.id).length);
          assert.ok(actors.length, `${size}/${seed}: ingen kan agera i fas ${m.phase}`);
          const p = pick(actors);
          const a = pick(allowedActions(m, p.id));
          let action = { type: a.type };
          if (a.type === H.swap) action.cards = a.cards.filter(() => random() < 0.2).slice(0, a.maxCards).map(c => c.instanceId);
          if (a.type === H.target) action.target = pick(a.players);
          if (a.type === H.attack) action = a.normal.length && random() < 0.7 ? { type: a.type, card: pick(a.normal).instanceId } : { type: a.type, card: pick(a.simple).instanceId, usage: USAGE.simple };
          if (a.type === H.defend) {
            if (a.cards.length && random() < 0.75) { const c = pick(a.cards); action = { type: a.type, card: c.instanceId, targetCard: c.cardTargets?.length ? pick(c.cardTargets) : null, targetPlayer: c.playerTargets?.length ? pick(c.playerTargets) : null }; }
            else action = { type: H.passDefence };
          }
          r = processLag(m, { ...action, matchId: m.id, revision: m.revision, playerId: p.id }, random);
        }
        assert.equal(r.status, STATUS.ok, `${size}/${seed}: ${r.message}`);
        assert.equal(r.match.revision, before.revision + 1);
        m = r.match;
        if (avhopp && ![LAG_FAS.attack, LAG_FAS.defence].includes(before.phase)) assert.deepEqual(m.lastResult, before.lastResult, 'avhopp utanför en öppen strid ändrar inget sparat resultat');
        if (m.lastResult?.outcome === OUTCOME.aborted && before.lastResult?.battleNumber !== m.lastResult.battleNumber) {
          tally.avbrutna++;
          assert.ok(avhopp, 'bara ett avhopp kan avbryta en strid');
          assert.ok(!isAlive(playerOf(m, m.lastResult.target)));
        }
      }
      flodetGarVidare(m);
      tally.matcher++;
      if (m.winnerTeam === null) {
        tally.utanVinnare++;
        assert.equal(m.endReason, LAG_SLUT.noPlayers);
        assert.ok(m.players.every(p => !isAlive(p)));
      } else {
        assert.equal(m.endReason, LAG_SLUT.teamOut);
        assert.ok(m.players.some(q => q.teamId === m.winnerTeam && isAlive(q)));
        assert.ok(m.players.filter(q => q.teamId !== m.winnerTeam).every(q => !isAlive(q)));
      }
      assert.deepEqual([m.table.length, m.setAside.length, m.battle, m.activePlayer], [0, 0, null, null]);
      auditTeam(m);
    }
  }
  assert.ok(tally.avhopp > 20 && tally.grupper > 5 && tally.avbrutna > 0, JSON.stringify(tally));
});
