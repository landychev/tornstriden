/* Anslutningsavbrott med fortsatt spel (arbetsordning L17, beslut 2A och 26B) – styrd klocka, inga verkliga
   väntetider. Avbrott och återkomster går genom samma vägar som servern använder (sessionens generation och
   matcher.frankopplad/ansluten i matchens kö). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oppnaLagring } from './lagring.js';
import { skapaSessioner } from './session.js';
import { skapaTjanst } from './tjanst.js';
import { skapaRumshantering } from './rum.js';
import { skapaMatcher } from './matcher.js';
import { TURTID_MS, AVBROTT_MS, AVBROTT_BUDGET_MS, ANSLUTNINGSHANDELSE as AH, registreraAvbrott, avslutaAvbrott } from './klockor.js';
import { LAG_FAS, LAG_HANDLING as H, LAG_SLUT, UTSLAG } from '../lagmatch.js';
import { USAGE } from '../lagregler.js';
import { PHASE, END } from '../match.js';
import { CONNECTION, LOBBY_COMMAND, MATCH_COMMAND as C, MATCH_STATUS, PLAYER_STATUS, PROTOCOL_VERSION, RECEIPT, validatePrivateView, validateEvent, assertNoSecrets } from '../kontrakt.js';
import { styrdKlocka, styrdSlump } from '../teststod.js';

const T0 = 1_000_000;

function varld({ seed = 5 } = {}) {
  const klocka = styrdKlocka(T0);
  const lagring = oppnaLagring({ path: ':memory:', klocka });
  const tjanst = skapaTjanst({ lagring, klocka, slump: styrdSlump(seed) });
  const sessioner = skapaSessioner({ lagring, klocka });
  const rum = skapaRumshantering({ lagring, klocka, ko: tjanst.ko });
  const matcher = skapaMatcher({ lagring, klocka, rum });
  sessioner.registrera(tjanst); rum.registrera(tjanst); matcher.registrera(tjanst);
  let n = 0;
  const cmd = (playerId, type, extra = {}, commandId = `c${++n}`) => tjanst.kommando(playerId, { protocolVersion: PROTOCOL_VERSION, commandId, type, payload: {}, ...extra });
  const generation = new Map();
  const gaster = size => Array.from({ length: size }, (_, i) => { const { session } = sessioner.skapa(`spelare${i + 1}`); generation.set(session.playerId, sessioner.anslut(session.playerId)); return session.playerId; });
  async function starta(size) {
    const ids = gaster(size);
    const roomId = rum.skapa(ids[0]).id;
    rum.bjudIn(ids[0], roomId, ids.slice(1));
    for (const id of ids.slice(1)) rum.acceptera(id, rum.vyFor(id).inbjudningar.inkommande[0].id);
    ids.forEach((id, i) => rum.valjLag(id, roomId, i % 2 ? 'B' : 'A'));
    const v = lagring.hamtaRum(roomId).rosterVersion;
    for (const id of ids) rum.redo(id, roomId, true, v);
    const start = await cmd(ids[0], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: v } });
    assert.equal(start.status, RECEIPT.ok, start.message);
    return { ids, roomId, matchId: lagring.hamtaRum(roomId).matchId };
  }
  const vy = id => { const v = matcher.matchFor(id).view; validatePrivateView(v); assertNoSecrets(v, v.me?.id ?? v.viewer); return v; };
  const spela = (id, type, payload = {}, commandId) => { const v = matcher.matchFor(id).view; return cmd(id, type, { matchId: v.matchId, revision: v.revision, payload }, commandId); };
  const post = matchId => lagring.hamtaMatch(matchId).match;
  const status = matchId => lagring.hamtaMatch(matchId).status;
  const tick = async ms => { klocka.advance(ms); await matcher.klockor().klart(); };
  /* Anslutningen försvinner (som när servern märker en stängd eller tyst ström). */
  async function tappa(id) {
    const g = generation.get(id);
    assert.equal(sessioner.kopplaFran(id, g), true);
    await matcher.frankopplad(id, g, klocka.now());
  }
  /* En ny ström öppnas (omladdning, ny flik eller återkommet nät). */
  async function aterkom(id) {
    const g = sessioner.anslut(id);
    generation.set(id, g);
    await matcher.ansluten(id, g, klocka.now());
    return g;
  }
  const handelser = (matchId, typ) => lagring.hamtaHandelser(matchId).filter(e => e.type === typ);
  return { klocka, lagring, tjanst, sessioner, rum, matcher, cmd, starta, vy, spela, post, status, tick, tappa, aterkom, handelser, generation };
}

test('Lagmatch: andra byter vidare under ett avbrott, den frånkopplades klocka står still, och återkomst i tid återupptar den med sparad tid', async () => {
  const w = varld();
  const { ids, matchId } = await w.starta(4);
  const [a1, b1, a2, b2] = ids;
  await w.tick(10_000);
  await w.tappa(b1);
  const p = w.post(matchId);
  assert.deepEqual(p.avbrott[b1], { id: p.avbrott[b1].id, generation: w.generation.get(b1), start: T0 + 10_000, deadline: T0 + 10_000 + AVBROTT_MS });
  assert.deepEqual([p.klockor[b1].deadline, p.klockor[b1].kvar], [null, TURTID_MS - 10_000], 'bara den frånkopplades klocka pausas');
  assert.equal(p.klockor[a1].deadline, T0 + TURTID_MS, 'övrigas klockor går vidare');
  const vyA = w.vy(a1);
  assert.deepEqual(vyA.disconnects, { [b1]: T0 + 40_000 }, 'alla ser återstående återanslutningstid');
  assert.equal(vyA.players.find(q => q.id === b1).connection, CONNECTION.offline);
  assert.ok(!(b1 in vyA.clocks), 'en pausad klocka visas inte som en nedräkning');
  assert.deepEqual(w.handelser(matchId, AH.disconnected).map(e => e.data), [{ playerId: b1, deadline: T0 + 40_000 }]);
  /* De anslutna kan lämna sina egna svar i den gemensamma bytesomgången; omgången väntar bara på den frånkopplade. */
  for (const id of [a1, a2, b2]) assert.equal((await w.spela(id, H.swap, { cards: [] })).status, RECEIPT.ok);
  assert.deepEqual(w.vy(a1).swap.waitingFor, [b1]);
  /* Återkomst 5 sekunder före fristen: budgeten debiteras med 25 s och klockan fortsätter med sina 80 s. */
  await w.tick(25_000);
  await w.aterkom(b1);
  const q = w.post(matchId);
  assert.deepEqual(q.avbrott, {});
  assert.equal(q.avbrottsbudget[b1], 25_000);
  assert.equal(q.klockor[b1].deadline, T0 + 35_000 + TURTID_MS - 10_000, 'sparad tid, aldrig nya 90 sekunder');
  assert.equal(w.handelser(matchId, AH.reconnected).length, 1);
  assert.equal(w.vy(b1).deadline.at, T0 + 115_000);
  assert.equal(w.vy(b1).players.find(x => x.id === b1).connection, CONNECTION.online);
  for (const e of w.lagring.hamtaHandelser(matchId)) validateEvent(e);
});

test('Lagmatch: slut på fristen slår ut den frånkopplade (AVBROTT) och laget spelar vidare; precis före fristen händer inget', async () => {
  const w = varld({ seed: 7 });
  const { ids, matchId } = await w.starta(4);
  const [a1, b1, a2, b2] = ids;
  await w.tappa(b1);
  for (const id of [a1, a2, b2]) await w.spela(id, H.swap, { cards: [] });
  await w.tick(AVBROTT_MS - 1);
  assert.equal(w.post(matchId).engine.players.find(p => p.id === b1).status, PLAYER_STATUS.alive);
  await w.tick(1);
  const e = w.post(matchId).engine;
  assert.equal(e.players.find(p => p.id === b1).eliminationReason, UTSLAG.disconnect);
  assert.equal(e.phase, LAG_FAS.swap);
  assert.equal(e.swapRound, 2, 'bytesomgången går vidare utan den utslagna');
  assert.deepEqual(w.post(matchId).avbrott, {});
  assert.equal(w.status(matchId), MATCH_STATUS.active);
  /* Återkomst efter fristen ger aldrig tillbaka platsen. */
  await w.aterkom(b1);
  assert.deepEqual(w.vy(b1).allowed, []);
  assert.equal(w.vy(b1).me.status, PLAYER_STATUS.out);
});

test('Duell: fristen startar inte om när turen kommer; ett nytt val under avbrottet får sina 90 s först vid återkomsten', async () => {
  const w = varld({ seed: 2 });
  const { ids: [anna, bo], matchId } = await w.starta(2);
  await w.tick(5_000);
  await w.tappa(bo);   // Annas tur att byta – Bo behövs inte än
  assert.equal(w.post(matchId).avbrott[bo].deadline, T0 + 35_000);
  await w.tick(5_000);
  assert.equal((await w.spela(anna, C.swap, { cards: [] })).status, RECEIPT.ok, 'Anna kan agera');
  const p = w.post(matchId);
  assert.equal(p.avbrott[bo].deadline, T0 + 35_000, 'fristen ändras inte när Bos tur kommer');
  assert.deepEqual([p.klockor[bo].deadline, p.klockor[bo].kvar], [null, TURTID_MS], 'Bos nya val väntar med sina 90 s');
  assert.equal(w.vy(anna).disconnects.B, T0 + 35_000);
  assert.ok(!('B' in w.vy(anna).clocks));
  /* Återkomst 1 ms före fristen: i tid, och 90 s börjar nu. */
  await w.tick(25_000 - 1);
  await w.aterkom(bo);
  const q = w.post(matchId);
  assert.deepEqual(q.avbrott, {});
  assert.equal(q.avbrottsbudget[bo], AVBROTT_MS - 1);
  assert.equal(q.klockor[bo].deadline, w.klocka.now() + TURTID_MS);
  assert.deepEqual(w.vy(bo).deadline, { playerId: 'B', at: w.klocka.now() + TURTID_MS });
  assert.equal(w.status(matchId), MATCH_STATUS.active);
});

test('Återkomst exakt på fristens slut är för sent – i duellen förlorar den frånkopplade (AVBROTT)', async () => {
  /* Mottagningstiden avgör: 1 ms före är i tid, exakt på deadline är för sent. */
  const post = { klockor: {} };
  const a = registreraAvbrott(post, 'x', 1, 1000);
  assert.equal(registreraAvbrott(post, 'x', 1, 2000), null, 'samma avbrott: ingen ny frist');
  assert.equal(avslutaAvbrott(structuredClone(post), 'x', a.deadline), 'för sent');
  assert.equal(avslutaAvbrott(post, 'x', a.deadline - 1), 'återansluten');
  assert.equal(post.avbrottsbudget.x, AVBROTT_MS - 1);

  const w = varld({ seed: 2 });
  const { ids: [anna, bo], matchId } = await w.starta(2);
  await w.tappa(bo);
  w.klocka.advance(AVBROTT_MS);   // timern köas; återkomsten tas emot exakt på deadline
  await w.aterkom(bo);
  const e = w.post(matchId).engine;
  assert.deepEqual([e.phase, e.winner, e.endReason], [PHASE.over, 'A', END.disconnect]);
  assert.equal(w.status(matchId), MATCH_STATUS.finished);
  assert.equal(w.handelser(matchId, AH.reconnected).length, 0);
  const sen = await w.spela(bo, C.swap, { cards: [] });
  assert.equal(sen.status, RECEIPT.rejected);
  assert.match(sen.message, /kom inte tillbaka i tid/);
  assert.match(w.post(matchId).engine.log.at(-1), /kom inte tillbaka i tid/);
});

test('Den sista budgetresten ger en kortare frist; återkomsten debiteras exakt en gång', async () => {
  const w = varld({ seed: 3 });
  const { ids: [anna, bo], matchId } = await w.starta(2);
  assert.equal((await w.spela(anna, C.swap, { cards: [] })).status, RECEIPT.ok);   // Bos tur: Anna har ingen klocka
  for (let i = 0; i < 3; i++) {
    await w.tappa(bo);
    await w.tick(25_000);
    await w.aterkom(bo);
    await w.aterkom(bo);   // en extra ström (ny flik) under samma uppkoppling debiterar inget
  }
  assert.equal(w.post(matchId).avbrottsbudget[bo], 75_000);
  await w.tappa(bo);
  const a = w.post(matchId).avbrott[bo];
  assert.equal(a.deadline - a.start, AVBROTT_BUDGET_MS - 75_000, '15 s kvar av 90');
  await w.tick(15_000 - 1);
  assert.equal(w.post(matchId).engine.phase, PHASE.swap);
  await w.tick(1);
  assert.deepEqual([w.post(matchId).engine.winner, w.post(matchId).engine.endReason], ['A', END.disconnect]);
});

test('En gammal stängning fäller inte en ny anslutning, och samma avbrott ger ingen ny frist', async () => {
  const w = varld({ seed: 4 });
  const { ids: [anna], matchId } = await w.starta(2);
  /* Stängningen upptäcks (generation 1) men en ny ström öppnas innan matchkön hunnit behandla den. */
  const g1 = w.generation.get(anna);
  assert.equal(w.sessioner.kopplaFran(anna, g1), true);
  const g2 = w.sessioner.anslut(anna);
  await Promise.all([w.matcher.frankopplad(anna, g1), w.matcher.ansluten(anna, g2)]);
  assert.deepEqual(w.post(matchId).avbrott ?? {}, {}, 'det gamla avbrottet registreras inte');
  assert.equal(w.handelser(matchId, AH.disconnected).length, 0);
  /* En sen close från generation 1 efter att generation 2 öppnats ändrar ingenting. */
  assert.equal(w.sessioner.kopplaFran(anna, g1), false);
  /* Samma avbrott två gånger: en frist. */
  w.generation.set(anna, g2);
  await w.tappa(anna);
  await w.tick(10_000);
  await w.matcher.frankopplad(anna, g2);
  assert.equal(w.post(matchId).avbrott[anna].deadline, T0 + AVBROTT_MS);
  assert.equal(w.handelser(matchId, AH.disconnected).length, 1);
});

test('Alla frånkopplade: avgörandet väntar in den andras frist – återkomst ger seger, annars ingen vinnare', async () => {
  /* a) Bo kommer tillbaka efter att Annas frist gått ut: Anna förlorar, Bo vinner. */
  {
    const w = varld({ seed: 5 });
    const { ids: [anna, bo], matchId } = await w.starta(2);
    await w.tappa(anna);
    await w.tick(10_000);
    await w.tappa(bo);
    await w.tick(AVBROTT_MS - 10_000);   // Annas frist är slut, men Bo har 10 s kvar och ingen är ansluten
    assert.equal(w.post(matchId).engine.phase, PHASE.swap, 'ingen vinnare medan alla är frånkopplade');
    await w.tick(5_000);
    await w.aterkom(bo);
    const e = w.post(matchId).engine;
    assert.deepEqual([e.winner, e.endReason], ['B', END.disconnect]);
    assert.equal(w.status(matchId), MATCH_STATUS.finished);
  }
  /* b) Ingen kommer tillbaka: avbruten utan vinnare. */
  {
    const w = varld({ seed: 5 });
    const { ids: [anna, bo], matchId } = await w.starta(2);
    await w.tappa(anna);
    await w.tick(10_000);
    await w.tappa(bo);
    await w.tick(AVBROTT_MS);
    const e = w.post(matchId).engine;
    assert.deepEqual([e.phase, e.winner, e.endReason], [PHASE.over, null, END.noWinner]);
    assert.equal(w.status(matchId), MATCH_STATUS.aborted);
  }
  /* c) Lagmatch, alla fyra frånkopplade och ingen kommer tillbaka: avbruten utan vinnare i en händelse. */
  {
    const w = varld({ seed: 6 });
    const { ids, matchId } = await w.starta(4);
    for (const [i, id] of ids.entries()) { await w.tappa(id); await w.tick(i === 3 ? 0 : 2_000); }
    await w.tick(AVBROTT_MS - 6_000 - 1);
    assert.equal(w.post(matchId).engine.phase, LAG_FAS.swap);
    await w.tick(1 + 6_000);
    const e = w.post(matchId).engine;
    assert.deepEqual([e.phase, e.winnerTeam, e.endReason], [LAG_FAS.over, null, LAG_SLUT.noPlayers]);
    assert.equal(w.status(matchId), MATCH_STATUS.aborted);
    assert.equal(new Set(w.handelser(matchId, 'UTSLAGEN').map(h => h.revision)).size, 1);
  }
});

test('Lagmatch: liv ändras under avbrottet, Fortsätt väntar på den frånkopplade och återkomsten visar det nya läget', async () => {
  const w = varld({ seed: 21 });
  const { ids, matchId } = await w.starta(4);
  /* Spela fram till försvaret med enkla val. */
  for (let i = 0; i < 200 && w.vy(ids[0]).phase !== LAG_FAS.defence; i++) {
    const [id, a] = ids.map(x => [x, w.vy(x).allowed.find(y => y.type !== H.leave)]).find(([, y]) => y);
    const payload = a.type === H.swap ? { cards: [] } : a.type === H.target ? { targetPlayerId: a.players[0] } : a.type === H.attack ? { instanceId: a.simple[0].instanceId, usage: USAGE.simple } : {};
    assert.equal((await w.spela(id, a.type, payload)).status, RECEIPT.ok);
  }
  const b = w.vy(ids[0]).battle;
  const malet = b.target;
  assert.equal(w.vy(ids[0]).activePlayer, malet, 'måltavlan försvarar först');
  const livFore = w.vy(malet).me.life;
  assert.equal((await w.spela(malet, H.passDefence)).status, RECEIPT.ok);
  await w.tappa(malet);
  /* Lagkamraten avstår också – striden avgörs medan måltavlan är borta. */
  const kamrat = w.vy(ids[0]).activePlayer;
  assert.notEqual(kamrat, malet);
  assert.equal((await w.spela(kamrat, H.passDefence)).status, RECEIPT.ok);
  assert.equal(w.vy(ids[0]).phase, LAG_FAS.result);
  assert.equal(w.vy(ids[0]).players.find(p => p.id === malet).life, livFore - 1);
  /* Alla anslutna bekräftar; nästa strid väntar bara på den frånkopplade, vars klocka står still. */
  for (const id of ids.filter(x => x !== malet)) assert.equal((await w.spela(id, H.next)).status, RECEIPT.ok);
  assert.equal(w.vy(ids[0]).phase, LAG_FAS.result);
  assert.deepEqual(w.vy(ids[0]).confirm.waitingFor, [malet]);
  assert.equal(w.post(matchId).klockor[malet].deadline, null);
  await w.tick(20_000);
  await w.aterkom(malet);
  const v = w.vy(malet);
  assert.equal(v.me.life, livFore - 1, 'återkomsten visar det nya livet');
  assert.equal(v.phase, LAG_FAS.result);
  assert.ok(v.allowed.some(a => a.type === H.next));
  assert.deepEqual(v.deadline, { playerId: malet, at: w.klocka.now() + TURTID_MS }, 'Fortsätt blev aktuellt under avbrottet: 90 s från återkomsten');
  assert.equal((await w.spela(malet, H.next)).status, RECEIPT.ok);
  assert.equal(w.vy(ids[0]).phase, LAG_FAS.target);
});

test('Tappad kvittens: ett drag som sparades före avbrottet har samma kvittens efter återkomsten, utan ny effekt', async () => {
  const w = varld({ seed: 2 });
  const { ids: [anna], matchId } = await w.starta(2);
  const forsta = await w.spela(anna, C.swap, { cards: [] }, 'byte-1');
  assert.equal(forsta.status, RECEIPT.ok);
  await w.tappa(anna);   // kvittensen nådde aldrig fram
  await w.tick(3_000);
  await w.aterkom(anna);
  assert.deepEqual(w.tjanst.status(anna, `match:${matchId}`, 'byte-1'), forsta, 'statusfrågan ger den sparade kvittensen');
  const revision = w.post(matchId).engine.revision;
  const igen = await w.cmd(anna, C.swap, { matchId, revision: forsta.revision - 1, payload: { cards: [] } }, 'byte-1');
  assert.deepEqual(igen, forsta, 'samma commandId: gammal kvittens');
  assert.equal(w.post(matchId).engine.revision, revision, 'ingen ny effekt');
});

test('Den som kommer tillbaka efter sin frist får inte spela medan avgörandet väntar på de andra (granskning L17)', async () => {
  /* Duell: Anna borta från T0, Bo från T0+10. Annas frist går ut vid T0+30 men avgörandet väntar på Bo. */
  const w = varld({ seed: 5 });
  const { ids: [anna, bo], matchId } = await w.starta(2);
  await w.tappa(anna);
  await w.tick(10_000);
  await w.tappa(bo);
  await w.tick(AVBROTT_MS - 10_000 + 1);
  await w.aterkom(anna);   // för sent
  const drag = await w.spela(anna, C.swap, { cards: [] });
  assert.equal(drag.status, RECEIPT.rejected, 'ingen rätt att spela vidare');
  assert.match(drag.message, /kom inte tillbaka i tid/);
  assert.equal(w.post(matchId).engine.activePlayer, 'A', 'Annas byte gjordes inte');
  await w.tick(4_000);
  await w.aterkom(bo);
  const e = w.post(matchId).engine;
  assert.deepEqual([e.winner, e.endReason], ['B', END.disconnect]);
  assert.match(e.log.find(rad => /byter|behåller/.test(rad)) ?? 'inget byte', /inget byte/, 'inga byten i loggen');

  /* Lagmatch: samma sak under startbytena. */
  const l = varld({ seed: 6 });
  const { ids, matchId: lagId } = await l.starta(4);
  for (const id of ids) { await l.tappa(id); }
  await l.tick(AVBROTT_MS + 1);
  assert.equal(l.post(lagId).engine.phase, LAG_FAS.over, 'alla ute samtidigt: avgjort direkt');
  const m = varld({ seed: 6 });
  const { ids: [a1, b1, a2, b2], matchId: mId } = await m.starta(4);
  await m.tappa(a1);
  await m.tick(5_000);
  for (const id of [b1, a2, b2]) await m.tappa(id);
  await m.tick(AVBROTT_MS - 5_000 + 1);   // a1:s frist ute, de andra har tid kvar och är frånkopplade
  const sent = await m.spela(a1, H.swap, { cards: [] });
  assert.equal(sent.status, RECEIPT.rejected);
  assert.equal(m.post(mId).engine.swapsConfirmed[a1], 0);
  await m.aterkom(b1);
  assert.equal(m.post(mId).engine.players.find(p => p.id === a1).eliminationReason, UTSLAG.disconnect);
});

test('En turklocka som redan gått ut pausas inte av ett senare avbrott – tidsgränsen gäller (granskning L17)', async () => {
  const w = varld({ seed: 2 });
  const { ids: [anna, bo], matchId } = await w.starta(2);
  await w.tick(70_000);
  await w.tappa(bo);                      // Bos frist till T0+100; Annas klocka går ut vid T0+90
  await w.tick(20_000);
  assert.equal(w.post(matchId).engine.phase, PHASE.swap, 'avgörandet väntar på Bo');
  await w.tick(1_000);
  await w.tappa(anna);                    // Anna kopplar från efter att hennes tid redan gått ut
  assert.equal(w.post(matchId).klockor[anna].deadline, T0 + TURTID_MS, 'den utgångna klockan står kvar');
  await w.tick(4_000);
  await w.aterkom(bo);                    // Bo i tid: Annas tidsgräns avgörs nu, inte efter hennes nya frist
  const e = w.post(matchId).engine;
  assert.deepEqual([e.phase, e.winner, e.endReason], [PHASE.over, 'B', END.timeout]);
});

test('En timer som väntar i kön prövar bara det som gått ut när den köades – en senare köad återkomst i tid godtas (granskning L17)', async () => {
  const w = varld({ seed: 5 });
  const { ids: [anna, bo], matchId } = await w.starta(2);
  await w.tappa(anna);                    // Annas frist: T0 + 30 s
  await w.tick(10_000);
  await w.tappa(bo);                      // Bos frist: T0 + 40 s
  await w.tick(19_000);
  /* Matchens kö hålls upptagen från 29 s till 45 s. */
  let slapp;
  const halls = new Promise(resolve => { slapp = resolve; });
  const sparr = w.tjanst.ko.kor(`match:${matchId}`, () => halls);
  w.klocka.advance(1_000);                // 30 s: timern för Annas frist läggs i kön
  w.klocka.advance(9_999);                // 39,999 s: Bo kommer tillbaka, i tid, och läggs i kön efter timern
  const g = w.sessioner.anslut(bo);
  w.generation.set(bo, g);
  const aterkomst = w.matcher.ansluten(bo, g, w.klocka.now());
  w.klocka.advance(5_001);                // 45 s: kön släpps
  slapp();
  await sparr; await aterkomst; await w.matcher.klockor().klart();
  const e = w.post(matchId).engine;
  assert.deepEqual([e.phase, e.winner, e.endReason], [PHASE.over, 'B', END.disconnect], 'Bos återkomst godtas och Bo vinner');
  assert.equal(w.status(matchId), MATCH_STATUS.finished);
});

test('Nåden för en stängd ström: går turklockan ut under nåden registreras avbrottet direkt och skyddar den kvarvarande tiden (granskning L17)', async () => {
  const w = varld({ seed: 2 });
  const { ids: [anna], matchId } = await w.starta(2);
  assert.equal(w.post(matchId).klockor[anna].deadline, T0 + TURTID_MS, 'Anna byter först');
  /* Gott om tid kvar: nåden räcker, inget avbrott registreras vid stängningen. */
  await w.tick(10_000);
  let g = w.generation.get(anna);
  w.sessioner.kopplaFran(anna, g);
  await w.matcher.frankopplad(anna, g, w.klocka.now(), { nad: 3_000 });
  assert.deepEqual(w.post(matchId).avbrott ?? {}, {}, 'omladdning med gott om tid är inget avbrott');
  g = await w.aterkom(anna);
  /* Stängd vid 89 s: klockan skulle gå ut vid 90, före nådens slut vid 92. */
  await w.tick(79_000);
  const stangd = w.klocka.now();
  w.sessioner.kopplaFran(anna, g);
  await w.matcher.frankopplad(anna, g, stangd, { nad: 3_000 });
  assert.deepEqual(w.post(matchId).avbrott[anna], { id: `${anna}:${g}`, generation: g, start: stangd, deadline: stangd + AVBROTT_MS });
  assert.deepEqual([w.post(matchId).klockor[anna].deadline, w.post(matchId).klockor[anna].kvar], [null, 1_000], 'en sekund turtid sparad');
  await w.tick(3_000);
  await w.matcher.frankopplad(anna, g, stangd);   // nåden är slut: samma avbrott, ingen ny frist
  assert.equal(w.handelser(matchId, AH.disconnected).length, 1);
  assert.equal(w.post(matchId).engine.phase, PHASE.swap, 'Anna är inte utslagen vid 90 s');
  await w.tick(10_000);
  await w.aterkom(anna);
  const p = w.post(matchId);
  assert.equal(p.klockor[anna].deadline, w.klocka.now() + 1_000, 'turtiden återupptas med den sparade sekunden');
  assert.equal(p.avbrottsbudget[anna], 13_000);
  await w.tick(1_000);
  assert.deepEqual([w.post(matchId).engine.phase, w.post(matchId).engine.winner, w.post(matchId).engine.endReason], [PHASE.over, 'B', END.timeout]);
});
