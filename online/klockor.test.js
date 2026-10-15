/* Spelarklockor (arbetsordning L16): 90 sekunder per nödvändigt val, styrd klocka, inga verkliga väntetider.
   Lagmatch och onlineduell körs genom samma tjänst, kö och timer som servern använder (matcher.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oppnaLagring } from './lagring.js';
import { skapaSessioner } from './session.js';
import { skapaTjanst } from './tjanst.js';
import { skapaRumshantering } from './rum.js';
import { skapaMatcher } from './matcher.js';
import { TURTID_MS, TIDEN_UTE, uppdateraKlockor, utgangna, forSent, skapaTurklockor } from './klockor.js';
import { skapaKo } from './ko.js';
import { LAG_FAS, LAG_HANDLING as H, LAG_SLUT, UTSLAG } from '../lagmatch.js';
import { LAG_EVENT } from '../lagvy.js';
import { USAGE } from '../lagregler.js';
import { PHASE, END } from '../match.js';
import { EVENT } from '../lokalmatch.js';
import { ACTIVITY, LOBBY_COMMAND, MATCH_COMMAND, MATCH_STATUS, PLAYER_STATUS, PROTOCOL_VERSION, RECEIPT, ROOM, validatePrivateView, assertNoSecrets } from '../kontrakt.js';
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
  const cmd = (playerId, type, extra = {}) => tjanst.kommando(playerId, { protocolVersion: PROTOCOL_VERSION, commandId: `c${++n}`, type, payload: {}, ...extra });
  const gaster = size => Array.from({ length: size }, (_, i) => { const { session } = sessioner.skapa(`spelare${i + 1}`); sessioner.anslut(session.playerId); return session.playerId; });
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
  const spela = (id, type, payload = {}) => { const v = matcher.matchFor(id).view; return cmd(id, type, { matchId: v.matchId, revision: v.revision, payload }); };
  const rad = matchId => lagring.hamtaMatch(matchId);
  const tick = async ms => { klocka.advance(ms); await matcher.klockor().klart(); };
  /* Spärrar matchens kö (som en långsam databas) tills släpp() anropas. */
  function sparr(matchId) { let slapp; const klar = tjanst.ko.kor(`match:${matchId}`, () => new Promise(r => { slapp = r; })); return { slapp: () => slapp(), klar }; }
  return { klocka, lagring, tjanst, rum, matcher, cmd, starta, vy, spela, rad, tick, sparr };
}

/* Spelar fram till ett visst läge med enkla val: behåll handen, första måltavlan, enkel attack, avstå försvar. */
async function spelaTill(w, ids, mal) {
  for (let i = 0; i < 400; i++) {
    const vyer = ids.map(id => w.vy(id));
    if (mal(vyer[0])) return;
    const drag = vyer.map((v, k) => [ids[k], v.allowed.find(a => a.type !== H.leave)]).filter(([, a]) => a);
    assert.ok(drag.length, 'någon har ett val');
    const [id, a] = drag[0];
    const payload = a.type === H.swap ? { cards: [] } : a.type === H.target ? { targetPlayerId: a.players[0] } : a.type === H.attack ? { instanceId: a.simple[0].instanceId, usage: USAGE.simple } : {};
    const type = a.type === H.defend ? H.passDefence : a.type;
    const r = await w.spela(id, type, payload);
    assert.equal(r.status, RECEIPT.ok, `${type}: ${r.message}`);
  }
  assert.fail('läget nåddes aldrig');
}

test('Klockornas regler: samma val behåller sin deadline, ett nytt val får 90 s och exakt på deadline är för sent', () => {
  const k1 = uppdateraKlockor({}, { a: 'byte:1', b: 'byte:1' }, 100);
  assert.deepEqual(k1, { a: { nyckel: 'byte:1', start: 100, deadline: 100 + TURTID_MS }, b: { nyckel: 'byte:1', start: 100, deadline: 100 + TURTID_MS } });
  const k2 = uppdateraKlockor(k1, { b: 'byte:1', c: 'mål:1' }, 5000);
  assert.equal(k2.b, k1.b, 'oförändrat val: samma klocka');
  assert.equal(k2.c.deadline, 5000 + TURTID_MS);
  assert.ok(!('a' in k2), 'den som inte längre väntas på har ingen klocka');
  assert.equal(uppdateraKlockor(k2, { b: 'byte:2' }, 7000).b.deadline, 7000 + TURTID_MS, 'nytt val: ny tid');
  const d = k2.b.deadline;
  assert.equal(forSent(k2, 'b', d - 1), false);
  assert.equal(forSent(k2, 'b', d), true);
  assert.equal(forSent(k2, 'x', d + 1_000_000), false, 'utan krav finns ingen tidsgräns');
  assert.deepEqual(utgangna(k2, d - 1), []);
  assert.deepEqual(utgangna(k2, d).sort(), ['b']);
});

test('Lagmatch: bara den som har ett val har en klocka; avvisade drag och omladdning ändrar den inte; deadline − 1 ms godtas, exakt deadline är för sent', async () => {
  const w = varld();
  const { ids, matchId } = await w.starta(4);
  const slut = T0 + TURTID_MS;
  for (const id of ids) {
    const v = w.vy(id);
    assert.deepEqual(v.deadline, { playerId: id, at: slut }, 'alla byter samtidigt och har varsin klocka');
    assert.deepEqual(v.clocks, Object.fromEntries(ids.map(p => [p, slut])));
    assert.equal(v.serverTime, T0);
  }
  await w.tick(10_000);
  assert.equal((await w.spela(ids[0], H.swap, { cards: [] })).status, RECEIPT.ok);
  assert.equal(w.vy(ids[0]).deadline, null, 'väntan på de andra förbrukar ingen tid');
  assert.deepEqual(w.vy(ids[1]).deadline, { playerId: ids[1], at: slut }, 'en annans val flyttar inte min deadline');
  await w.tick(10_000);
  const tre = w.vy(ids[1]).me.hand.slice(0, 3).map(c => c.instanceId);
  const fel = await w.spela(ids[1], H.swap, { cards: tre });
  assert.equal(fel.status, RECEIPT.rejected, 'för många kort');
  assert.equal(w.rad(matchId).match.klockor[ids[1]].deadline, slut, 'ett felaktigt drag återställer inte klockan');
  assert.deepEqual(w.vy(ids[1]).deadline.at, slut, 'omladdning ger samma deadline');

  await w.tick(slut - 1 - w.klocka.now());
  assert.equal((await w.spela(ids[1], H.swap, { cards: [] })).status, RECEIPT.ok, '1 ms före deadline är i tid');
  /* Timern tas bort så att ett kommando tas emot exakt på deadline innan timern hunnit köra (en sen timer).
     De utgångna klockorna behandlas då före kommandot: båda som inte hann byta slås ut i samma händelse, och
     avsändaren får veta att tiden gick ut. Ett lag kvar på var sida -> matchen fortsätter. */
  w.matcher.stang();
  const fore = w.rad(matchId).match;
  await w.tick(1);
  const sen = await w.spela(ids[2], H.swap, { cards: [] });
  assert.deepEqual([sen.status, sen.message], [RECEIPT.rejected, TIDEN_UTE], 'exakt på deadline är för sent');
  const efter = w.rad(matchId).match;
  assert.equal(efter.engine.revision, fore.engine.revision + 1, 'en gemensam händelse, före kommandot');
  const ute = w.lagring.hamtaHandelser(matchId, fore.lastEventId).filter(e => e.type === LAG_EVENT.eliminated);
  assert.deepEqual(ute.map(e => [e.data.playerId, e.data.reason]), [[ids[2], UTSLAG.timeout], [ids[3], UTSLAG.timeout]]);
  for (const id of [ids[2], ids[3]]) {
    assert.equal(w.lagring.hamtaSession(id).activity, ACTIVITY.finished, 'den utslagna följer matchen');
    assert.equal(w.vy(id).deadline, null);
    assert.deepEqual(w.vy(id).allowed, []);
  }
  assert.equal(efter.engine.phase, LAG_FAS.swap);
  assert.equal(efter.engine.swapRound, 2, 'bytesomgången går vidare utan de utslagna');
  assert.deepEqual(Object.keys(efter.klockor).sort(), [ids[0], ids[1]].sort());
  assert.ok(Object.values(efter.klockor).every(k => k.deadline === w.klocka.now() + TURTID_MS), 'ny omgång: nya 90 sekunder');

  /* En dubbel timerhändelse har ingen effekt. */
  assert.equal(await w.matcher.klockor().kontrollera(matchId), false);
  assert.equal(w.rad(matchId).match.engine.revision, efter.engine.revision);
  assert.equal(w.rad(matchId).match.lastEventId, efter.lastEventId);
});

test('Lagmatch: timern går via matchens kö – ett drag köat i tid godtas trots långsam lagring, och samtidiga utgångar avgörs tillsammans', async () => {
  const w = varld({ seed: 9 });
  const { ids, matchId, roomId } = await w.starta(4);
  const s = w.sparr(matchId);
  await w.tick(TURTID_MS - 1);
  const itid = w.spela(ids[0], H.swap, { cards: [] });   // köas 1 ms före deadline bakom spärren
  w.klocka.advance(1);                                     // timern går ut och köas efter draget
  const forsent = w.spela(ids[1], H.swap, { cards: [] });  // exakt på deadline, köas efter timern
  w.klocka.advance(5_000);                                 // servern arbetar långsamt
  s.slapp();
  await s.klar;
  const [r0, r1] = await Promise.all([itid, forsent]);
  await w.matcher.klockor().klart();
  assert.equal(r0.status, RECEIPT.ok, 'mottagningstiden avgör, inte när kön hann fram');
  assert.equal(r1.status, RECEIPT.rejected);
  const rad = w.rad(matchId);
  const e = rad.match.engine;
  assert.deepEqual(e.players.filter(p => p.status === PLAYER_STATUS.out).map(p => p.id).sort(), [ids[1], ids[2], ids[3]].sort(), 'alla tre som inte valt slås ut');
  const handelser = w.lagring.hamtaHandelser(matchId);
  const ute = handelser.filter(h => h.type === LAG_EVENT.eliminated);
  assert.equal(new Set(ute.map(h => h.revision)).size, 1, 'i samma händelse');
  assert.deepEqual([e.phase, e.winnerTeam, e.endReason], [LAG_FAS.over, 'A', LAG_SLUT.teamOut], 'vinnaren prövas efter hela gruppen');
  assert.equal(handelser.filter(h => h.type === LAG_EVENT.matchOver).length, 1);
  assert.equal(rad.status, MATCH_STATUS.finished);
  assert.equal(w.lagring.hamtaRum(roomId).status, ROOM.closed);
  assert.deepEqual(rad.match.klockor, {}, 'inga klockor efter matchslut');
  assert.equal(w.matcher.klockor().timers(), 0);
});

test('Lagmatch: går de sista spelarna i båda lagen ut samtidigt avbryts matchen utan vinnare', async () => {
  const w = varld({ seed: 3 });
  const { ids, matchId, roomId } = await w.starta(6);
  await w.tick(TURTID_MS - 1);
  assert.ok(w.rad(matchId).match.engine.players.every(p => p.status === PLAYER_STATUS.alive), 'precis före deadline händer inget');
  await w.tick(1);
  const rad = w.rad(matchId);
  assert.deepEqual([rad.match.engine.phase, rad.match.engine.winnerTeam, rad.match.engine.endReason], [LAG_FAS.over, null, LAG_SLUT.noPlayers]);
  assert.equal(rad.status, MATCH_STATUS.aborted, 'avbruten, inte seger utifrån timerordning');
  assert.equal(new Set(w.lagring.hamtaHandelser(matchId).filter(h => h.type === LAG_EVENT.eliminated).map(h => h.revision)).size, 1);
  assert.equal(w.lagring.hamtaRum(roomId).status, ROOM.closed);
  for (const id of ids) assert.equal(w.lagring.hamtaSession(id).activity, ACTIVITY.finished);
});

test('Lagmatch: startbekräftelse, målval, kortspel, försvar och Fortsätt har klockor; den utslagna blockerar aldrig Fortsätt', async () => {
  const w = varld({ seed: 21 });
  const { ids, matchId } = await w.starta(4);
  await spelaTill(w, ids, v => v.phase === LAG_FAS.start);
  assert.deepEqual(Object.keys(w.rad(matchId).match.klockor).sort(), [...ids].sort(), 'startbekräftelse: alla har varsin klocka');
  await spelaTill(w, ids, v => v.phase === LAG_FAS.target);
  const ledare = w.vy(ids[0]).activePlayer;
  assert.deepEqual(Object.keys(w.rad(matchId).match.klockor), [ledare], 'målval: bara ledaren har en klocka');
  await spelaTill(w, ids, v => v.phase === LAG_FAS.attack);
  assert.deepEqual(Object.keys(w.rad(matchId).match.klockor), [w.vy(ids[0]).activePlayer], 'kortspel: bara den som är på tur');
  await spelaTill(w, ids, v => v.phase === LAG_FAS.defence);
  assert.deepEqual(Object.keys(w.rad(matchId).match.klockor), [w.vy(ids[0]).activePlayer], 'försvar och avstående: bara den som är på tur');
  await spelaTill(w, ids, v => v.phase === LAG_FAS.result);
  const borjan = w.klocka.now();
  assert.deepEqual(Object.keys(w.rad(matchId).match.klockor).sort(), [...ids].sort(), 'Fortsätt: alla levande har varsin klocka');
  const [a, b, c, d] = ids;
  await w.tick(30_000);
  for (const id of [a, b, c]) assert.equal((await w.spela(id, H.next)).status, RECEIPT.ok);
  assert.deepEqual(Object.keys(w.rad(matchId).match.klockor), [d]);
  assert.equal(w.rad(matchId).match.klockor[d].deadline, borjan + TURTID_MS, 'de andras bekräftelser flyttar inte deadline');
  await w.tick(TURTID_MS - 30_000 - 1);
  assert.equal(w.rad(matchId).match.engine.phase, LAG_FAS.result);
  await w.tick(1);
  const e = w.rad(matchId).match.engine;
  assert.equal(e.players.find(p => p.id === d).eliminationReason, UTSLAG.timeout);
  assert.equal(e.phase, LAG_FAS.target, 'nästa strid startar direkt – den utslagna väntas inte in');
  assert.deepEqual(Object.keys(w.rad(matchId).match.klockor), [e.activePlayer]);
  assert.notEqual(e.activePlayer, d);
});

test('Onlineduell: den som är på tur har klockan; deadline − 1 ms godtas, exakt deadline är för sent och tiden ute ger förlust', async () => {
  const w = varld({ seed: 2 });
  const { ids: [anna, bo], matchId, roomId } = await w.starta(2);
  const va = w.vy(anna), vb = w.vy(bo);
  assert.deepEqual(va.deadline, { playerId: 'A', at: T0 + TURTID_MS });
  assert.equal(vb.deadline, null, 'Bo väntar och förbrukar ingen tid');
  assert.deepEqual(vb.clocks, { A: T0 + TURTID_MS }, 'Bo ser Annas nedräkning');
  await w.tick(TURTID_MS - 1);
  assert.equal((await w.spela(anna, MATCH_COMMAND.swap, { cards: [] })).status, RECEIPT.ok, '1 ms före deadline är i tid');
  const bosTid = w.klocka.now() + TURTID_MS;
  assert.deepEqual(w.vy(bo).deadline, { playerId: 'B', at: bosTid }, 'Bos val börjar nu');
  w.matcher.stang();   // en sen timer: Bos kommando exakt på deadline hinner fram först – tidsgränsen behandlas ändå före det
  await w.tick(TURTID_MS);
  const sen = await w.spela(bo, MATCH_COMMAND.swap, { cards: [] });
  assert.deepEqual([sen.status, sen.message], [RECEIPT.rejected, TIDEN_UTE]);
  const rad = w.rad(matchId);
  assert.deepEqual([rad.match.engine.phase, rad.match.engine.winner, rad.match.engine.endReason], [PHASE.over, 'A', END.timeout]);
  assert.equal(rad.status, MATCH_STATUS.finished);
  assert.equal(w.lagring.hamtaRum(roomId).status, ROOM.closed);
  assert.equal(w.lagring.hamtaHandelser(matchId).filter(h => h.type === EVENT.matchOver).length, 1);
  assert.equal(await w.matcher.klockor().kontrollera(matchId), false, 'dubbel timer: ingen effekt');
  for (const id of [anna, bo]) assert.equal(w.vy(id).deadline, null);
});

test('Onlineduell: startbekräftelsen har en klocka per spelare; går båda ut samtidigt vinner ingen', async () => {
  const w = varld({ seed: 4 });
  const { ids: [anna, bo], matchId } = await w.starta(2);
  for (let i = 0; i < 4; i++) {
    const id = w.vy(anna).allowed.some(a => a.type === MATCH_COMMAND.swap) ? anna : bo;
    assert.equal((await w.spela(id, MATCH_COMMAND.swap, { cards: [] })).status, RECEIPT.ok);
  }
  const borjan = w.klocka.now();
  assert.equal(w.vy(anna).confirm.kind, MATCH_COMMAND.confirmStart);
  assert.deepEqual(w.vy(anna).clocks, { A: borjan + TURTID_MS, B: borjan + TURTID_MS });
  await w.tick(TURTID_MS - 1);
  assert.equal(w.rad(matchId).match.engine.phase, PHASE.attack);
  await w.tick(1);
  const rad = w.rad(matchId);
  assert.deepEqual([rad.match.engine.phase, rad.match.engine.winner, rad.match.engine.endReason], [PHASE.over, null, END.noWinner]);
  assert.equal(rad.status, MATCH_STATUS.aborted);
  const slut = w.lagring.hamtaHandelser(matchId).filter(h => h.type === EVENT.matchOver);
  assert.deepEqual(slut.map(h => h.data), [{ winner: null, endReason: END.noWinner }]);
});

test('Onlineduell: Fortsätt efter en strid – den som bekräftat väntar utan klocka, den andra förlorar på tid', async () => {
  const w = varld({ seed: 6 });
  const { ids: [anna, bo], matchId } = await w.starta(2);
  const valj = async () => {
    for (const id of [anna, bo]) {
      const v = w.vy(id);
      const a = v.allowed.find(x => x.type !== MATCH_COMMAND.surrender);
      if (!a) continue;
      const payload = a.type === MATCH_COMMAND.swap ? { cards: [] } : a.type === MATCH_COMMAND.attack ? { instanceId: a.simple[0].instanceId, usage: USAGE.simple } : {};
      const type = a.type === MATCH_COMMAND.defend ? MATCH_COMMAND.pass : a.type;
      const r = await w.spela(id, type, payload);
      assert.equal(r.status, RECEIPT.ok, `${type}: ${r.message}`);
      return;
    }
    assert.fail('ingen kan välja');
  };
  while (w.vy(anna).phase !== PHASE.result) await valj();
  assert.equal((await w.spela(anna, MATCH_COMMAND.next)).status, RECEIPT.ok);
  assert.equal(w.vy(anna).deadline, null);
  assert.deepEqual(Object.keys(w.vy(anna).clocks), ['B']);
  await w.tick(TURTID_MS);
  const e = w.rad(matchId).match.engine;
  assert.deepEqual([e.winner, e.endReason], ['A', END.timeout]);
});

test('Timern stoppas i stället för att snurra när en utgången klocka inte får effekt, och efter stang() planeras inget nytt', async () => {
  const klocka = styrdKlocka(T0);
  const ko = skapaKo();
  const klockor = { x: { nyckel: 'k', start: T0, deadline: T0 + 10 } };
  const fel = [];
  let forsok = 0;
  const t = skapaTurklockor({ lagring: { transaktion: fn => fn({}) }, klocka, ko, slump: Math.random, tidsgrans: () => { forsok++; throw new Error('motorfel'); }, klockorFor: () => klockor, logg: { info() {}, warn() {}, error: m => fel.push(m) } });
  t.planera('m1');
  assert.equal(t.timers(), 1);
  klocka.advance(10);
  await t.klart();
  assert.equal(forsok, 1, 'en kontroll');
  assert.equal(t.timers(), 0, 'ingen omplanering efter fel');
  assert.equal(klocka.pending(), 0, 'ingen timer med 0 ms');
  assert.match(fel[0], /motorfel/);
  /* Ett nytt godkänt kommando planerar igen; samma utgångna klocka utan ändring stoppar också. */
  const lugn = skapaTurklockor({ lagring: { transaktion: fn => fn({}) }, klocka, ko, slump: Math.random, tidsgrans: () => false, klockorFor: () => klockor, logg: { info() {}, warn() {}, error() {} } });
  lugn.planera('m1');
  klocka.advance(1);
  await lugn.klart();
  assert.equal(lugn.timers(), 0);
  assert.equal(klocka.pending(), 0);
  /* stang() medan en kontroll ligger i kön: kontrollen får bli klar men planerar inget nytt. */
  let slapp;
  const sparr = new Promise(r => { slapp = r; });
  ko.kor('match:m2', () => sparr);
  const k2 = { y: { nyckel: 'k', start: T0, deadline: klocka.now() + 5 } };
  const sen = skapaTurklockor({ lagring: { transaktion: fn => fn({}) }, klocka, ko, slump: Math.random, tidsgrans: () => false, klockorFor: () => ({ ...k2, y: { ...k2.y, deadline: klocka.now() + 1000 } }), logg: { info() {}, warn() {}, error() {} } });
  sen.planera('m2');
  klocka.advance(5);   // kontrollen köas bakom spärren
  sen.stang();
  slapp();
  await sen.klart();
  assert.equal(sen.timers(), 0, 'ingen ny timer efter stang()');
  assert.equal(klocka.pending(), 0);
});

test('En försenad timer ger aldrig fel vinnare: utgångna klockor behandlas före ett senare kommando', async () => {
  /* Duell: Anna har bekräftat starten, Bos 90 sekunder går ut medan timern är sen, och Anna lämnar. Bo förlorade
     först på tid – Anna vinner, och hennes Lämna avvisas eftersom matchen redan är avgjord. */
  const w = varld({ seed: 4 });
  const { ids: [anna, bo], matchId } = await w.starta(2);
  for (let i = 0; i < 4; i++) {
    const id = w.vy(anna).allowed.some(a => a.type === MATCH_COMMAND.swap) ? anna : bo;
    assert.equal((await w.spela(id, MATCH_COMMAND.swap, { cards: [] })).status, RECEIPT.ok);
  }
  assert.equal((await w.spela(anna, MATCH_COMMAND.confirmStart)).status, RECEIPT.ok);
  w.matcher.stang();   // timern uteblir
  w.klocka.advance(TURTID_MS);
  const lamna = await w.spela(anna, MATCH_COMMAND.surrender);
  assert.equal(lamna.status, RECEIPT.rejected);
  assert.match(lamna.message, /avslutad/);
  const e = w.rad(matchId).match.engine;
  assert.deepEqual([e.phase, e.winner, e.endReason], [PHASE.over, 'A', END.timeout], 'Bo förlorade på tid innan Annas Lämna');
  assert.equal(w.rad(matchId).status, MATCH_STATUS.finished);

  /* Lagmatch: samma mönster under startbytena. */
  const l = varld({ seed: 8 });
  const { ids, matchId: lagId } = await l.starta(4);
  assert.equal((await l.spela(ids[0], H.swap, { cards: [] })).status, RECEIPT.ok);
  l.matcher.stang();
  l.klocka.advance(TURTID_MS);
  const sent = await l.spela(ids[0], H.leave);
  assert.equal(sent.status, RECEIPT.rejected, 'de tre som inte bytt är redan utslagna och matchen avgjord');
  const m = l.rad(lagId).match.engine;
  assert.deepEqual([m.phase, m.winnerTeam, m.endReason], [LAG_FAS.over, 'A', LAG_SLUT.teamOut]);
  assert.deepEqual(m.players.filter(p => p.status === PLAYER_STATUS.out).map(p => p.eliminationReason), [UTSLAG.timeout, UTSLAG.timeout, UTSLAG.timeout]);
  assert.equal(m.players.find(p => p.id === ids[0]).status, PLAYER_STATUS.alive, 'den som lämnade sent är kvar som vinnare');
});
