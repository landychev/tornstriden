import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skapaOnlineMatch, PENDING } from './onlinematch.js';
import { PROTOCOL_VERSION, RECEIPT, ADAPTER_MODE, MATCH_COMMAND, assertAdapter } from './kontrakt.js';
import { styrdKlocka } from './teststod.js';

const vy = (extra = {}) => ({ protocolVersion: PROTOCOL_VERSION, matchId: 'm1', revision: 0, lastEventId: 0, rulesVersion: 'duell-v1', deckVersion: 'duell-50-v1', viewer: 'A', mySeat: 'A', teamId: 'A', phase: 'KORTBYTE', me: { id: 'A', name: 'Anna', life: 3, hand: [] }, players: [], allowed: [], pending: null, deadline: null, confirm: null, ...extra });
const svar = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const kommando = (revision = 0, commandId = 'c1') => ({ protocolVersion: PROTOCOL_VERSION, commandId, type: MATCH_COMMAND.swap, matchId: 'm1', revision, payload: { cards: [] } });
const ok = (commandId, revision) => ({ commandId, status: RECEIPT.ok, message: null, revision, roomRevision: null, eventId: revision, fingerprint: 'ff' });

for (const hangs of ['fetch', 'body']) test(`Tidsgräns för ${hangs}: kontrollera samma kommando utan extra drag eller sen effekt`, async () => {
  const klocka = styrdKlocka();
  const calls = [];
  let release;
  const hanging = new Promise(resolve => { release = resolve; });
  const adapter = skapaOnlineMatch({
    initial: { view: vy() }, klocka, timeoutMs: 100, vanta: async () => {},
    fetchFn: async (path, init) => {
      calls.push({ path, ...init });
      if (calls.length === 1) return hangs === 'fetch' ? hanging : { status: 200, ok: true, text: () => hanging };
      assert.match(path, /\/api\/status\?commandId=c1&scope=match%3Am1/);
      return svar(200, ok('c1', 0));
    }
  });
  const sending = adapter.send(kommando());
  await new Promise(setImmediate);
  klocka.advance(100);
  assert.equal((await sending).status, RECEIPT.ok);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].signal.aborted);
  assert.equal(adapter.view().pending, null);
  assert.equal(klocka.pending(), 0);
  const notifications = [];
  adapter.pa(status => notifications.push(status));
  release(hangs === 'fetch' ? svar(401, {}) : JSON.stringify(ok('c1', 99)));
  await new Promise(setImmediate);
  assert.equal(adapter.view().revision, 0, 'sent svar får ingen effekt');
  assert.deepEqual(notifications, []);
});

test('Även fastnade status- och uppdateringsanrop har tidsgräns och lämnar vänteläget', async () => {
  const klocka = styrdKlocka();
  const calls = [];
  const adapter = skapaOnlineMatch({
    initial: { view: vy() }, klocka, timeoutMs: 100, vanta: async () => {}, maxForsok: 2,
    fetchFn: (path, init) => { calls.push({ path, ...init }); return new Promise(() => {}); }
  });
  const sending = adapter.send(kommando());
  for (let i = 0; i < 3; i++) { klocka.advance(100); await new Promise(setImmediate); }
  assert.equal((await sending).status, RECEIPT.error);
  assert.equal(calls.length, 3);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(adapter.view().pending, null);
  const refresh = adapter.refresh();
  klocka.advance(100);
  await refresh;
  assert.ok(calls.every(c => c.signal.aborted));
  assert.equal(klocka.pending(), 0);
});

/* En fejkad server: en lista med svar per anrop (i ordning) och en logg över vad som anropades. */
function fejk(svaren) {
  const logg = [];
  const fetchFn = async (path, init = {}) => {
    logg.push(`${init.method ?? 'GET'} ${path.split('?')[0]}`);
    const next = svaren.shift();
    if (!next) throw new Error('inget svar förberett');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchFn, logg };
}

test('Adaptern uppfyller gränssnittet, saknar local och avvisar gamla vyer', () => {
  const adapter = assertAdapter(skapaOnlineMatch({ initial: { view: vy({ revision: 3, lastEventId: 7 }), events: [], status: 'PÅGÅR' } }));
  assert.equal(adapter.mode, ADAPTER_MODE.online);
  assert.equal(adapter.viewer(), 'A');
  assert.ok(!('local' in adapter));
  const seen = [];
  adapter.subscribe((v, events) => seen.push({ revision: v.revision, events: events.map(e => e.eventId) }));
  assert.equal(adapter.receive({ view: vy({ revision: 2, lastEventId: 5 }), events: [] }), false, 'gammal vy ignoreras');
  assert.equal(adapter.receive({ view: vy({ matchId: 'annan', revision: 9, lastEventId: 9 }), events: [] }), false, 'annan match ignoreras');
  assert.equal(adapter.receive({ view: vy({ revision: 4, lastEventId: 9 }), events: [{ eventId: 7 }, { eventId: 8 }, { eventId: 9 }] }), true);
  assert.deepEqual(seen, [{ revision: 4, events: [8, 9] }], 'bara nya händelser levereras');
  assert.equal(adapter.view().revision, 4);
  assert.equal(adapter.receive({ view: vy({ revision: 4, lastEventId: 9 }), events: [] }), true);
  assert.equal(seen.length, 1, 'oförändrad vy ger ingen ny notis');
});

test('Ett drag: väntande status under sändning, kvittens tillbaka, vyn hämtas om kvittensen är nyare', async () => {
  const { fetchFn, logg } = fejk([svar(200, ok('c1', 1)), svar(200, { view: vy({ revision: 1, lastEventId: 2 }), events: [{ eventId: 1 }, { eventId: 2 }], status: 'PÅGÅR' })]);
  const adapter = skapaOnlineMatch({ initial: { view: vy(), status: 'PÅGÅR' }, fetchFn, vanta: async () => {} });
  const pendings = [];
  adapter.subscribe(v => pendings.push(v.pending?.status ?? null));
  const receipt = await adapter.send(kommando());
  assert.equal(receipt.status, RECEIPT.ok);
  assert.deepEqual(logg, ['POST /api/kommando', 'GET /api/match']);
  assert.equal(adapter.view().revision, 1);
  assert.equal(pendings[0], PENDING.sending);
  assert.equal(pendings.at(-1), null);
  assert.equal(adapter.view().pending, null);
});

test('Tappad kvittens: statusfrågan hittar draget – inget extra drag skickas', async () => {
  const { fetchFn, logg } = fejk([new Error('nätet dog'), svar(200, ok('c1', 1)), svar(200, { view: vy({ revision: 1, lastEventId: 1 }), events: [], status: 'PÅGÅR' })]);
  const adapter = skapaOnlineMatch({ initial: { view: vy(), status: 'PÅGÅR' }, fetchFn, vanta: async () => {} });
  const lagen = [];
  adapter.subscribe(v => lagen.push(v.pending?.status ?? null));
  const receipt = await adapter.send(kommando());
  assert.equal(receipt.status, RECEIPT.ok);
  assert.deepEqual(logg, ['POST /api/kommando', 'GET /api/status', 'GET /api/match']);
  assert.ok(lagen.includes(PENDING.checking));
});

test('Tappad kvittens: OKÄND på servern och oförändrad revision – samma kommando skickas om en gång', async () => {
  const { fetchFn, logg } = fejk([
    new Error('nätet dog'),
    svar(200, { commandId: 'c1', status: RECEIPT.unknown, message: null, revision: null, roomRevision: null, eventId: null, fingerprint: null }),
    svar(200, { view: vy(), events: [], status: 'PÅGÅR' }),
    svar(200, ok('c1', 1)),
    svar(200, { view: vy({ revision: 1, lastEventId: 1 }), events: [], status: 'PÅGÅR' })
  ]);
  const adapter = skapaOnlineMatch({ initial: { view: vy(), status: 'PÅGÅR' }, fetchFn, vanta: async () => {} });
  const receipt = await adapter.send(kommando());
  assert.equal(receipt.status, RECEIPT.ok);
  assert.deepEqual(logg, ['POST /api/kommando', 'GET /api/status', 'GET /api/match', 'POST /api/kommando', 'GET /api/match']);
});

test('Tappad kvittens: OKÄND men matchen har gått vidare – inget omsänt drag, spelaren får välja igen', async () => {
  const { fetchFn, logg } = fejk([
    new Error('nätet dog'),
    svar(200, { commandId: 'c1', status: RECEIPT.unknown, message: null, revision: null, roomRevision: null, eventId: null, fingerprint: null }),
    svar(200, { view: vy({ revision: 2, lastEventId: 3 }), events: [], status: 'PÅGÅR' })
  ]);
  const adapter = skapaOnlineMatch({ initial: { view: vy(), status: 'PÅGÅR' }, fetchFn, vanta: async () => {} });
  const receipt = await adapter.send(kommando());
  assert.equal(receipt.status, RECEIPT.rejected);
  assert.match(receipt.message, /ändrats/);
  assert.deepEqual(logg, ['POST /api/kommando', 'GET /api/status', 'GET /api/match']);
  assert.equal(adapter.view().revision, 2);
});

test('Servern nås inte alls: INTERNT_FEL med begripligt besked efter begränsat antal försök; 401 och 400 ger direkta svar', async () => {
  const fel = Array.from({ length: 20 }, () => new Error('nätet dog'));
  const { fetchFn, logg } = fejk(fel);
  const adapter = skapaOnlineMatch({ initial: { view: vy(), status: 'PÅGÅR' }, fetchFn, vanta: async () => {}, maxForsok: 2 });
  const receipt = await adapter.send(kommando());
  assert.equal(receipt.status, RECEIPT.error);
  assert.match(receipt.message, /nätet dog|kontakt/);
  assert.equal(logg.filter(l => l.startsWith('GET /api/status')).length, 2);
  assert.equal(adapter.view().pending, null);
  const { fetchFn: f401 } = fejk([svar(401, { message: 'Ingen session.' })]);
  const utloggad = skapaOnlineMatch({ initial: { view: vy(), status: 'PÅGÅR' }, fetchFn: f401 });
  const statusar = []; utloggad.pa(s => statusar.push(s));
  const r401 = await utloggad.send(kommando());
  assert.equal(r401.status, RECEIPT.rejected);
  assert.match(r401.message, /session/i);
  assert.deepEqual(statusar, ['utloggad']);
  const { fetchFn: f400 } = fejk([svar(400, { message: 'command.revision: krävs.' })]);
  const r400 = await skapaOnlineMatch({ initial: { view: vy(), status: 'PÅGÅR' }, fetchFn: f400 }).send(kommando());
  assert.equal(r400.status, RECEIPT.rejected);
  assert.match(r400.message, /revision/);
});

test('Två drag samtidigt: det andra avvisas lokalt tills kvittensen kommit', async () => {
  let release;
  const fetchFn = () => new Promise(resolve => { release = () => resolve(svar(200, ok('c1', 1))); });
  const adapter = skapaOnlineMatch({ initial: { view: vy({ revision: 1, lastEventId: 1 }), status: 'PÅGÅR' }, fetchFn });
  const first = adapter.send(kommando(1, 'c1'));
  const second = await adapter.send(kommando(1, 'c2'));
  assert.equal(second.status, RECEIPT.rejected);
  assert.match(second.message, /förra drag/);
  release();
  assert.equal((await first).status, RECEIPT.ok);
});

/* L17: en låtsasström som testet styr. readyState 0 = CONNECTING, 1 = OPEN, 2 = CLOSED. */
function skapaStromfabrik() {
  const strommar = [];
  class FalskStrom {
    constructor(url) { this.url = url; this.readyState = 0; this.lyssnare = {}; this.onerror = null; strommar.push(this); }
    addEventListener(typ, fn) { (this.lyssnare[typ] ??= []).push(fn); }
    close() { this.readyState = 2; }
    skicka(typ, data) { this.readyState = 1; for (const fn of this.lyssnare[typ] ?? []) fn({ data: JSON.stringify(data) }); }
    fel(stangd) { this.readyState = stangd ? 2 : 0; this.onerror?.(); }
  }
  return { FalskStrom, strommar };
}
const halsa = { tjanst: 'tornstriden-online', protocolVersion: 1, matchtrafik: { oppen: true, orsak: null } };

test('Anslutning (L17): drag spärras medan strömmen är borta, ping besvaras med sitt nummer, och en ström som gett upp öppnas igen', async () => {
  const klocka = styrdKlocka();
  const anrop = [];
  const adapter = skapaOnlineMatch({ initial: { view: vy() }, klocka, fetchFn: async (path, init) => { anrop.push({ path, ...init }); return path.startsWith('/api/match') ? svar(200, { view: vy() }) : svar(204, null); } });
  const lagen = [];
  adapter.pa(lage => lagen.push(lage));
  const { FalskStrom, strommar } = skapaStromfabrik();
  adapter.connect(FalskStrom);
  assert.equal((await adapter.send(kommando())).status, RECEIPT.rejected, 'inga drag innan servern hälsat');
  strommar[0].skicka('halsa', halsa);
  assert.equal(adapter.ansluten(), true);
  strommar[0].skicka('ping', { n: 7 });
  await new Promise(setImmediate);
  const livstecken = anrop.find(a => a.path === '/api/livstecken');
  assert.deepEqual([livstecken.method, livstecken.body], ['POST', '{"n":7}']);
  /* Tillfälligt fel: webbläsaren återansluter själv (CONNECTING) – ingen egen ny ström. */
  strommar[0].fel(false);
  assert.equal(adapter.ansluten(), false);
  assert.match((await adapter.send(kommando())).message, /Återansluter/);
  assert.equal(klocka.pending(), 0);
  /* Strömmen har gett upp för gott (t.ex. 502 från proxyn): adaptern öppnar en ny efter en paus. */
  strommar[0].fel(true);
  assert.equal(strommar.length, 1);
  klocka.advance(1000);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(strommar.length, 2, 'ny ström');
  assert.ok(anrop.some(a => a.path.startsWith('/api/match')), 'sessionen och matchen kontrolleras först');
  strommar[1].skicka('halsa', halsa);
  assert.equal(adapter.ansluten(), true);
  assert.deepEqual(lagen.filter((l, i) => l !== lagen[i - 1]), ['ansluter', 'ansluten', 'ateransluter', 'ansluter', 'ansluten']);
  /* En ersatt flik försöker aldrig igen. */
  strommar[1].skicka('ersatt', {});
  strommar[1].fel(true);
  klocka.advance(60_000);
  assert.equal(strommar.length, 2);
});
