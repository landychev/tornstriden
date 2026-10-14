import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newLagmatch, processLag, allowedActions, leaderOf, LAG_FAS, LAG_HANDLING, LAG_SLUT, STATUS } from './lagmatch.js';
import { playerOf, discardHand, auditTeam, isAlive } from './lagkortlek.js';
import { OUTCOME } from './lagstrid.js';
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
  return r.match;
}
function avvisa(m, type, playerId, extra, pattern) {
  const r = processLag(m, { matchId: m.id, revision: m.revision, type, playerId, ...extra });
  assert.equal(r.status, STATUS.rejected, `${type} ${playerId} skulle avvisas`);
  assert.match(r.message, pattern);
  assert.equal(r.match, m, 'matchen är orörd');
}
/* Byten (alla behåller) och lotten: 0.1 ger lag A, 0.9 lag B. */
function tillStart(size, forst = 'A') {
  let m = newLagmatch({ matchId: `l${size}`, players: spelare(size), random: styrdSlump(size) });
  while (m.phase === LAG_FAS.swap) for (const id of m.seats) if (m.swapsConfirmed[id] < m.swapRound) m = gor(m, H.swap, id, { cards: [] }, fast(forst === 'A' ? 0.1 : 0.9));
  return m;
}
const bekraftaAlla = (m, type) => { for (const p of m.players.filter(isAlive)) m = gor(m, type, p.id); return m; };
const tillStrid = (size, forst = 'A') => bekraftaAlla(tillStart(size, forst), H.confirmStart);
/* Lägger angivna kort i en spelares hand genom att byta plats med kort i drag- eller slänghögen. */
function ge(m, pid, ...cardIds) {
  const hand = playerOf(m, pid).hand;
  return cardIds.map((cardId, i) => {
    for (const pile of [m.drawPile, m.discardPile]) {
      const at = pile.findIndex(id => m.instances[id] === cardId);
      if (at !== -1) { const id = pile[at]; pile[at] = hand[i]; hand[i] = id; auditTeam(m); return id; }
    }
    throw new Error(`Inget ledigt ${cardId}`);
  });
}

test('Start: byten följs av lottat första lag och startbekräftelse från alla levande – övergången sker exakt en gång', () => {
  let m = tillStart(4, 'A');
  assert.equal(m.phase, LAG_FAS.start);
  assert.equal(m.attackingTeam, 'A');
  for (const p of m.players) assert.deepEqual(allowedActions(m, p.id), [{ type: H.confirmStart }]);
  avvisa(m, H.target, 'a1', { target: 'b1' }, /inte rätt läge/);
  m = gor(m, H.confirmStart, 'a1');
  avvisa(m, H.confirmStart, 'a1', {}, /redan bekräftat/);
  assert.deepEqual(allowedActions(m, 'a1'), []);
  m = gor(m, H.confirmStart, 'b1');
  m = gor(m, H.confirmStart, 'a2');
  assert.equal(m.phase, LAG_FAS.start, 'väntar på den sista');
  m = gor(m, H.confirmStart, 'b2');
  assert.deepEqual([m.phase, m.battleNumber, m.activePlayer], [LAG_FAS.target, 1, 'a1']);
  avvisa(m, H.confirmStart, 'b2', {}, /väntar inte/);
  const b = tillStrid(4, 'B');
  assert.deepEqual([b.attackingTeam, b.activePlayer], ['B', 'b1']);
});

test('Målval: bara startspelaren, bara ett levande fiendetorn', () => {
  let m = tillStrid(4);
  avvisa(m, H.target, 'b1', { target: 'a1' }, /inte din tur/);
  avvisa(m, H.target, 'a1', { target: 'a2' }, /fiendelaget/);
  avvisa(m, H.target, 'a1', { target: 'x9' }, /fiendelaget/);
  assert.deepEqual(allowedActions(m, 'a1'), [{ type: H.target, players: ['b1', 'b2'] }]);
  m = gor(m, H.target, 'a1', { target: 'b2' });
  assert.deepEqual([m.phase, m.battle.target, m.battle.attackQueue, m.activePlayer], [LAG_FAS.attack, 'b2', ['a1', 'a2'], 'a1']);
});

test('Anfallskö: startspelaren och sedan lagkamrater i fast ordning, högst ett kort var; laget måste bidra; alla kort duger som enkel attack', () => {
  let m = tillStrid(6);
  const [skold] = ge(m, 'a3', 'skoldmur');
  m = gor(m, H.target, 'a1', { target: 'b2' });
  assert.deepEqual(m.battle.attackQueue, ['a1', 'a2', 'a3']);
  avvisa(m, H.attack, 'a2', { card: playerOf(m, 'a2').hand[0] }, /inte din tur/);
  m = gor(m, H.passAttack, 'a1');
  m = gor(m, H.passAttack, 'a2');
  assert.equal(m.activePlayer, 'a3');
  assert.ok(!allowedActions(m, 'a3').some(a => a.type === H.passAttack), 'den sista får inte avstå när inget kort lagts');
  avvisa(m, H.passAttack, 'a3', {}, /minst ett kort/);
  avvisa(m, H.attack, 'a3', { card: skold }, /kan inte spelas som vanlig attack/);
  m = gor(m, H.attack, 'a3', { card: skold, usage: USAGE.simple });
  assert.deepEqual(m.table.map(e => [e.playerId, e.role, e.usage]), [['a3', 'attack', 'simple']]);
  assert.deepEqual([m.phase, m.activePlayer], [LAG_FAS.defence, 'b2']);

  let n = tillStrid(6);
  n = gor(n, H.target, 'a1', { target: 'b1' });
  n = gor(n, H.attack, 'a1', { card: playerOf(n, 'a1').hand[0], usage: USAGE.simple });
  avvisa(n, H.attack, 'a1', { card: playerOf(n, 'a1').hand[0], usage: USAGE.simple }, /inte din tur/);
  n = gor(n, H.passAttack, 'a2');
  n = gor(n, H.passAttack, 'a3');
  assert.equal(n.phase, LAG_FAS.defence, 'när ett kort lagts får övriga avstå');
});

test('Försvarskö: måltavlan först, sedan levande lagkamrater i fast ordning efter måltavlan; alla får avstå', () => {
  let m = tillStrid(6);
  m = gor(m, H.target, 'a1', { target: 'b2' });
  m = gor(m, H.attack, 'a1', { card: playerOf(m, 'a1').hand[0], usage: USAGE.simple });
  m = gor(m, H.passAttack, 'a2'); m = gor(m, H.passAttack, 'a3');
  assert.deepEqual(m.battle.defenceQueue, ['b2', 'b3', 'b1']);
  avvisa(m, H.passDefence, 'b1', {}, /inte din tur/);
  const ordning = [];
  while (m.phase === LAG_FAS.defence) { ordning.push(m.activePlayer); m = gor(m, H.passDefence, m.activePlayer); }
  assert.deepEqual(ordning, ['b2', 'b3', 'b1']);
  assert.equal(m.phase, LAG_FAS.result);
});

test('Mål vid försvar: Försegling och Barriär väljer ostoppade kort, Törnesköld en anfallare; resultatet följer lagstridens beräkning', () => {
  let m = tillStrid(6);
  const [eld] = ge(m, 'a1', 'eldklot');
  const [storm] = ge(m, 'a2', 'stormning');
  const [seal] = ge(m, 'b1', 'forsegling');
  const [bar] = ge(m, 'b2', 'barriar');
  const [torn] = ge(m, 'b3', 'torneskold');
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', { card: eld });
  m = gor(m, H.attack, 'a2', { card: storm });
  m = gor(m, H.passAttack, 'a3');
  avvisa(m, H.defend, 'b1', { card: seal }, /Välj vilket magiskt attackkort Försegling ska stoppa/);
  avvisa(m, H.defend, 'b1', { card: seal, targetCard: storm }, /Välj vilket magiskt/);
  assert.deepEqual(allowedActions(m, 'b1')[0].cards.find(c => c.instanceId === seal).cardTargets, [eld]);
  m = gor(m, H.defend, 'b1', { card: seal, targetCard: eld });
  assert.deepEqual(allowedActions(m, 'b2')[0].cards.find(c => c.instanceId === bar).cardTargets, [storm], 'redan stoppat Eldklot kan inte väljas');
  avvisa(m, H.defend, 'b2', { card: bar, targetCard: eld }, /Barriären ska stoppa/);
  m = gor(m, H.defend, 'b2', { card: bar, targetCard: storm });
  avvisa(m, H.defend, 'b3', { card: torn, targetPlayer: 'a3' }, /Törneskölden ska träffa/);
  m = gor(m, H.defend, 'b3', { card: torn, targetPlayer: 'a1' });
  const r = m.lastResult;
  assert.deepEqual([r.outcome, r.attack, r.defence, r.stopped.sort()], [OUTCOME.held, 0, 2 + 0 + 3, [eld, storm].sort()]);
  assert.deepEqual(r.lifeDelta, { a1: -1 });
  assert.equal(playerOf(m, 'a1').life, 2);
  assert.equal(m.table.length, 0, 'bordet är slängt');
  for (const id of [eld, storm, seal, bar, torn]) assert.ok(m.discardPile.includes(id));
});

test('Barriär utan ostoppat mål kan inte spelas; Försegling utan magiskt mål får inget mål men ger försvar 2', () => {
  let m = tillStrid(4);
  const [storm] = ge(m, 'a1', 'stormning');
  const [bar1] = ge(m, 'b1', 'barriar');
  const [bar2, seal] = ge(m, 'b2', 'barriar', 'forsegling');
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', { card: storm });
  m = gor(m, H.passAttack, 'a2');
  m = gor(m, H.defend, 'b1', { card: bar1, targetCard: storm });
  assert.ok(!allowedActions(m, 'b2')[0].cards.some(c => c.instanceId === bar2), 'ingen Barriär att välja när allt är stoppat');
  avvisa(m, H.defend, 'b2', { card: bar2, targetCard: storm }, /inget ostoppat attackkort/);
  avvisa(m, H.defend, 'b2', { card: seal, targetCard: storm }, /inget magiskt attackkort/);
  m = gor(m, H.defend, 'b2', { card: seal });
  assert.deepEqual([m.lastResult.attack, m.lastResult.defence, m.lastResult.outcome], [0, 2, OUTCOME.held]);
});

test('Efter striden: tomma händer fylls från nästa anfallande lags startspelare, alla bekräftar Fortsätt en gång, andra laget anfaller och målansvaret roterar (21A)', () => {
  let m = tillStrid(4);
  const [kat] = ge(m, 'a1', 'katapult');
  discardHand(m, 'b2');   // b2 lever men har tom hand
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', { card: kat });
  m = gor(m, H.passAttack, 'a2');
  assert.deepEqual(allowedActions(m, 'b1')[0], { type: H.defend, cards: allowedActions(m, 'b1')[0].cards });
  m = gor(m, H.passDefence, 'b1');
  assert.deepEqual(allowedActions(m, 'b2'), [{ type: H.defend, cards: [] }, { type: H.passDefence }], 'en tom hand kan bara avstå');
  m = gor(m, H.passDefence, 'b2');
  assert.deepEqual([m.phase, m.lastResult.outcome, playerOf(m, 'b1').life], [LAG_FAS.result, OUTCOME.hit, 2]);
  assert.equal(playerOf(m, 'b2').hand.length, 5, '22A: den tomma handen fick fem kort');
  assert.ok(m.refills.includes(1));
  assert.deepEqual(m.nextLeader, { A: 'a2', B: 'b1' });
  m = gor(m, H.next, 'a1');
  avvisa(m, H.next, 'a1', {}, /redan bekräftat/);
  m = gor(m, H.next, 'b2'); m = gor(m, H.next, 'a2');
  assert.equal(m.phase, LAG_FAS.result);
  m = gor(m, H.next, 'b1');
  assert.deepEqual([m.phase, m.battleNumber, m.attackingTeam, m.activePlayer], [LAG_FAS.target, 2, 'B', 'b1']);
  avvisa(m, H.next, 'b1', {}, /inget resultat/);
  /* Strid 2: B anfaller; strid 3: A anfaller igen och nu börjar a2. */
  m = gor(m, H.target, 'b1', { target: 'a1' });
  m = gor(m, H.attack, 'b1', { card: playerOf(m, 'b1').hand[0], usage: USAGE.simple });
  m = gor(m, H.passAttack, 'b2');
  m = gor(m, H.passDefence, 'a1'); m = gor(m, H.passDefence, 'a2');
  m = bekraftaAlla(m, H.next);
  assert.deepEqual([m.battleNumber, m.attackingTeam, m.activePlayer], [3, 'A', 'a2']);
});

test('Livsbaserad utslagning: den utslagne lämnar köer, bekräftelser och målansvar; sista tornet ger lagvinst utan påfyllning', () => {
  let m = tillStart(4);
  playerOf(m, 'b1').life = 1;
  playerOf(m, 'b2').life = 1;
  m = bekraftaAlla(m, H.confirmStart);
  const [kat] = ge(m, 'a1', 'katapult');
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', { card: kat });
  m = gor(m, H.passAttack, 'a2');
  m = gor(m, H.passDefence, 'b1'); m = gor(m, H.passDefence, 'b2');
  const b1 = playerOf(m, 'b1');
  assert.deepEqual([b1.life, b1.status, b1.hand.length, m.lastResult.eliminated], [0, PLAYER_STATUS.out, 0, ['b1']]);
  assert.deepEqual(allowedActions(m, 'b1'), []);
  avvisa(m, H.next, 'b1', {}, /utslagen/);
  m = bekraftaAlla(m, H.next);   // bara a1, a2, b2 behövs
  assert.deepEqual([m.attackingTeam, m.activePlayer], ['B', 'b2'], 'b1 hoppas över som startspelare');
  m = gor(m, H.target, 'b2', { target: 'a1' });
  assert.deepEqual(m.battle.attackQueue, ['b2']);
  avvisa(m, H.passAttack, 'b2', {}, /minst ett kort/);
  m = gor(m, H.attack, 'b2', { card: playerOf(m, 'b2').hand[0], usage: USAGE.simple });
  m = gor(m, H.passDefence, 'a1'); m = gor(m, H.passDefence, 'a2');
  m = bekraftaAlla(m, H.next);
  assert.deepEqual(allowedActions(m, m.activePlayer), [{ type: H.target, players: ['b2'] }], 'ett fallet torn kan inte väljas');
  const [kat2] = ge(m, m.activePlayer, 'katapult');
  const leader = m.activePlayer;
  m = gor(m, H.target, leader, { target: 'b2' });
  m = gor(m, H.attack, leader, { card: kat2 });
  while (m.phase === LAG_FAS.attack) m = gor(m, H.passAttack, m.activePlayer);
  assert.deepEqual(m.battle.defenceQueue, ['b2']);
  const refillsFore = [...m.refills];
  m = gor(m, H.passDefence, 'b2');
  assert.deepEqual([m.phase, m.winnerTeam, m.endReason], [LAG_FAS.over, 'A', LAG_SLUT.teamOut]);
  assert.deepEqual(m.refills, refillsFore, 'ingen påfyllning efter matchslut');
  for (const p of m.players) assert.deepEqual(allowedActions(m, p.id), []);
  avvisa(m, H.next, 'a1', {}, /avslutad/);
});

test('En motstöt kan slå ut en anfallare, som sedan hoppas över i lagets målansvar', () => {
  let m = tillStart(4);
  playerOf(m, 'a1').life = 1;
  m = bekraftaAlla(m, H.confirmStart);
  const [storm] = ge(m, 'a1', 'stormning');
  const [torn] = ge(m, 'b1', 'torneskold');
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', { card: storm });
  m = gor(m, H.passAttack, 'a2');
  m = gor(m, H.defend, 'b1', { card: torn, targetPlayer: 'a1' });
  m = gor(m, H.passDefence, 'b2');
  assert.deepEqual([m.lastResult.outcome, m.lastResult.eliminated, playerOf(m, 'a1').status], [OUTCOME.held, ['a1'], PLAYER_STATUS.out]);
  assert.equal(m.nextLeader.A, 'a2');
  m = bekraftaAlla(m, H.next);
  m = gor(m, H.target, 'b1', { target: 'a2' });
  m = gor(m, H.attack, 'b1', { card: playerOf(m, 'b1').hand[0], usage: USAGE.simple });
  m = gor(m, H.passAttack, 'b2');
  assert.deepEqual(m.battle.defenceQueue, ['a2']);
  m = gor(m, H.passDefence, 'a2');
  m = bekraftaAlla(m, H.next);
  assert.deepEqual([m.attackingTeam, m.activePlayer], ['A', 'a2']);
  assert.equal(leaderOf(m, 'A'), 'a2');
});

test('Skyddsregel: ett lag utan handkort lämnar turen till det andra; inga kort alls ger FEL utan vinnare', () => {
  let m = tillStrid(4);
  m = gor(m, H.target, 'a1', { target: 'b1' });
  m = gor(m, H.attack, 'a1', { card: playerOf(m, 'a1').hand[0], usage: USAGE.simple });
  m = gor(m, H.passAttack, 'a2');
  m = gor(m, H.passDefence, 'b1'); m = gor(m, H.passDefence, 'b2');
  /* B ska anfalla men saknar kort, och högarna är tomma (allt ligger hos a1 i provet). */
  const a1 = playerOf(m, 'a1');
  for (const id of ['b1', 'b2']) { const p = playerOf(m, id); a1.hand.push(...p.hand.splice(0)); }
  a1.hand.push(...m.drawPile.splice(0), ...m.discardPile.splice(0));
  auditTeam(m);
  const ingaKort = structuredClone(m);
  m = bekraftaAlla(m, H.next);
  assert.deepEqual([m.attackingTeam, m.activePlayer, m.battleNumber], ['A', 'a2', 2]);
  assert.ok(m.log.some(line => /Norra laget saknar handkort – turen går till Södra laget/.test(line)));
  /* Ingen har kort: allt läggs i slänghögen efter påfyllningen. */
  for (const p of ingaKort.players) ingaKort.discardPile.push(...p.hand.splice(0));
  auditTeam(ingaKort);
  let x = ingaKort;
  for (const id of ['a1', 'a2', 'b1']) x = gor(x, H.next, id);
  const r = processLag(x, { matchId: x.id, revision: x.revision, type: H.next, playerId: 'b2' });
  assert.equal(r.status, STATUS.error);
  assert.deepEqual([r.match.phase, r.match.winnerTeam], [LAG_FAS.error, null]);
  assert.match(r.match.error, /Inget lag har handkort/);
});

test('Avvisade handlingar: fel revision, okänd handling eller spelare; matchen ändras aldrig', () => {
  const m = tillStrid(4);
  assert.equal(processLag(m, { matchId: m.id, revision: m.revision - 1, type: H.target, playerId: 'a1', target: 'b1' }).message, 'Matchläget har ändrats – försök igen.');
  assert.equal(processLag(m, { matchId: 'annan', revision: m.revision, type: H.target, playerId: 'a1', target: 'b1' }).status, STATUS.rejected);
  avvisa(m, 'FUSKA', 'a1', {}, /Okänd handling/);
  avvisa(m, H.target, 'x9', { target: 'b1' }, /Okänd spelare/);
  avvisa(m, H.next, 'a1', {}, /inget resultat/);
});

/* ---- Hela matcher med slumpade val, kontrollerade mot oberoende regler ---- */
test('Hela lagmatcher 4/6/8: rätt startspelare, anfalls- och försvarsordning, högst ett kort per person, bidrag, inga dubbla övergångar, en vinnare', () => {
  for (const size of [4, 6, 8]) {
    for (const seed of [1, 2, 3, 4]) {
      const random = styrdSlump(seed * 17 + size);
      const pick = list => list[Math.floor(random() * list.length)];
      let m = newLagmatch({ matchId: `h${size}-${seed}`, players: spelare(size), random });
      const prevLeader = { A: null, B: null };
      const dead = new Set();
      let battles = 0, steps = 0;
      while (m.phase !== LAG_FAS.over) {
        assert.ok(++steps < 30000, `${size}/${seed}: matchen tog aldrig slut`);
        const actors = m.players.filter(p => allowedActions(m, p.id).length);
        assert.ok(actors.length, `${size}/${seed}: ingen kan agera i fas ${m.phase}`);
        const p = pick(actors);
        assert.ok(!dead.has(p.id), 'en utslagen spelare agerar aldrig');
        const acts = allowedActions(m, p.id);
        let a = pick(acts);
        let action = { type: a.type };
        if (a.type === H.swap) action.cards = a.cards.filter(() => random() < 0.2).slice(0, a.maxCards).map(c => c.instanceId);
        if (a.type === H.target) action.target = pick(a.players);
        if (a.type === H.attack) action = a.normal.length && random() < 0.7 ? { type: a.type, card: pick(a.normal).instanceId } : { type: a.type, card: pick(a.simple).instanceId, usage: USAGE.simple };
        if (a.type === H.defend) {
          if (a.cards.length && random() < 0.75) { const c = pick(a.cards); action = { type: a.type, card: c.instanceId, targetCard: c.cardTargets?.length ? pick(c.cardTargets) : null, targetPlayer: c.playerTargets?.length ? pick(c.playerTargets) : null }; }
          else action = { type: H.passDefence };
        }
        const before = m;
        const r = processLag(m, { ...action, matchId: m.id, revision: m.revision, playerId: p.id }, random);
        assert.equal(r.status, STATUS.ok, `${size}/${seed} ${action.type} ${p.id}: ${r.message}`);
        assert.equal(r.match.revision, before.revision + 1);
        m = r.match;
        /* Ny strid: rätt startspelare enligt 21A, oberoende beräknad. */
        if (m.battleNumber > before.battleNumber) {
          const b = m.battle, team = b.attackingTeam;
          const levande = new Set(Object.keys(b.startLife));
          if (prevLeader[team]) {
            const order = m.teams[team], i = order.indexOf(prevLeader[team]);
            const efter = [...order.slice(i + 1), ...order.slice(0, i + 1)];
            assert.equal(b.leader, efter.find(id => levande.has(id)), `${size}/${seed}: fel startspelare i strid ${b.number}`);
          } else assert.equal(b.leader, m.teams[team][0]);
          prevLeader[team] = b.leader;
        }
        /* Avgjord strid: kontrollera turerna och bordet. */
        if (m.lastResult && m.lastResult.battleNumber !== before.lastResult?.battleNumber) {
          battles++;
          const r2 = m.lastResult, att = r2.attackingTeam, def = att === 'A' ? 'B' : 'A';
          const levande = new Set(Object.keys(r2.startLife));
          const ids = r2.table.map(e => e.playerId);
          assert.equal(new Set(ids).size, ids.length, 'högst ett kort per person');
          assert.ok(r2.table.some(e => e.role === 'attack'), 'laget bidrog med minst ett kort');
          const order = m.teams[def], t = order.indexOf(r2.target);
          const forvantad = [...order.slice(t), ...order.slice(0, t)].filter(id => levande.has(id));
          assert.deepEqual(r2.turns.filter(x => x.role === 'defence').map(x => x.playerId), forvantad, 'måltavlan först, sedan lagkamrater i ordning');
          const aOrder = m.teams[att], l = aOrder.indexOf(r2.leader);
          const anfall = r2.turns.filter(x => x.role === 'attack').map(x => x.playerId);
          const rot = [...aOrder.slice(l), ...aOrder.slice(0, l)];
          assert.deepEqual(anfall, rot.filter(id => anfall.includes(id)), 'anfallskön följer lagets ordning från startspelaren');
          for (const id of r2.eliminated) dead.add(id);
        }
        for (const q of m.players) assert.ok(q.life >= 0 && q.life <= 3 && (q.status === PLAYER_STATUS.alive) === !dead.has(q.id));
      }
      assert.ok(['A', 'B'].includes(m.winnerTeam));
      assert.ok(m.players.some(q => q.teamId === m.winnerTeam && isAlive(q)));
      assert.ok(m.players.filter(q => q.teamId !== m.winnerTeam).every(q => !isAlive(q)));
      assert.equal(battles, m.battleNumber - (m.phase === LAG_FAS.over ? 0 : 1), 'varje avgjord strid kontrollerades exakt en gång');
      assert.ok(battles > 5, `${size}/${seed}: ${battles} strider`);
      auditTeam(m);
    }
  }
});

test('Granskning L12: namn från objektets prototyp är inga handlingar', () => {
  const m = tillStrid(4);
  for (const type of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) avvisa(m, type, 'a1', {}, /Okänd handling/);
});
