import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oppnaLagring } from './lagring.js';
import { skapaSessioner, SESSION_TTL_MS } from './session.js';
import { skapaTjanst } from './tjanst.js';
import { skapaRumshantering } from './rum.js';
import { skapaDuell, DUELL_EVENT } from './duell.js';
import { PHASE, ACTION } from '../match.js';
import { EVENT } from '../lokalmatch.js';
import { ACTIVITY, LOBBY_COMMAND, MATCH_COMMAND, MATCH_STATUS, PROTOCOL_VERSION, RECEIPT, ROOM, validatePrivateView, assertNoSecrets } from '../kontrakt.js';
import { styrdKlocka, styrdSlump } from '../teststod.js';
import { STADNING_ALDER_MS } from './rum.js';

/* Två testklienter: en lobby med rum, lag och start, sedan matchkommandon via tjänsten. */
async function setup({ seed = 11 } = {}) {
  const klocka = styrdKlocka(1_000_000);
  const lagring = oppnaLagring({ path: ':memory:', klocka });
  const tjanst = skapaTjanst({ lagring, klocka, slump: styrdSlump(seed) });
  const sessioner = skapaSessioner({ lagring, klocka });
  const rum = skapaRumshantering({ lagring, klocka, ko: tjanst.ko });
  const duell = skapaDuell({ lagring, klocka, rum });
  sessioner.registrera(tjanst); rum.registrera(tjanst); duell.registrera(tjanst);
  let n = 0;
  const cmd = (playerId, type, extra = {}, commandId = `c${++n}`) => tjanst.kommando(playerId, { protocolVersion: PROTOCOL_VERSION, commandId, type, payload: {}, ...extra });
  const gast = nick => { const { session } = sessioner.skapa(nick); sessioner.anslut(session.playerId); return session.playerId; };
  const anna = gast('Anna'), bo = gast('Bo');
  const roomId = rum.skapa(anna).id;
  rum.bjudIn(anna, roomId, [bo]);
  rum.acceptera(bo, rum.vyFor(bo).inbjudningar.inkommande[0].id);
  rum.valjLag(anna, roomId, 'A'); rum.valjLag(bo, roomId, 'B');
  const v = lagring.hamtaRum(roomId).rosterVersion;
  rum.redo(anna, roomId, true, v); rum.redo(bo, roomId, true, v);
  const start = await cmd(anna, LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: v } });
  assert.equal(start.status, RECEIPT.ok, start.message);
  const matchId = lagring.hamtaRum(roomId).matchId;
  const view = id => duell.matchFor(id).view;
  /* Matchkommando med spelarens aktuella revision. */
  const spela = (id, type, payload = {}, commandId) => cmd(id, type, { matchId, revision: view(id).revision, payload }, commandId);
  return { klocka, lagring, tjanst, sessioner, rum, duell, cmd, spela, view, anna, bo, roomId, matchId };
}

test('Städning frigör kvarvarande resultatspelare men lämnar nya medlemskap och historik intakta', async () => {
  const { lagring, klocka, rum, duell, spela, anna, bo, roomId, matchId } = await setup();
  try {
    assert.equal((await spela(anna, MATCH_COMMAND.surrender)).status, RECEIPT.ok);
    rum.lamna(bo, roomId);
    // Bo ansluter till en ny match innan det gamla resultatet städas.
    const ny = { ...lagring.hamtaSession(bo), activity: ACTIVITY.playing, roomId: 'nytt-rum', matchId: 'ny-match' };
    lagring.sparaSession(ny);
    klocka.advance(STADNING_ALDER_MS + 1);
    await new Promise(setImmediate);
    assert.equal(rum.stada().raderade, 1);
    const a = lagring.hamtaSession(anna);
    assert.equal(a.activity, ACTIVITY.idle);
    assert.equal(a.roomId, null);
    assert.equal(a.matchId, null);
    assert.equal(duell.matchFor(anna), null);
    assert.equal(rum.vyFor(anna).rum, null);
    assert.deepEqual(lagring.hamtaSession(bo), ny);
    assert.ok(lagring.hamtaMatch(matchId), 'matchhistoriken finns kvar');
    /* Över en timme utan aktivitet: sessionerna hade gått ut (5 min) – återuppliva dem som om spelarna kommit tillbaka. */
    for (const id of [anna, bo]) lagring.sparaSession({ ...lagring.hamtaSession(id), lastSeenAt: klocka.now(), expiresAt: klocka.now() + SESSION_TTL_MS });
    const nyttRum = rum.skapa(anna);
    assert.equal(lagring.hamtaSession(anna).roomId, nyttRum.id);
    rum.lamna(anna, nyttRum.id);
    lagring.sparaSession({ ...ny, activity: ACTIVITY.idle, roomId: null, matchId: null, lastSeenAt: klocka.now(), expiresAt: klocka.now() + SESSION_TTL_MS });
    const bosRum = rum.skapa(bo);
    rum.bjudIn(bo, bosRum.id, [anna]);
    assert.equal(rum.vyFor(anna).inbjudningar.inkommande.length, 1);
  } finally { lagring.stang(); }
});

test('Starten skapar en duell med platser från lagvalet; vyerna är privata och kontraktsenliga', async () => {
  const { lagring, view, anna, bo, matchId, duell } = await setup();
  const rad = lagring.hamtaMatch(matchId);
  assert.equal(rad.status, MATCH_STATUS.active);
  assert.deepEqual(rad.match.seats, { A: anna, B: bo });
  assert.equal(rad.match.engine.players[0].name, 'Anna');
  const va = validatePrivateView(view(anna)), vb = validatePrivateView(view(bo));
  assert.equal(va.mySeat, 'A'); assert.equal(vb.mySeat, 'B');
  assert.equal(va.me.hand.length, 10);
  assert.ok(vb.me.hand.every(c => !JSON.stringify(va).includes(`"${c.instanceId}"`)), 'Bos exemplar syns inte i Annas vy');
  assert.throws(() => assertNoSecrets(va, 'B'), /hand/);
  assert.equal(lagring.hamtaSession(anna).activity, ACTIVITY.playing);
  assert.equal(duell.matchFor('p-okand'), null);
});

test('Fel tur, främmande kort och påstådd identitet avvisas; motorn ändras inte', async () => {
  const { spela, view, lagring, anna, bo, matchId, cmd } = await setup();
  const fore = lagring.hamtaMatch(matchId).match.engine.revision;
  const felTur = await spela(bo, MATCH_COMMAND.swap, { cards: [] });
  assert.equal(felTur.status, RECEIPT.rejected);
  assert.match(felTur.message, /inte din tur/);
  const bosKort = view(bo).me.hand[0].instanceId;
  const frammande = await spela(anna, MATCH_COMMAND.swap, { cards: [bosKort] });
  assert.equal(frammande.status, RECEIPT.rejected);
  assert.match(frammande.message, /finns inte på din hand/);
  const annanMatch = await cmd(anna, MATCH_COMMAND.swap, { matchId: 'm-finns-inte', revision: 0, payload: { cards: [] } });
  assert.match(annanMatch.message, /finns inte/);
  const gammal = await cmd(anna, MATCH_COMMAND.swap, { matchId, revision: 99, payload: { cards: [] } });
  assert.match(gammal.message, /ändrats/);
  assert.equal(lagring.hamtaMatch(matchId).match.engine.revision, fore);
  const { anna: annan } = await setup({ seed: 5 });
  const utanfor = await cmd(annan, MATCH_COMMAND.swap, { matchId, revision: fore, payload: { cards: [] } });
  assert.match(utanfor.message, /deltar inte/);
});

test('Samma kommando får effekt en gång; samma ID med annat innehåll avvisas; lagringsfel lämnar inget godkänt osparat drag', async () => {
  const { spela, view, lagring, anna, bo, matchId, cmd, tjanst } = await setup();
  const first = await cmd(anna, MATCH_COMMAND.swap, { matchId, revision: 0, payload: { cards: [] } }, 'dubbel');
  assert.equal(first.status, RECEIPT.ok);
  assert.equal(first.revision, 1);
  const again = await cmd(anna, MATCH_COMMAND.swap, { matchId, revision: 0, payload: { cards: [] } }, 'dubbel');
  assert.deepEqual(again, first, 'identiskt kommando ger samma kvittens');
  assert.equal(lagring.hamtaMatch(matchId).match.engine.revision, 1, 'effekten inträffade en gång');
  const changed = await cmd(anna, MATCH_COMMAND.swap, { matchId, revision: 1, payload: { cards: [] } }, 'dubbel');
  assert.equal(changed.status, RECEIPT.rejected);
  assert.match(changed.message, /annat innehåll/);
  /* Lagringsfel: nästa händelse-ID är redan upptaget i databasen när Bo byter */
  const post = lagring.hamtaMatch(matchId).match;
  lagring.sparaHandelser([{ eventId: post.lastEventId + 1, matchId, revision: 0, type: 'KROCK', at: 0, recipient: null, data: {} }]);
  const krock = await spela(bo, MATCH_COMMAND.swap, { cards: [] }, 'bo-byte');
  assert.equal(krock.status, RECEIPT.error);
  assert.equal(lagring.hamtaMatch(matchId).match.engine.revision, 1, 'draget sparades inte');
  assert.equal(tjanst.status(bo, `match:${matchId}`, 'bo-byte').status, RECEIPT.unknown, 'ingen kvittens för det osparade draget');
  assert.equal(view(bo).me.hand.length, 10);
});

test('En hel duell styrs av två testklienter med start- och Fortsätt-bekräftelser; matchslut stänger rummet', async () => {
  const { spela, view, lagring, anna, bo, matchId, roomId, cmd, sessioner } = await setup({ seed: 3 });
  const seatOf = { A: anna, B: bo };
  const spelare = seat => seatOf[seat];
  let steps = 0;
  const events = [];
  while (steps++ < 500) {
    const va = view(anna);
    if (va.phase === PHASE.over) break;
    if (va.confirm) {
      /* Båda bekräftar; den ena i förväg, den andra avgör. Fallet torn ska inte behöva bekräfta (ej i duell). */
      const kind = va.confirm.kind;
      for (const seat of va.confirm.waitingFor) {
        const r = await spela(spelare(seat), kind);
        assert.equal(r.status, RECEIPT.ok, `${kind} ${seat}: ${r.message}`);
      }
      continue;
    }
    const seat = va.activePlayer;
    const me = view(spelare(seat));
    const allowed = me.allowed.map(a => a.type);
    let r;
    if (allowed.includes(ACTION.swap)) r = await spela(spelare(seat), MATCH_COMMAND.swap, { cards: me.me.hand.slice(0, 2).map(c => c.instanceId) });
    else if (allowed.includes(ACTION.attack)) { const a = me.allowed.find(x => x.type === ACTION.attack); r = a.normal.length ? await spela(spelare(seat), MATCH_COMMAND.attack, { instanceId: a.normal[0].instanceId }) : await spela(spelare(seat), MATCH_COMMAND.attack, { instanceId: a.simple[0].instanceId, usage: 'simple' }); }
    else if (allowed.includes(ACTION.defend)) { const d = me.allowed.find(x => x.type === ACTION.defend); r = d.cards.length ? await spela(spelare(seat), MATCH_COMMAND.defend, { instanceId: d.cards[0].instanceId }) : await spela(spelare(seat), MATCH_COMMAND.pass); }
    else throw new Error(`Inget tillåtet val för ${seat} i fas ${me.phase}: ${allowed}`);
    assert.equal(r.status, RECEIPT.ok, r.message);
    assert.ok(!allowed.includes(ACTION.next), 'motorns FORTSÄTT erbjuds aldrig direkt');
  }
  const slut = view(anna);
  assert.equal(slut.phase, PHASE.over);
  assert.ok(['A', 'B'].includes(slut.winner));
  const rad = lagring.hamtaMatch(matchId);
  assert.equal(rad.status, MATCH_STATUS.finished);
  assert.equal(lagring.hamtaRum(roomId).status, ROOM.closed);
  assert.equal(lagring.hamtaSession(anna).activity, ACTIVITY.finished);
  const alla = lagring.hamtaHandelser(matchId);
  assert.deepEqual(alla.map(e => e.eventId), alla.map((_, i) => i + 1), 'händelser utan luckor');
  const typer = new Set(alla.map(e => e.type));
  for (const t of [EVENT.swap, EVENT.firstAttacker, DUELL_EVENT.confirm, EVENT.cardPlayed, EVENT.result, EVENT.next, EVENT.matchOver]) assert.ok(typer.has(t), t);
  for (const e of alla) assertNoSecrets(e);
  const efter = await spela(anna, MATCH_COMMAND.surrender);
  assert.match(efter.message, /avslutad/);
  /* Tillbaka till lobbyn */
  const lamna = await cmd(anna, LOBBY_COMMAND.leave, { roomId });
  assert.equal(lamna.status, RECEIPT.ok, lamna.message);
  assert.equal(lagring.hamtaSession(anna).activity, ACTIVITY.idle);
  assert.equal(lagring.hamtaSession(anna).matchId, null);
  assert.equal(sessioner.lobbylista().find(p => p.playerId === anna).activity, ACTIVITY.idle);
});

test('Startbekräftelse: ingen kan anfalla förrän båda bekräftat; den som bekräftat ser vem som saknas', async () => {
  const { spela, view, anna, bo } = await setup({ seed: 8 });
  /* Fyra bekräftelser av byten (två omgångar var) tar matchen till anfallsfasen. */
  for (let i = 0; i < 4; i++) { const seat = view(anna).activePlayer; const r = await spela(seat === 'A' ? anna : bo, MATCH_COMMAND.swap, { cards: [] }); assert.equal(r.status, RECEIPT.ok, r.message); }
  const va = view(anna);
  assert.equal(va.phase, PHASE.attack);
  assert.equal(va.confirm.kind, MATCH_COMMAND.confirmStart);
  assert.deepEqual(va.allowed.map(a => a.type).sort(), [MATCH_COMMAND.confirmStart, ACTION.surrender].sort());
  const forst = va.activePlayer === 'A' ? anna : bo;
  const forTidigt = await spela(forst, MATCH_COMMAND.attack, { instanceId: view(forst).me.hand[0].instanceId });
  assert.match(forTidigt.message, /Bekräfta starten/);
  const bekraftad = await spela(anna, MATCH_COMMAND.confirmStart);
  assert.equal(bekraftad.status, RECEIPT.ok);
  assert.deepEqual(view(anna).confirm, { kind: MATCH_COMMAND.confirmStart, confirmed: ['A'], waitingFor: ['B'], mine: true });
  assert.ok(!view(anna).allowed.some(a => a.type === MATCH_COMMAND.confirmStart), 'Anna kan inte bekräfta två gånger');
  const igen = await spela(anna, MATCH_COMMAND.confirmStart);
  assert.equal(igen.status, RECEIPT.ok, 'en upprepad bekräftelse är ofarlig');
  assert.equal(view(anna).revision, va.revision, 'bekräftelser ändrar inte matchrevisionen');
  await spela(bo, MATCH_COMMAND.confirmStart);
  assert.equal(view(anna).confirm, null);
  assert.ok(view(forst).allowed.some(a => a.type === ACTION.attack));
});

test('Två samtidiga Fortsätt ger exakt en övergång', async () => {
  const { spela, view, lagring, anna, bo, matchId } = await setup({ seed: 21 });
  const seatOf = { A: anna, B: bo };
  /* Spela fram till första resultatet */
  for (let i = 0; i < 4; i++) await spela(seatOf[view(anna).activePlayer], MATCH_COMMAND.swap, { cards: [] });
  await spela(anna, MATCH_COMMAND.confirmStart); await spela(bo, MATCH_COMMAND.confirmStart);
  const attacker = view(anna).activePlayer, defender = attacker === 'A' ? 'B' : 'A';
  const a = view(seatOf[attacker]).allowed.find(x => x.type === ACTION.attack);
  await spela(seatOf[attacker], MATCH_COMMAND.attack, a.normal.length ? { instanceId: a.normal[0].instanceId } : { instanceId: a.simple[0].instanceId, usage: 'simple' });
  await spela(seatOf[defender], MATCH_COMMAND.pass);
  const res = view(anna);
  assert.equal(res.phase, PHASE.result);
  assert.equal(res.confirm.kind, MATCH_COMMAND.next);
  const battle = res.battleNumber;
  const [ra, rb] = await Promise.all([spela(anna, MATCH_COMMAND.next), spela(bo, MATCH_COMMAND.next)]);
  assert.equal(ra.status, RECEIPT.ok); assert.equal(rb.status, RECEIPT.ok);
  const efter = view(anna);
  assert.equal(efter.phase, PHASE.attack);
  assert.equal(efter.battleNumber, battle + 1, 'exakt en ny strid');
  assert.equal(lagring.hamtaHandelser(matchId).filter(e => e.type === EVENT.next).length, 1, 'motorns FORTSÄTT kördes en gång');
  const sen = await spela(bo, MATCH_COMMAND.next);
  assert.match(sen.message, /inget resultat/);
});
