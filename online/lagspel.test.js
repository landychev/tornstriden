/* Lagmotorn kopplad till servern (arbetsordning L14): testklienter som bara ser sin egen vy spelar 4/6/8. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oppnaLagring } from './lagring.js';
import { skapaSessioner } from './session.js';
import { skapaTjanst } from './tjanst.js';
import { skapaRumshantering } from './rum.js';
import { skapaMatcher } from './matcher.js';
import { LAG_FAS, LAG_HANDLING as H, LAG_SLUT } from '../lagmatch.js';
import { isAlive } from '../lagkortlek.js';
import { LAG_EVENT, LAG_FORMAT } from '../lagvy.js';
import { USAGE } from '../lagregler.js';
import { ACTIVITY, LOBBY_COMMAND, MATCH_STATUS, PLAYER_STATUS, PROTOCOL_VERSION, RECEIPT, ROOM, validatePrivateView, validateEvent, assertNoSecrets } from '../kontrakt.js';
import { styrdKlocka, styrdSlump } from '../teststod.js';

/* En server utan HTTP: lagring, tjänst (kö + kvittenser), sessioner, rum och matchmotorer. */
function varld({ seed = 11, lagspel = true } = {}) {
  const klocka = styrdKlocka(1_000_000);
  const lagring = oppnaLagring({ path: ':memory:', klocka });
  const tjanst = skapaTjanst({ lagring, klocka, slump: styrdSlump(seed) });
  const sessioner = skapaSessioner({ lagring, klocka });
  const rum = skapaRumshantering({ lagring, klocka, ko: tjanst.ko });
  const matcher = skapaMatcher({ lagring, klocka, rum, lagspel });
  sessioner.registrera(tjanst); rum.registrera(tjanst); matcher.registrera(tjanst);
  let n = 0;
  const cmd = (playerId, type, extra = {}, commandId = `c${++n}`) => tjanst.kommando(playerId, { protocolVersion: PROTOCOL_VERSION, commandId, type, payload: {}, ...extra });
  const gaster = (prefix, size) => Array.from({ length: size }, (_, i) => { const { session } = sessioner.skapa(`${prefix}${i + 1}`); sessioner.anslut(session.playerId); return session.playerId; });
  /* Värden (ids[0]) skapar rummet och bjuder in resten; lagen väljs växelvis A, B, A, B … i rummets ordning. */
  async function startaRum(ids, lag = i => (i % 2 ? 'B' : 'A')) {
    const roomId = rum.skapa(ids[0]).id;
    rum.bjudIn(ids[0], roomId, ids.slice(1));
    for (const id of ids.slice(1)) rum.acceptera(id, rum.vyFor(id).inbjudningar.inkommande[0].id);
    ids.forEach((id, i) => rum.valjLag(id, roomId, lag(i)));
    const v = lagring.hamtaRum(roomId).rosterVersion;
    for (const id of ids) rum.redo(id, roomId, true, v);
    const start = await cmd(ids[0], LOBBY_COMMAND.start, { roomId, payload: { rosterVersion: v } });
    return { ids, roomId, start, matchId: lagring.hamtaRum(roomId).matchId };
  }
  const vy = id => matcher.matchFor(id)?.view ?? null;
  const spela = (id, type, payload = {}, { revision, matchId, commandId } = {}) => { const v = vy(id); return cmd(id, type, { matchId: matchId ?? v.matchId, revision: revision ?? v.revision, payload }, commandId); };
  const motor = matchId => lagring.hamtaMatch(matchId).match.engine;
  return { klocka, lagring, tjanst, sessioner, rum, matcher, cmd, gaster, startaRum, vy, spela, motor };
}

/* En testklients val ur sin egen vy (aldrig ur motorn). */
function valFran(view, random, lamnaChans = 0) {
  const pick = list => list[Math.floor(random() * list.length)];
  if (view.allowed.some(a => a.type === H.leave) && random() < lamnaChans) return { type: H.leave, payload: {} };
  const val = view.allowed.filter(a => a.type !== H.leave);
  if (!val.length) return null;
  const a = pick(val);
  switch (a.type) {
    case H.swap: return { type: a.type, payload: { cards: a.cards.filter(() => random() < 0.2).slice(0, a.maxCards).map(c => c.instanceId) } };
    case H.target: return { type: a.type, payload: { targetPlayerId: pick(a.players) } };
    case H.attack: return a.normal.length && random() < 0.7 ? { type: a.type, payload: { instanceId: pick(a.normal).instanceId } } : { type: a.type, payload: { instanceId: pick(a.simple).instanceId, usage: USAGE.simple } };
    case H.defend: {
      if (!a.cards.length || random() >= 0.75) return { type: H.passDefence, payload: {} };
      const c = pick(a.cards);
      return { type: a.type, payload: { instanceId: c.instanceId, ...(c.cardTargets?.length ? { targetInstanceId: pick(c.cardTargets) } : {}), ...(c.playerTargets?.length ? { targetPlayerId: pick(c.playerTargets) } : {}) } };
    }
    default: return { type: a.type, payload: {} };
  }
}

/* Vyernas hemlighet och kontrakt: egen hand stämmer med servern, ingen annans hand finns i vyn
   (utom kort som redan visats i senaste resultatet), och utslagna följer matchen utan val. */
function kontrolleraVyer(w, vyer) {
  const motorer = new Map();
  for (const [id, view] of vyer) {
    if (!view) continue;
    validatePrivateView(view);
    assert.equal(view.viewer, id);
    if (!motorer.has(view.matchId)) motorer.set(view.matchId, w.motor(view.matchId));
    const engine = motorer.get(view.matchId);
    const me = engine.players.find(p => p.id === id);
    assert.deepEqual(view.me.hand.map(c => c.instanceId), me.hand, 'egen hand');
    assert.ok(view.me.hand.every(c => c.instanceId.startsWith(`${view.matchId}:`)), 'bara kort ur den egna matchen');
    assert.ok(view.players.every(p => !('hand' in p)));
    const { lastResult, ...rest } = view;
    const text = JSON.stringify(rest);
    for (const p of engine.players) if (p.id !== id) for (const inst of p.hand) assert.ok(!text.includes(`"${inst}"`), `${p.id}s kort ${inst} syns för ${id}`);
    if (!isAlive(me)) {
      assert.deepEqual(view.allowed, [], 'utslagna har inga val');
      if (engine.phase !== LAG_FAS.over) assert.equal(w.lagring.hamtaSession(id).activity, ACTIVITY.finished, 'utslagen följer matchen');
    }
  }
}

/* Testklienterna väljer samtidigt: alla som har ett val skickar det med sin vys revision i samma omgång.
   Krockar som bara kan uppstå när någon lämnar i samma omgång räknas (ändrat läge, redan utslagen, avslutad). */
async function spelaMatch(w, ids, { random, lamnaChans = 0, maxSteg = 4000, kontroll = true } = {}) {
  const stats = { kommandon: 0, krockar: 0, samtidiga: 0, lamnade: 0, omgangar: 0 };
  for (let steg = 0; steg < maxSteg; steg++) {
    const vyer = ids.map(id => [id, w.vy(id)]).filter(([, v]) => v);
    if (kontroll) kontrolleraVyer(w, vyer);
    if (vyer.every(([, v]) => v.phase === LAG_FAS.over)) return stats;
    const drag = vyer.map(([id, v]) => ({ id, v, val: valFran(v, random, lamnaChans) })).filter(d => d.val);
    assert.ok(drag.length, `ingen kan välja i fas ${vyer[0][1].phase}`);
    if (drag.length > 1) stats.samtidiga++;
    const svar = await Promise.all(drag.map(d => w.cmd(d.id, d.val.type, { matchId: d.v.matchId, revision: d.v.revision, payload: d.val.payload })));
    svar.forEach((r, i) => {
      stats.kommandon++;
      if (r.status === RECEIPT.rejected && /ändrats|redan utslagen|avslutad/.test(r.message)) { stats.krockar++; return; }
      assert.equal(r.status, RECEIPT.ok, `${drag[i].val.type} ${drag[i].id}: ${r.message}`);
      if (drag[i].val.type === H.leave) stats.lamnade++;
    });
    stats.omgangar++;
  }
  assert.fail('matchen tog aldrig slut');
}

function kontrolleraSlut(w, { ids, roomId, matchId }) {
  const rad = w.lagring.hamtaMatch(matchId);
  const engine = rad.match.engine;
  assert.equal(rad.status, MATCH_STATUS.finished);
  assert.equal(engine.phase, LAG_FAS.over);
  assert.equal(w.lagring.hamtaRum(roomId).status, ROOM.closed);
  assert.ok(['A', 'B'].includes(engine.winnerTeam) || engine.endReason === LAG_SLUT.noPlayers);
  for (const id of ids) assert.equal(w.lagring.hamtaSession(id).activity, ACTIVITY.finished);
  const alla = w.lagring.hamtaHandelser(matchId);
  assert.deepEqual(alla.map(e => e.eventId), alla.map((_, i) => i + 1), 'händelser utan luckor');
  assert.equal(alla.at(-1).eventId, rad.match.lastEventId);
  for (const e of alla) { validateEvent(e); assert.equal(e.recipient, null); assert.ok(!JSON.stringify(e.data).includes('"hand"')); }
  return { engine, alla, typer: new Set(alla.map(e => e.type)) };
}

test('Starten väljer lagmotorn för 4/6/8, låser version, medlemskap och lag; varje plats får sin privata vy', async () => {
  for (const size of [4, 6, 8]) {
    const w = varld({ seed: size });
    const ids = w.gaster(`s${size}-`, size);
    const { start, matchId, roomId } = await w.startaRum(ids);
    assert.equal(start.status, RECEIPT.ok, start.message);
    const rad = w.lagring.hamtaMatch(matchId);
    assert.equal(rad.status, MATCH_STATUS.active);
    assert.deepEqual([rad.match.format, rad.match.rulesVersion, rad.match.deckVersion], [LAG_FORMAT, 'lag-v1', `lag-${size * 25}-v1`]);
    const engine = rad.match.engine;
    assert.deepEqual(engine.teams, { A: ids.filter((_, i) => i % 2 === 0), B: ids.filter((_, i) => i % 2 === 1) }, 'rummets ordning blir lagens fasta ordning');
    assert.deepEqual(engine.players.map(p => p.name), ids.map((_, i) => `s${size}-${i + 1}`));
    for (const id of ids) assert.deepEqual([w.lagring.hamtaSession(id).activity, w.lagring.hamtaSession(id).matchId], [ACTIVITY.playing, matchId]);
    kontrolleraVyer(w, ids.map(id => [id, w.vy(id)]));
    const v = w.vy(ids[1]);
    assert.deepEqual([v.format, v.phase, v.teamId, v.me.hand.length, v.swap.round], [LAG_FORMAT, LAG_FAS.swap, 'B', 10, 1]);
    assert.ok(v.players.every(p => p.cardCount === 10 && p.status === PLAYER_STATUS.alive));
    assert.deepEqual(v.allowed.map(a => a.type), [H.swap, H.leave]);
    assertNoSecrets(v, ids[1]);
    assert.throws(() => assertNoSecrets(v, ids[0]), /hand/);
    /* Lagen är låsta efter start */
    assert.match((await w.cmd(ids[0], LOBBY_COMMAND.team, { roomId, payload: { teamId: 'B' } })).message, /Matchen har startat/);
    assert.match((await w.cmd(ids[0], LOBBY_COMMAND.leave, { roomId })).message, /Matchen har startat/);
    w.lagring.stang();
  }
});

test('Lagformaten kan hållas stängda: då spärrar startkontrollen 4/6/8 medan duellen fungerar', async () => {
  const stangd = varld({ lagspel: false });
  const ids = stangd.gaster('x', 4);
  const { start } = await stangd.startaRum(ids);
  assert.equal(start.status, RECEIPT.rejected);
  assert.match(start.message, /4 spelare är ännu inte tillgängligt/);
  const room = stangd.lagring.hamtaRum(stangd.lagring.hamtaSession(ids[0]).roomId);
  assert.deepEqual(stangd.rum.startkontroll(room).tillgangligaFormat, [2]);
  stangd.lagring.stang();
  const oppen = varld();
  const duell = await oppen.startaRum(oppen.gaster('d', 2));
  assert.equal(duell.start.status, RECEIPT.ok);
  assert.equal(oppen.vy(duell.ids[0]).mySeat, 'A', 'duellen går fortfarande till duellmotorn');
  assert.deepEqual(oppen.rum.startkontroll({ players: [] }).tillgangligaFormat, [2, 4, 6, 8]);
  oppen.lagring.stang();
});

test('Separata testklienter spelar hela matcher 4/6/8 med samtidiga byten och bekräftelser; vyerna läcker inga kort', async () => {
  for (const size of [4, 6, 8]) {
    const w = varld({ seed: 30 + size });
    const ids = w.gaster(`h${size}-`, size);
    const rumet = await w.startaRum(ids);
    const stats = await spelaMatch(w, ids, { random: styrdSlump(size * 7) });
    assert.equal(stats.krockar, 0, 'utan avhopp krockar inga samtidiga val');
    assert.ok(stats.samtidiga > 3, `samtidiga omgångar: ${stats.samtidiga}`);
    const { engine, typer } = kontrolleraSlut(w, rumet);
    assert.ok(['A', 'B'].includes(engine.winnerTeam));
    for (const t of [LAG_EVENT.swap, LAG_EVENT.confirm, LAG_EVENT.firstAttacker, LAG_EVENT.target, LAG_EVENT.cardPlayed, LAG_EVENT.result, LAG_EVENT.next, LAG_EVENT.eliminated, LAG_EVENT.matchOver, LAG_EVENT.log]) assert.ok(typer.has(t), `${size}: ${t}`);
    const slut = w.vy(ids[0]);
    assert.deepEqual([slut.phase, slut.matchStatus, slut.winnerTeam, slut.allowed], [LAG_FAS.over, MATCH_STATUS.finished, engine.winnerTeam, []]);
    assert.match((await w.spela(ids[0], H.leave)).message, /avslutad/);
    w.lagring.stang();
  }
});

test('Avhopp via servern: den som lämnar följer matchen utan val, laget spelar vidare och matchen tar slut', async () => {
  let avhopp = 0, avbrutna = 0;
  for (const [size, seed] of [[4, 1], [6, 2], [8, 3], [8, 4]]) {
    const w = varld({ seed });
    const ids = w.gaster(`a${size}${seed}-`, size);
    const rumet = await w.startaRum(ids);
    const stats = await spelaMatch(w, ids, { random: styrdSlump(seed * 13), lamnaChans: 0.01 });
    avhopp += stats.lamnade;
    const { alla } = kontrolleraSlut(w, rumet);
    avbrutna += alla.filter(e => e.type === LAG_EVENT.result && e.data.outcome === 'AVBRUTEN').length;
    for (const e of alla.filter(e => e.type === LAG_EVENT.surrender)) assert.ok(alla.some(x => x.type === LAG_EVENT.eliminated && x.data.playerId === e.data.playerId && x.data.reason === 'LÄMNADE'));
    w.lagring.stang();
  }
  assert.ok(avhopp >= 4, `avhopp: ${avhopp}, avbrutna strider: ${avbrutna}`);
});

test('Samtidiga matcher läcker varken kort eller händelser till varandra', async () => {
  const w = varld({ seed: 77 });
  const forsta = await w.startaRum(w.gaster('m', 4));
  const andra = await w.startaRum(w.gaster('n', 6));
  assert.notEqual(forsta.matchId, andra.matchId);
  await Promise.all([spelaMatch(w, forsta.ids, { random: styrdSlump(1) }), spelaMatch(w, andra.ids, { random: styrdSlump(2) })]);
  for (const rumet of [forsta, andra]) {
    const { alla } = kontrolleraSlut(w, rumet);
    assert.ok(alla.every(e => e.matchId === rumet.matchId));
    const annan = rumet === forsta ? andra : forsta;
    const text = JSON.stringify(alla);
    assert.ok(!text.includes(annan.matchId), 'inga händelser eller kortexemplar från den andra matchen');
    for (const id of rumet.ids) {
      const m = w.matcher.matchFor(id, { efterEventId: 0 });
      assert.equal(m.view.matchId, rumet.matchId);
      assert.ok(m.events.every(e => e.matchId === rumet.matchId));
      assert.ok(m.view.players.every(p => rumet.ids.includes(p.id)), 'bara den egna matchens deltagare');
    }
  }
  w.lagring.stang();
});

/* Spelar fram till första målvalet: alla behåller handen i båda omgångarna och bekräftar starten samtidigt. */
async function tillMalval(w, ids) {
  for (let omgang = 0; omgang < 2; omgang++) {
    const rev = w.vy(ids[0]).revision;
    const svar = await Promise.all(ids.map(id => w.spela(id, H.swap, { cards: [] }, { revision: rev })));
    assert.ok(svar.every(r => r.status === RECEIPT.ok), svar.map(r => r.message).join(' | '));
  }
  const rev = w.vy(ids[0]).revision;
  const svar = await Promise.all(ids.map(id => w.spela(id, H.confirmStart, {}, { revision: rev })));
  assert.ok(svar.every(r => r.status === RECEIPT.ok), svar.map(r => r.message).join(' | '));
  assert.equal(w.vy(ids[0]).phase, LAG_FAS.target);
}

test('Samtidiga val: byten och bekräftelser med samma vy godtas; en upprepad bekräftelse är ofarlig; gamla val avvisas', async () => {
  const w = varld({ seed: 5 });
  const ids = w.gaster('k', 4);
  const { matchId } = await w.startaRum(ids);
  const runda1 = w.vy(ids[0]).revision;
  await tillMalval(w, ids);
  const gammaltByte = await w.spela(ids[0], H.swap, { cards: [] }, { revision: runda1 });
  assert.equal(gammaltByte.status, RECEIPT.rejected);
  assert.equal(w.lagring.hamtaHandelser(matchId).filter(e => e.type === LAG_EVENT.firstAttacker).length, 1, 'striden startade en gång');
  /* Strid 1 till resultat */
  let v = w.vy(ids[0]);
  const leader = v.activePlayer;
  const fiende = v.players.find(p => p.teamId !== v.players.find(q => q.id === leader).teamId).id;
  const foreMal = v.revision;
  assert.equal((await w.spela(leader, H.target, { targetPlayerId: fiende })).status, RECEIPT.ok);
  assert.match((await w.spela(leader, H.target, { targetPlayerId: fiende }, { revision: foreMal })).message, /ändrats/, 'turval kräver exakt revision');
  while (w.vy(ids[0]).phase !== LAG_FAS.result) {
    const aktiv = w.vy(ids[0]).activePlayer;
    const egen = w.vy(aktiv);
    const r = egen.phase === LAG_FAS.attack
      ? await w.spela(aktiv, H.attack, { instanceId: egen.me.hand[0].instanceId, usage: USAGE.simple })
      : await w.spela(aktiv, H.passDefence);
    assert.equal(r.status, RECEIPT.ok, r.message);
  }
  const resultat = w.vy(ids[0]).revision;
  assert.equal((await w.spela(ids[0], H.next)).status, RECEIPT.ok);
  const efterForsta = w.vy(ids[0]).revision;
  const igen = await w.spela(ids[0], H.next, {}, { revision: resultat });
  assert.equal(igen.status, RECEIPT.ok, 'en upprepad bekräftelse är ofarlig');
  assert.equal(w.vy(ids[0]).revision, efterForsta, 'och ändrar ingenting');
  for (const id of ids.slice(1)) assert.equal((await w.spela(id, H.next, {}, { revision: resultat })).status, RECEIPT.ok, 'alla bekräftar utifrån samma resultatvy');
  v = w.vy(ids[0]);
  assert.deepEqual([v.phase, v.battleNumber], [LAG_FAS.target, 2]);
  const sen = await w.spela(ids[1], H.next, {}, { revision: resultat });
  assert.match(sen.message, /ändrats/, 'en Fortsätt från ett gammalt resultat avvisas');
  assert.equal(w.lagring.hamtaHandelser(matchId).filter(e => e.type === LAG_EVENT.next).length, 1, 'övergången skedde en gång');
  w.lagring.stang();
});

test('Identitet och lag kommer från sessionen: påståenden i kommandot avvisas, utomstående och fel tur avvisas', async () => {
  const w = varld({ seed: 6 });
  const ids = w.gaster('i', 4);
  const { matchId } = await w.startaRum(ids);
  const [utomstaende] = w.gaster('u', 1);
  await tillMalval(w, ids);
  const v = w.vy(ids[0]);
  const leader = v.activePlayer;
  const lag = v.players.find(p => p.id === leader).teamId;
  const kamrat = v.players.find(p => p.teamId === lag && p.id !== leader).id;
  const fiende = v.players.find(p => p.teamId !== lag).id;
  const bas = { matchId, revision: v.revision };
  await assert.rejects(w.cmd(kamrat, H.target, { ...bas, playerId: leader, payload: { targetPlayerId: fiende } }), /Identitet/);
  await assert.rejects(w.cmd(kamrat, H.target, { ...bas, teamId: lag, payload: { targetPlayerId: fiende } }), /Identitet/);
  await assert.rejects(w.cmd(kamrat, H.target, { ...bas, payload: { targetPlayerId: fiende, playerId: leader } }), /Identitet/);
  await assert.rejects(w.cmd(kamrat, H.defend, { ...bas, payload: { instanceId: 'x:kort:1', targetInstanceId: 'inte ett kort!' } }), /Målkortet/);
  assert.match((await w.cmd(kamrat, H.target, { ...bas, payload: { targetPlayerId: fiende } })).message, /inte din tur/);
  assert.match((await w.cmd(utomstaende, H.target, { ...bas, payload: { targetPlayerId: fiende } })).message, /deltar inte/);
  assert.match((await w.cmd(leader, H.target, { ...bas, payload: { targetPlayerId: kamrat } })).message, /fiendelaget/);
  assert.match((await w.cmd(leader, H.target, { ...bas, matchId: 'm-finns-inte', payload: { targetPlayerId: fiende } })).message, /finns inte/);
  assert.equal(w.motor(matchId).revision, v.revision, 'matchen är orörd');
  w.lagring.stang();
});

test('Den som lämnat kan gå till lobbyn och spela en ny match; ett gammalt matchkommando påverkar inte den nya', async () => {
  const w = varld({ seed: 8 });
  const ids = w.gaster('g', 4);
  const { matchId, roomId } = await w.startaRum(ids);
  const [, , a2] = ids;
  const fore = w.vy(a2);
  const lamna = await w.spela(a2, H.leave, {}, { commandId: 'a2-lamnar' });
  assert.equal(lamna.status, RECEIPT.ok, lamna.message);
  const efter = w.vy(a2);
  assert.deepEqual([efter.me.status, efter.me.eliminationReason, efter.me.hand, efter.allowed], [PLAYER_STATUS.out, 'LÄMNADE', [], []]);
  assert.equal(w.lagring.hamtaSession(a2).activity, ACTIVITY.finished);
  assert.equal(w.vy(ids[0]).players.find(p => p.id === a2).status, PLAYER_STATUS.out, 'de andra ser att a2 är utslagen');
  /* Tillbaka till lobbyn – matchen och rummet påverkas inte */
  const ut = await w.cmd(a2, LOBBY_COMMAND.leave, { roomId });
  assert.equal(ut.status, RECEIPT.ok, ut.message);
  assert.deepEqual([w.lagring.hamtaSession(a2).activity, w.lagring.hamtaSession(a2).matchId, w.vy(a2)], [ACTIVITY.idle, null, null]);
  assert.deepEqual([w.lagring.hamtaRum(roomId).status, w.lagring.hamtaRum(roomId).players.length], [ROOM.started, 4]);
  assert.match((await w.cmd(ids[0], LOBBY_COMMAND.leave, { roomId })).message, /Matchen har startat/, 'en spelande kan inte lämna rummet');
  const revision = w.motor(matchId).revision;
  /* Ny duell för a2 */
  const [ny] = w.gaster('ny', 1);
  const duell = await w.startaRum([a2, ny]);
  assert.equal(duell.start.status, RECEIPT.ok, duell.start.message);
  const duellRevision = w.vy(a2).revision;
  /* Gamla kommandon: nytt commandId mot gamla matchen, och det redan använda Lämna igen */
  assert.match((await w.cmd(a2, H.swap, { matchId, revision: fore.revision, payload: { cards: [] } })).message, /deltar inte/);
  assert.deepEqual(await w.cmd(a2, H.leave, { matchId, revision: fore.revision, payload: {} }, 'a2-lamnar'), lamna, 'samma kommando ger samma kvittens utan ny effekt');
  assert.equal(w.motor(matchId).revision, revision);
  assert.equal(w.vy(a2).matchId, duell.matchId);
  assert.equal(w.vy(a2).revision, duellRevision, 'den nya matchen är orörd');
  /* Den gamla matchen spelar vidare utan a2 */
  const rest = ids.filter(id => id !== a2);
  await spelaMatch(w, rest, { random: styrdSlump(4) });
  assert.equal(w.lagring.hamtaMatch(matchId).status, MATCH_STATUS.finished);
  assert.equal(w.lagring.hamtaSession(a2).matchId, duell.matchId, 'matchslutet rör inte den som redan gått vidare');
  w.lagring.stang();
});

test('Ett motorfel sparar ingenting och ger ingen vinnare', async () => {
  const w = varld({ seed: 9 });
  const ids = w.gaster('f', 4);
  const { matchId } = await w.startaRum(ids);
  const rad = w.lagring.hamtaMatch(matchId);
  rad.match.engine.drawPile.pop();   // trasig kortbokföring
  w.lagring.sparaMatch(rad.match, rad.status);
  const r = await w.spela(ids[0], H.swap, { cards: [] });
  assert.equal(r.status, RECEIPT.error);
  const efter = w.lagring.hamtaMatch(matchId);
  assert.deepEqual([efter.status, efter.match.engine.revision, efter.match.engine.winnerTeam, w.lagring.hamtaHandelser(matchId).length], [MATCH_STATUS.active, 0, null, 0]);
  w.lagring.stang();
});
