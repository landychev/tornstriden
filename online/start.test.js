import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oppnaLagring } from './lagring.js';
import { skapaSessioner } from './session.js';
import { skapaTjanst } from './tjanst.js';
import { skapaRumshantering, RumsFel, FRANKOPPLAD_FRIST_MS, INBJUDAN_MIN_INTERVALL_MS } from './rum.js';
import { ACTIVITY, CONNECTION, INVITATION, ROOM, LOBBY_COMMAND, MATCH_COMMAND, PROTOCOL_VERSION, RECEIPT, MATCH_STATUS } from '../kontrakt.js';
import { styrdKlocka, styrdSlump } from '../teststod.js';

/* Testdubbel för en matchmotor: sparar en minimal match i samma transaktion och minns vad den fick. */
function testmotor(logg = []) {
  return ({ ops, room, players, klocka, slump }) => {
    const matchId = `m-${room.id}`;
    logg.push({ matchId, players, slump: slump() });
    ops.sparaMatch({ id: matchId, revision: 0, rulesVersion: players.length === 2 ? 'duell-v1' : 'lag-test', deckVersion: 'test', instances: {}, startedAt: klocka.now() }, MATCH_STATUS.active);
    return { matchId, rulesVersion: 'test', deckVersion: 'test' };
  };
}

function setup({ motorer = [] } = {}) {
  const klocka = styrdKlocka(1_000_000);
  const lagring = oppnaLagring({ path: ':memory:', klocka });
  const tjanst = skapaTjanst({ lagring, klocka, slump: styrdSlump(3) });
  const sessioner = skapaSessioner({ lagring, klocka });
  const rum = skapaRumshantering({ lagring, klocka, ko: tjanst.ko });
  sessioner.registrera(tjanst); rum.registrera(tjanst);
  const motorlogg = [];
  for (const n of motorer) rum.registreraMotor(n, testmotor(motorlogg));
  const gast = nick => { const { session } = sessioner.skapa(nick); sessioner.anslut(session.playerId); return session.playerId; };
  let n = 0;
  const cmd = (playerId, type, extra = {}, commandId = `c${++n}`) => tjanst.kommando(playerId, { protocolVersion: PROTOCOL_VERSION, commandId, type, payload: {}, ...extra });
  /* Ett rum med `antal` anslutna deltagare, värden först. */
  const rumMed = antal => {
    const ids = Array.from({ length: antal }, (_, i) => gast(`S${i + 1}`));
    const roomId = rum.skapa(ids[0]).id;
    rum.bjudIn(ids[0], roomId, ids.slice(1));
    for (const id of ids.slice(1)) rum.acceptera(id, rum.vyFor(id).inbjudningar.inkommande[0].id);
    return { roomId, ids };
  };
  const room = roomId => lagring.hamtaRum(roomId);
  const allaRedo = (roomId, ids) => { for (const id of ids) rum.redo(id, roomId, true, room(roomId).rosterVersion); };
  const fordela = (roomId, ids) => ids.forEach((id, i) => rum.valjLag(id, roomId, i % 2 === 0 ? 'A' : 'B'));
  return { klocka, lagring, tjanst, sessioner, rum, gast, cmd, rumMed, room, allaRedo, fordela, motorlogg };
}
const fel = (fn, pattern) => assert.throws(fn, error => error instanceof RumsFel && pattern.test(error.message), `väntade RumsFel ${pattern}`);

test('Lagval: A/B/null, högst fyra per lag, byte nollställer allas Redo och ökar rosterVersion', () => {
  const { rum, rumMed, room, allaRedo } = setup();
  const { roomId, ids } = rumMed(6);
  ids.forEach((id, i) => rum.valjLag(id, roomId, i < 4 ? 'A' : 'B'));
  fel(() => rum.valjLag(ids[4], roomId, 'A'), /Södra laget är fullt/);
  fel(() => rum.valjLag(ids[0], roomId, 'C'), /Okänt lag/);
  const fore = room(roomId).rosterVersion;
  rum.valjLag(ids[0], roomId, 'A');
  assert.equal(room(roomId).rosterVersion, fore, 'samma lag igen är ingen ändring');
  allaRedo(roomId, ids);
  assert.ok(room(roomId).players.every(p => p.ready));
  rum.valjLag(ids[0], roomId, 'B');
  const r = room(roomId);
  assert.equal(r.rosterVersion, fore + 1);
  assert.ok(r.players.every(p => !p.ready && p.readyRosterVersion === null), 'lagbyte kräver ny Redo av alla');
  rum.valjLag(ids[0], roomId, null);
  assert.equal(room(roomId).players[0].teamId, null);
});

test('Redo: kräver aktuell rosterVersion, egen anslutning och valt lag; bara avsändaren markeras; kan tas tillbaka', () => {
  const { rum, rumMed, room, sessioner, lagring } = setup();
  const { roomId, ids } = rumMed(2);
  const [anna, bo] = ids;
  fel(() => rum.redo(anna, roomId, true, room(roomId).rosterVersion), /Välj lag först/);
  rum.valjLag(anna, roomId, 'A'); rum.valjLag(bo, roomId, 'B');
  const v = room(roomId).rosterVersion;
  fel(() => rum.redo(anna, roomId, true, v - 1), /Uppställningen har ändrats/);
  rum.redo(anna, roomId, true, v);
  assert.deepEqual(room(roomId).players.map(p => [p.nick, p.ready, p.readyRosterVersion]), [['S1', true, v], ['S2', false, null]]);
  sessioner.kopplaFran(bo, lagring.hamtaSession(bo).connectionGeneration);
  rum.markeraAnslutning(bo, CONNECTION.offline);
  fel(() => rum.redo(bo, roomId, true, v), /inte ansluten/);
  rum.redo(anna, roomId, false, v);
  assert.equal(room(roomId).players[0].ready, false);
  fel(() => rum.redo(anna, 'r-finns-inte', true, v), /finns inte längre/);
});

test('Startkontroll ger begripliga skäl: udda antal, saknat lag, ojämna lag, frånkopplad, inte redo, format saknas', () => {
  const { rum, rumMed, room, allaRedo, sessioner, lagring } = setup({ motorer: [2, 4] });
  const { roomId, ids } = rumMed(5);
  let k = rum.startkontroll(room(roomId));
  assert.equal(k.kanStarta, false);
  assert.match(k.skal[0], /Vi är 5\. Matchen kan starta med 2, 4, 6 eller 8 spelare\./);
  assert.match(k.skal[1], /S1, S2, S3, S4, S5 har inte valt lag\./);
  rum.lamna(ids[4], roomId);
  ids.slice(0, 3).forEach(id => rum.valjLag(id, roomId, 'A')); rum.valjLag(ids[3], roomId, 'B');
  k = rum.startkontroll(room(roomId));
  assert.deepEqual(k.skal, ['Lagen är ojämna: 3 mot 1. Någon behöver byta lag.', 'Väntar på S1, S2, S3, S4.']);
  rum.valjLag(ids[2], roomId, 'B');
  allaRedo(roomId, ids.slice(0, 4));
  assert.deepEqual(rum.startkontroll(room(roomId)), { kanStarta: true, skal: [], antal: { A: 2, B: 2 }, format: 'lag', tillganglig: true, tillgangligaFormat: [2, 4] });
  sessioner.kopplaFran(ids[1], lagring.hamtaSession(ids[1]).connectionGeneration);
  rum.markeraAnslutning(ids[1], CONNECTION.offline);
  assert.deepEqual(rum.startkontroll(room(roomId)).skal, ['S2 är inte ansluten.']);
  const { rum: rum6, rumMed: rumMed6, room: room6, allaRedo: allaRedo6, fordela } = setup({ motorer: [2] });
  const sex = rumMed6(6);
  fordela(sex.roomId, sex.ids); allaRedo6(sex.roomId, sex.ids);
  const k6 = rum6.startkontroll(room6(sex.roomId));
  assert.deepEqual(k6.skal, ['Matchformatet för 6 spelare är ännu inte tillgängligt.']);
  assert.equal(k6.tillganglig, false);
  assert.equal(rum6.vyFor(sex.ids[0]).start.format, 'lag');
});

test('Start: bara värden, aktuell rosterVersion, giltig uppställning; matchen skapas i samma transaktion och inbjudningar stängs', async () => {
  const { rum, rumMed, room, allaRedo, fordela, cmd, lagring, gast, motorlogg, klocka } = setup({ motorer: [2, 4] });
  const { roomId, ids } = rumMed(4);
  const sen = gast('Sen');
  klocka.advance(INBJUDAN_MIN_INTERVALL_MS);
  rum.bjudIn(ids[0], roomId, [sen]);
  fordela(roomId, ids);
  let v = room(roomId).rosterVersion;
  const forTidigt = await cmd(ids[0], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: v } });
  assert.equal(forTidigt.status, RECEIPT.rejected);
  assert.match(forTidigt.message, /Väntar på S1, S2, S3, S4\./);
  allaRedo(roomId, ids);
  const inteVard = await cmd(ids[1], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: v } });
  assert.match(inteVard.message, /Bara värden/);
  const gammal = await cmd(ids[0], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: v - 1 } });
  assert.match(gammal.message, /Uppställningen har ändrats/);
  const utanVersion = await cmd(ids[0], LOBBY_COMMAND.start, { roomId });
  assert.match(utanVersion.message, /rosterVersion/);
  assert.equal(room(roomId).status, ROOM.preparing, 'inget av försöken ändrade rummet');
  const start = await cmd(ids[0], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: v } }, 'start');
  assert.equal(start.status, RECEIPT.ok);
  const r = room(roomId);
  assert.equal(r.status, ROOM.started);
  assert.equal(r.matchId, `m-${roomId}`);
  assert.equal(lagring.hamtaMatch(r.matchId).status, MATCH_STATUS.active, 'matchen sparades i starttransaktionen');
  assert.deepEqual(motorlogg[0].players.map(p => [p.nick, p.teamId]), [['S1', 'A'], ['S2', 'B'], ['S3', 'A'], ['S4', 'B']]);
  assert.ok(motorlogg[0].slump >= 0 && motorlogg[0].slump < 1, 'motorn får serverns slump');
  assert.equal(lagring.listaInbjudningar({ roomId, status: INVITATION.revoked }).length, 1, 'Sens inbjudan stängdes');
  for (const id of ids) { const s = lagring.hamtaSession(id); assert.equal(s.activity, ACTIVITY.playing); assert.equal(s.matchId, r.matchId); }
  assert.deepEqual(await cmd(ids[0], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: v } }, 'start'), start, 'dubbelklick ger samma kvittens, inte två matcher');
  const igen = await cmd(ids[0], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: v } });
  assert.match(igen.message, /Matchen har startat/);
  fel(() => rum.lamna(ids[1], roomId), /Matchen har startat/);
  assert.equal(rum.vyFor(ids[0]).start, null, 'ingen startstatus efter start');
});

test('Utan registrerad motor spärras formatet i användarflödet och rummet förblir orört', async () => {
  const { rum, rumMed, room, allaRedo, fordela, cmd, lagring } = setup();
  const { roomId, ids } = rumMed(2);
  fordela(roomId, ids); allaRedo(roomId, ids);
  const svar = await cmd(ids[0], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: room(roomId).rosterVersion } });
  assert.equal(svar.status, RECEIPT.rejected);
  assert.match(svar.message, /ännu inte tillgängligt/);
  assert.equal(room(roomId).status, ROOM.preparing);
  assert.equal(lagring.pagaendeMatcher().length, 0);
  assert.equal(lagring.hamtaSession(ids[0]).activity, ACTIVITY.inRoom);
});

test('Misslyckad motor rullar tillbaka hela starten; stängd matchtrafik spärrar start', async () => {
  const { rum, rumMed, room, allaRedo, fordela, cmd, lagring, tjanst } = setup();
  rum.registreraMotor(2, ({ ops, room }) => { ops.sparaMatch({ id: 'm-x', revision: 0, rulesVersion: 'x', deckVersion: 'x', instances: {} }); throw new Error('motorn kraschade'); });
  const { roomId, ids } = rumMed(2);
  fordela(roomId, ids); allaRedo(roomId, ids);
  const svar = await cmd(ids[0], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: room(roomId).rosterVersion } });
  assert.equal(svar.status, RECEIPT.error);
  assert.equal(lagring.hamtaMatch('m-x'), null, 'motorns skrivning rullades tillbaka');
  assert.equal(room(roomId).status, ROOM.preparing);
  assert.equal(lagring.hamtaSession(ids[0]).activity, ACTIVITY.inRoom);
  tjanst.matchtrafik.oppen = false; tjanst.matchtrafik.orsak = 'Servern startades om (test).';
  const sparrad = await cmd(ids[0], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: room(roomId).rosterVersion } });
  assert.match(sparrad.message, /startades om/);
});

test('Start och sen acceptans kan inte ge olika deltagarlistor', async () => {
  const { rum, rumMed, room, allaRedo, fordela, cmd, gast, lagring, klocka } = setup({ motorer: [2, 4] });
  const { roomId, ids } = rumMed(2);
  const cy = gast('Cy');
  klocka.advance(INBJUDAN_MIN_INTERVALL_MS);
  rum.bjudIn(ids[0], roomId, [cy]);
  const inv = rum.vyFor(cy).inbjudningar.inkommande[0].id;
  fordela(roomId, ids); allaRedo(roomId, ids);
  const v = room(roomId).rosterVersion;
  /* Fall 1: acceptansen hinner först – starten ser gammal rosterVersion. */
  const [acc, start] = await Promise.all([
    cmd(cy, LOBBY_COMMAND.accept, { payload: { invitationId: inv } }),
    cmd(ids[0], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: v } })
  ]);
  assert.equal(acc.status, RECEIPT.ok);
  assert.equal(start.status, RECEIPT.rejected);
  assert.match(start.message, /Uppställningen har ändrats/);
  assert.equal(room(roomId).players.length, 3);
  assert.equal(room(roomId).status, ROOM.preparing);
  /* Fall 2: starten hinner först – den sena acceptansen avvisas av STARTAD. */
  rum.lamna(cy, roomId);
  const dan = gast('Dan');
  klocka.advance(INBJUDAN_MIN_INTERVALL_MS);
  rum.bjudIn(ids[0], roomId, [dan]);
  const invDan = rum.vyFor(dan).inbjudningar.inkommande[0].id;
  allaRedo(roomId, ids);
  const [start2, acc2] = await Promise.all([
    cmd(ids[0], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: room(roomId).rosterVersion } }),
    cmd(dan, LOBBY_COMMAND.accept, { payload: { invitationId: invDan } })
  ]);
  assert.equal(start2.status, RECEIPT.ok);
  assert.equal(acc2.status, RECEIPT.rejected);
  assert.match(acc2.message, /återkallats|Matchen har startat/);
  assert.equal(room(roomId).players.length, 2);
  assert.equal(lagring.hamtaSession(dan).activity, ACTIVITY.idle);
});

test('25A: värdavhopp (lämna eller frånkopplingsfrist) ger längst anslutna värdskapet och nollställer Redo', async () => {
  const { rum, rumMed, room, allaRedo, fordela, sessioner, lagring, klocka } = setup({ motorer: [2, 4] });
  const { roomId, ids } = rumMed(4);
  fordela(roomId, ids); allaRedo(roomId, ids);
  rum.lamna(ids[0], roomId);
  let r = room(roomId);
  assert.equal(r.hostPlayerId, ids[1]);
  assert.ok(r.players.every(p => !p.ready));
  assert.match(rum.startkontroll(r).skal.join(' '), /Vi är 3/);
  sessioner.kopplaFran(ids[1], lagring.hamtaSession(ids[1]).connectionGeneration);
  rum.markeraAnslutning(ids[1], CONNECTION.offline);
  klocka.advance(FRANKOPPLAD_FRIST_MS);
  await new Promise(resolve => setTimeout(resolve, 5));
  r = room(roomId);
  assert.equal(r.hostPlayerId, ids[2], 'frånkopplad värd ersätts efter fristen');
  assert.deepEqual(r.players.map(p => p.nick), ['S3', 'S4']);
});
