import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oppnaLagring } from './lagring.js';
import { skapaSessioner, SESSION_TTL_MS } from './session.js';
import { skapaTjanst } from './tjanst.js';
import { skapaRumshantering, RumsFel, INBJUDAN_TTL_MS, AVBOJ_KARENS_MS, INBJUDAN_MIN_INTERVALL_MS, FRANKOPPLAD_FRIST_MS, INAKTIVT_RUM_MS, STADNING_ALDER_MS } from './rum.js';
import { ACTIVITY, CONNECTION, INVITATION, ROOM, LOBBY_COMMAND, PROTOCOL_VERSION, RECEIPT } from '../kontrakt.js';
import { styrdKlocka } from '../teststod.js';

function setup() {
  const klocka = styrdKlocka(1_000_000);
  const lagring = oppnaLagring({ path: ':memory:', klocka });
  const tjanst = skapaTjanst({ lagring, klocka });
  const sessioner = skapaSessioner({ lagring, klocka });
  const rum = skapaRumshantering({ lagring, klocka, ko: tjanst.ko });
  sessioner.registrera(tjanst); rum.registrera(tjanst);
  let andringar = 0; rum.pa(() => { andringar += 1; });
  const gast = (nick, { ansluten = true } = {}) => { const { session } = sessioner.skapa(nick); if (ansluten) sessioner.anslut(session.playerId); return session.playerId; };
  let n = 0;
  const cmd = (playerId, type, extra = {}, commandId = `c${++n}`) => tjanst.kommando(playerId, { protocolVersion: PROTOCOL_VERSION, commandId, type, payload: {}, ...extra });
  const session = id => lagring.hamtaSession(id);
  const inkommande = id => rum.vyFor(id).inbjudningar.inkommande;
  return { klocka, lagring, tjanst, sessioner, rum, gast, cmd, session, inkommande, andringar: () => andringar };
}
const fel = (fn, pattern) => assert.throws(fn, error => error instanceof RumsFel && pattern.test(error.message), `väntade RumsFel ${pattern}`);

test('Skapa rum: värden blir enda deltagare, sessionen är I_RUM, och ett andra rum avvisas; dubbelklick ger ett rum', async () => {
  const { rum, gast, cmd, session, lagring } = setup();
  const anna = gast('Anna');
  const forsta = await cmd(anna, LOBBY_COMMAND.createRoom, {}, 'dubbel');
  assert.equal(forsta.status, RECEIPT.ok);
  const igen = await cmd(anna, LOBBY_COMMAND.createRoom, {}, 'dubbel');
  assert.deepEqual(igen, forsta, 'samma commandId ger samma kvittens');
  assert.equal(lagring.listaRum(ROOM.preparing).length, 1);
  const { rum: r } = rum.vyFor(anna);
  assert.equal(r.hostPlayerId, anna);
  assert.deepEqual(r.players.map(p => [p.nick, p.teamId, p.ready, p.connection]), [['Anna', null, false, CONNECTION.online]]);
  assert.equal(session(anna).activity, ACTIVITY.inRoom);
  assert.equal(session(anna).roomId, r.id);
  const annat = await cmd(anna, LOBBY_COMMAND.createRoom);
  assert.equal(annat.status, RECEIPT.rejected);
  assert.match(annat.message, /redan i ett rum/);
});

test('Bjud in: bara värden, bara lediga anslutna andra, dedup, platsgräns och frekvensgräns', async () => {
  const { rum, gast, cmd, klocka, lagring } = setup();
  const anna = gast('Anna'), bo = gast('Bo'), cy = gast('Cy', { ansluten: false }), dan = gast('Dan');
  const roomId = rum.skapa(anna).id;
  rum.skapa(dan);
  fel(() => rum.bjudIn(bo, roomId, [anna]), /Bara värden/);
  const r = rum.bjudIn(anna, roomId, [bo, bo, anna, cy, dan, 'p-finnsinte']);
  assert.deepEqual(r.inbjudna.map(i => i.nick), ['Bo']);
  assert.deepEqual(r.hoppade.map(h => `${h.nick ?? h.playerId}: ${h.reason}`), ['Anna: Det är du själv.', 'Cy: Spelaren är inte ansluten.', 'Dan: Spelaren är redan i ett rum eller en match.', 'p-finnsinte: Spelaren finns inte i lobbyn.']);
  assert.equal(rum.vyFor(bo).inbjudningar.inkommande[0].from.nick, 'Anna');
  assert.equal(rum.vyFor(anna).inbjudningar.utgaende[0].to.nick, 'Bo');
  fel(() => rum.bjudIn(anna, roomId, [bo]), /Vänta en stund/);
  klocka.advance(INBJUDAN_MIN_INTERVALL_MS);
  fel(() => rum.bjudIn(anna, roomId, [bo]), /redan inbjuden/);
  klocka.advance(INBJUDAN_MIN_INTERVALL_MS);
  const manga = Array.from({ length: 8 }, (_, i) => gast(`G${i}`));
  const r2 = rum.bjudIn(anna, roomId, manga);
  assert.equal(r2.inbjudna.length, 6, '1 deltagare + 1 öppen + 6 nya = 8');
  assert.equal(r2.hoppade.length, 2);
  assert.match(r2.hoppade[0].reason, /inte plats/);
  assert.equal(lagring.listaInbjudningar({ roomId, status: INVITATION.pending }).length, 7);
  const kvitto = await cmd(bo, LOBBY_COMMAND.invite, { roomId, payload: { playerIds: [cy] } });
  assert.equal(kvitto.status, RECEIPT.rejected);
});

test('1B: första acceptansen lämnar övrigas inbjudningar öppna; alla hamnar i samma rum; dubbelklick ger inte dubbla deltagare', async () => {
  const { rum, gast, cmd, inkommande, lagring } = setup();
  const anna = gast('Anna'), bo = gast('Bo'), cy = gast('Cy');
  const roomId = rum.skapa(anna).id;
  rum.bjudIn(anna, roomId, [bo, cy]);
  const invBo = inkommande(bo)[0].id, invCy = inkommande(cy)[0].id;
  const a1 = await cmd(bo, LOBBY_COMMAND.accept, { payload: { invitationId: invBo } }, 'bo-acc');
  assert.equal(a1.status, RECEIPT.ok);
  assert.equal(inkommande(cy).length, 1, 'Cys inbjudan är fortfarande öppen');
  assert.deepEqual(await cmd(bo, LOBBY_COMMAND.accept, { payload: { invitationId: invBo } }, 'bo-acc'), a1, 'dubbelklick: samma kvittens');
  const igen = await cmd(bo, LOBBY_COMMAND.accept, { payload: { invitationId: invBo } });
  assert.equal(igen.status, RECEIPT.rejected);
  assert.match(igen.message, /redan accepterad|redan i ett rum/);
  await cmd(cy, LOBBY_COMMAND.accept, { payload: { invitationId: invCy } });
  const r = lagring.hamtaRum(roomId);
  assert.deepEqual(r.players.map(p => p.nick), ['Anna', 'Bo', 'Cy']);
  assert.equal(r.players.filter(p => p.playerId === bo).length, 1);
  assert.equal(r.rosterVersion, 2);
  assert.ok(r.players.every(p => !p.ready));
  assert.equal(lagring.hamtaSession(cy).roomId, roomId);
});

test('Samtidig acceptans av två rum ger exakt ett medlemskap, och den andra inbjudan stängs', async () => {
  const { rum, gast, cmd, inkommande, lagring, klocka } = setup();
  const anna = gast('Anna'), bo = gast('Bo'), cy = gast('Cy');
  const rumA = rum.skapa(anna).id, rumB = rum.skapa(bo).id;
  rum.bjudIn(anna, rumA, [cy]);
  klocka.advance(INBJUDAN_MIN_INTERVALL_MS);
  rum.bjudIn(bo, rumB, [cy]);
  const [invA, invB] = inkommande(cy).map(i => i.id);
  const [svarA, svarB] = await Promise.all([
    cmd(cy, LOBBY_COMMAND.accept, { payload: { invitationId: invA } }),
    cmd(cy, LOBBY_COMMAND.accept, { payload: { invitationId: invB } })
  ]);
  assert.deepEqual([svarA.status, svarB.status], [RECEIPT.ok, RECEIPT.rejected]);
  assert.match(svarB.message, /gått ut|redan i ett rum/);
  assert.equal(lagring.hamtaRum(rumA).players.length, 2);
  assert.equal(lagring.hamtaRum(rumB).players.length, 1);
  assert.equal(lagring.hamtaInbjudan(invB).status, INVITATION.expired);
  assert.equal(inkommande(cy).length, 0);
});

test('Fullt rum, stängt/startat rum och utgången inbjudan ger begripliga svar', () => {
  const { rum, gast, inkommande, lagring, klocka } = setup();
  const anna = gast('Anna');
  const roomId = rum.skapa(anna).id;
  const gaster = Array.from({ length: 7 }, (_, i) => gast(`G${i}`));
  const sen = gast('Sen');
  rum.bjudIn(anna, roomId, [...gaster, sen]);
  assert.equal(inkommande(sen).length, 0, 'ingen plats för en åttonde inbjudan när värden räknas');
  for (const g of gaster) rum.acceptera(g, inkommande(g)[0].id);
  assert.equal(lagring.hamtaRum(roomId).players.length, 8);
  const extra = gast('Extra');
  const inv = { id: 'i-manuell', roomId, fromPlayerId: anna, toPlayerId: extra, status: INVITATION.pending, expiresAt: klocka.now() + 1000 };
  lagring.sparaInbjudan(inv);
  fel(() => rum.acceptera(extra, inv.id), /Rummet är fullt/);
  klocka.advance(1000);
  fel(() => rum.acceptera(extra, inv.id), /gått ut/);
  assert.equal(rum.markeraUtgangna(), 1, 'avvisningen rullade tillbaka markeringen; timern/vyn markerar den');
  assert.equal(lagring.hamtaInbjudan(inv.id).status, INVITATION.expired);
  const room = lagring.hamtaRum(roomId); room.status = ROOM.started; lagring.sparaRum(room);
  lagring.sparaInbjudan({ ...inv, id: 'i-manuell2', status: INVITATION.pending, expiresAt: klocka.now() + 1000 });
  fel(() => rum.acceptera(extra, 'i-manuell2'), /Matchen har startat/);
  room.status = ROOM.closed; room.players = []; lagring.sparaRum(room);
  fel(() => rum.acceptera(extra, 'i-manuell2'), /Rummet är stängt/);
  fel(() => rum.acceptera(anna, 'i-manuell2'), /finns inte/);
});

test('Avböja, återkalla och utgång via klockan; karens efter avböjande', async () => {
  const { rum, gast, inkommande, lagring, klocka, andringar } = setup();
  const anna = gast('Anna'), bo = gast('Bo'), cy = gast('Cy');
  const roomId = rum.skapa(anna).id;
  rum.bjudIn(anna, roomId, [bo, cy]);
  const invBo = inkommande(bo)[0].id, invCy = inkommande(cy)[0].id;
  rum.avboj(bo, invBo);
  assert.equal(lagring.hamtaInbjudan(invBo).status, INVITATION.declined);
  fel(() => rum.avboj(bo, invBo), /inte längre öppen/);
  fel(() => rum.acceptera(bo, invBo), /avböjd/);
  klocka.advance(INBJUDAN_MIN_INTERVALL_MS);
  fel(() => rum.bjudIn(anna, roomId, [bo]), /avböjde nyss/);
  fel(() => rum.aterkalla(bo, invCy), /finns inte/);
  rum.aterkalla(anna, invCy);
  assert.equal(lagring.hamtaInbjudan(invCy).status, INVITATION.revoked);
  fel(() => rum.acceptera(cy, invCy), /återkallats/);
  klocka.advance(AVBOJ_KARENS_MS);
  const r = rum.bjudIn(anna, roomId, [bo, cy]);
  assert.equal(r.inbjudna.length, 2);
  klocka.advance(INBJUDAN_TTL_MS - 1);
  assert.equal(inkommande(bo).length, 1);
  klocka.advance(1);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(inkommande(bo).length, 0, 'inbjudan löpte ut utan kommando');
  assert.equal(lagring.listaInbjudningar({ roomId, status: INVITATION.expired }).length, 2);
  assert.equal(andringar(), 1, 'servern meddelades en gång om de utgångna');
  fel(() => rum.acceptera(cy, r.inbjudna[1].id), /gått ut/);
});

test('Lämna: deltagare tas bort, Redo nollställs, värdskap går till längst anslutna, tomt rum stängs', async () => {
  const { rum, gast, cmd, inkommande, lagring, session } = setup();
  const anna = gast('Anna'), bo = gast('Bo'), cy = gast('Cy'), dan = gast('Dan');
  const roomId = rum.skapa(anna).id;
  rum.bjudIn(anna, roomId, [bo, cy, dan]);
  rum.acceptera(bo, inkommande(bo)[0].id);
  rum.acceptera(cy, inkommande(cy)[0].id);
  let r = lagring.hamtaRum(roomId);
  r.players.forEach(p => { p.ready = true; p.readyRosterVersion = r.rosterVersion; }); lagring.sparaRum(r);
  fel(() => rum.lamna(dan, roomId), /inte med i rummet/);
  const bort = await cmd(cy, LOBBY_COMMAND.leave, { roomId });
  assert.equal(bort.status, RECEIPT.ok);
  r = lagring.hamtaRum(roomId);
  assert.deepEqual(r.players.map(p => p.nick), ['Anna', 'Bo']);
  assert.ok(r.players.every(p => !p.ready && p.readyRosterVersion === null));
  assert.equal(session(cy).activity, ACTIVITY.idle);
  assert.equal(session(cy).roomId, null);
  rum.lamna(anna, roomId);
  r = lagring.hamtaRum(roomId);
  assert.equal(r.hostPlayerId, bo, '25A: längst anslutna tar över');
  assert.equal(inkommande(dan).length, 1, 'Dans inbjudan lever kvar under ny värd');
  rum.lamna(bo, roomId);
  r = lagring.hamtaRum(roomId);
  assert.equal(r.status, ROOM.closed);
  assert.equal(r.players.length, 0);
  assert.equal(inkommande(dan).length, 0, 'tomt rum återkallar sina inbjudningar');
  assert.equal(rum.skapa(bo).hostPlayerId, bo, 'efter att ha lämnat kan man skapa ett nytt rum');
});

test('Frånkoppling före start: markeras i rummet, återanslutning inom fristen avbryter, annars tas spelaren bort', async () => {
  const { rum, gast, inkommande, lagring, klocka, sessioner, andringar } = setup();
  const anna = gast('Anna'), bo = gast('Bo');
  const roomId = rum.skapa(anna).id;
  rum.bjudIn(anna, roomId, [bo]);
  rum.acceptera(bo, inkommande(bo)[0].id);
  const g = sessioner.anslut(bo);
  sessioner.kopplaFran(bo, g);
  assert.equal(rum.markeraAnslutning(bo, CONNECTION.offline).players[1].connection, CONNECTION.offline);
  assert.equal(rum.markeraAnslutning(bo, CONNECTION.offline), null, 'oförändrat läge ger ingen ny revision');
  klocka.advance(FRANKOPPLAD_FRIST_MS - 1);
  sessioner.anslut(bo);
  rum.markeraAnslutning(bo, CONNECTION.online);
  klocka.advance(FRANKOPPLAD_FRIST_MS);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(lagring.hamtaRum(roomId).players.length, 2, 'återanslutning hann före fristen');
  sessioner.kopplaFran(bo, lagring.hamtaSession(bo).connectionGeneration);
  rum.markeraAnslutning(bo, CONNECTION.offline);
  klocka.advance(FRANKOPPLAD_FRIST_MS);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(lagring.hamtaRum(roomId).players.map(p => p.nick), ['Anna']);
  assert.equal(lagring.hamtaSession(bo).activity, ACTIVITY.idle);
  assert.equal(andringar(), 1);
  assert.equal(rum.timers(), 0);
});

test('Städning: inaktivt rum stängs och gamla rum/inbjudningar raderas; omstart planerar om öppna inbjudningar', async () => {
  const { rum, gast, inkommande, lagring, klocka, tjanst } = setup();
  const anna = gast('Anna'), bo = gast('Bo');
  const roomId = rum.skapa(anna).id;
  rum.bjudIn(anna, roomId, [bo]);
  klocka.advance(INAKTIVT_RUM_MS + 1);
  assert.deepEqual(rum.stada(), { utgangna: 0, stangda: 1, raderade: 0 });
  assert.equal(lagring.hamtaRum(roomId).status, ROOM.closed);
  assert.equal(lagring.hamtaSession(anna).activity, ACTIVITY.idle);
  assert.equal(lagring.hamtaInbjudan(inkommande(bo)[0]?.id ?? lagring.listaInbjudningar({ roomId })[0].id).status, INVITATION.revoked);
  klocka.advance(STADNING_ALDER_MS + 1);
  assert.deepEqual(rum.stada(), { utgangna: 0, stangda: 0, raderade: 1 });
  assert.equal(lagring.hamtaRum(roomId), null);
  assert.equal(lagring.listaInbjudningar({ roomId }).length, 0);
  /* Timmar har gått utan aktivitet: sessionerna hade gått ut (5 min) – återuppliva dem som om spelarna kommit tillbaka. */
  for (const id of [anna, bo]) lagring.sparaSession({ ...lagring.hamtaSession(id), lastSeenAt: klocka.now(), expiresAt: klocka.now() + SESSION_TTL_MS });
  const nytt = rum.skapa(anna).id;
  rum.bjudIn(anna, nytt, [bo]);
  const nyHantering = skapaRumshantering({ lagring, klocka, ko: tjanst.ko });
  nyHantering.aterstall();
  assert.equal(nyHantering.timers(), 1);
  klocka.advance(INBJUDAN_TTL_MS);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(lagring.listaInbjudningar({ roomId: nytt, status: INVITATION.pending }).length, 0);
});
