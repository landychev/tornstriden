import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startaServer, PING_MS, TYST_MS, OMLADDNING_MS } from './server.js';
import { oppnaLagring } from './lagring.js';
import { isBlocked, ROOT, skapaFilserver } from '../server.js';
import { PROTOCOL_VERSION, MATCH_COMMAND, assertNoSecrets, validatePrivateView } from '../kontrakt.js';
import { styrdKlocka, styrdSlump } from '../teststod.js';

const tyst = { info() {}, warn() {}, error() {} };
async function medServer(fn, extra = {}) {
  const klocka = styrdKlocka(1_000_000);
  const app = startaServer({ port: 0, dataDir: ':memory:', klocka, logg: tyst, ...extra });
  await app.klar;
  const url = path => `http://127.0.0.1:${app.port()}${path}`;
  try { await fn({ app, url, klocka }); } finally { await app.stang(); }
}

test('Hälsokontrollen svarar och serverkod, tester och databas kan inte hämtas som statiska filer', () => medServer(async ({ url }) => {
  const halsa = await (await fetch(url('/api/halsa'))).json();
  assert.equal(halsa.tjanst, 'tornstriden-online');
  assert.equal(halsa.protocolVersion, PROTOCOL_VERSION);
  assert.equal(halsa.matchtrafik.oppen, true);
  for (const path of ['/online/server.js', '/online/lagring.js', '/online/tjanst.test.js', '/teststod.js', '/kontrakt.test.js', '/package.json', '/deploy.sh', '/scripts/skapa-ljud.py', '/.git/HEAD', '/online/../online/lagring.js', '/x%2f..%2fonline/server.js', '/x%2f..%2f.git/HEAD', '/%2f%2fonline/server.js', '/server.js', '/package-lock.json']) {
    assert.equal((await fetch(url(path))).status, 404, path);
  }
  assert.equal((await fetch(url('/%zz'))).status, 400);
  assert.equal((await fetch(url('/favicon.ico'))).status, 204);
  for (const path of ['/match.html', '/kontrakt.js', '/match.js', '/lobby.html', '/x%2f..%2fmatch.html', '/lagmatch.html', '/lagmatch.css', '/lagmatchvy.js', '/kortlupp.js']) assert.equal((await fetch(url(path))).status, 200, path);
  for (const path of ['/lagmatch.js', '/lagvy.js', '/lagkortlek.js', '/online/lagspel.js']) assert.equal((await fetch(url(path))).status, 404, `${path}: lagmotorn körs bara på servern`);
  assert.equal((await fetch(url('/api/okand'))).status, 404);
}));

test('Statiska filer får inte länka till serverkod eller utanför webbroten', async () => {
  /* En egen webbrot i en temporär katalog: arbetskatalogen får aldrig testlänkar. */
  const tmp = mkdtempSync(join(tmpdir(), 'tornstriden-static-'));
  const root = join(tmp, 'rot'), outside = join(tmp, 'utanfor');
  for (const dir of [join(root, 'assets', 'l'), join(root, 'online'), outside]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'online', 'server.js'), 'serverkod');
  writeFileSync(join(root, 'assets', 'l', 'riktig.png'), 'bild');
  writeFileSync(join(outside, 'privat.png'), 'privat');
  symlinkSync(join(outside, 'privat.png'), join(root, 'assets', 'l', 'outside.png'));
  symlinkSync(join(root, 'online', 'server.js'), join(root, 'assets', 'l', 'server.png'));
  const server = createServer(skapaFilserver(root));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = path => `http://127.0.0.1:${server.address().port}${path}`;
  try {
    assert.equal((await fetch(url('/assets/l/riktig.png'))).status, 200, 'en vanlig bild serveras');
    for (const file of ['outside.png', 'server.png']) assert.equal((await fetch(url('/assets/l/' + file))).status, 404, file);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Den statiska utvecklingsservern spärrar samma vägar', () => {
  for (const path of ['/online', '/online/lagring.js', '/node_modules/x.js', '/.git/config', '/match.test.js', '/teststod.js']) assert.ok(isBlocked(path), path);
  for (const path of ['/match.html', '/kontrakt.js', '/assets/kort/drakeld.jpg', '/lobby.html']) assert.ok(!isBlocked(path), path);
});

test('Kommandon kräver rätt ursprung, en session och JSON av rimlig storlek', () => medServer(async ({ url }) => {
  const origin = url('');
  const skapad = await fetch(url('/api/session'), { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ nick: 'Anna' }) });
  const cookie = skapad.headers.get('set-cookie').split(';')[0];
  const post = (body, headers = { 'content-type': 'application/json', origin, cookie }) => fetch(url('/api/kommando'), { method: 'POST', headers, body });
  assert.equal((await post('{}', { 'content-type': 'application/json', cookie })).status, 403, 'utan Origin');
  assert.equal((await post('{}', { 'content-type': 'application/json', origin: 'https://annan.example', cookie })).status, 403, 'främmande Origin');
  const utanSession = await post('{}', { 'content-type': 'application/json', origin });
  assert.equal(utanSession.status, 401);
  assert.match((await utanSession.json()).message, /session/i);
  assert.equal((await post('{inte json')).status, 400);
  assert.equal((await post(JSON.stringify({ fyll: 'x'.repeat(3000) }))).status, 413);
  const fel = await post(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: 'c1', type: MATCH_COMMAND.next, revision: 0, payload: {} }));
  assert.equal(fel.status, 400, 'kontraktsfel (saknat matchId)');
  assert.equal((await fel.json()).field, 'command.matchId');
  const ok = await post(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, commandId: 'c1', type: MATCH_COMMAND.next, matchId: 'm1', revision: 0, payload: {} }));
  assert.equal((await ok.json()).status, 'AVVISAD', 'matchkommandon har ingen hanterare ännu (L08)');
  assert.equal((await fetch(url('/api/kommando'))).status, 404, 'GET på kommando är ingen adress');
}));

function lasSseBlock(reader, timeoutMs = 2000) {
  const decoder = new TextDecoder();
  let buffer = '';
  return async () => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { reject(new Error('SSE-händelsen uteblev')); void reader.cancel(); }, timeoutMs);
    });
    try {
      return await Promise.race([(async () => {
        while (!buffer.includes('\n\n')) {
          const { value, done } = await reader.read();
          if (done) throw new Error('Strömmen stängdes före en komplett SSE-händelse');
          buffer += decoder.decode(value, { stream: true });
        }
        const index = buffer.indexOf('\n\n');
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        return block;
      })(), timeout]);
    } finally { clearTimeout(timer); }
  };
}

test('SSE-provet läser hela händelser oavsett paketgränser och delade UTF-8-tecken', async () => {
  const blocks = ['event: halsa\ndata: {}', 'event: lobby\ndata: {"nick":"Åsa"}', ': puls'];
  const bytes = new TextEncoder().encode(blocks.join('\n\n') + '\n\n');
  for (const chunks of [[bytes], [...bytes].map(b => Uint8Array.of(b)), blocks.map(b => new TextEncoder().encode(b + '\n\n'))]) {
    const reader = new ReadableStream({ start(c) { chunks.forEach(chunk => c.enqueue(chunk)); c.close(); } }).getReader();
    const read = lasSseBlock(reader);
    try { for (const block of blocks) assert.equal(await read(), block); }
    finally { await reader.cancel(); }
  }
});

test('SSE-provet avbryter och städar en ström som aldrig ger en hel händelse', async () => {
  let cancelled = false;
  const reader = new ReadableStream({ cancel() { cancelled = true; } }).getReader();
  await assert.rejects(lasSseBlock(reader, 10)(), /uteblev/);
  assert.ok(cancelled);
});

test('Händelseströmmen öppnas med hälsa, pingar via den injicerade klockan, hålls vid liv av livstecken och stängs vid tystnad (L17)', () => medServer(async ({ app, url, klocka }) => {
  assert.equal((await fetch(url('/api/handelser'))).status, 401, 'strömmen kräver session');
  const cookie = (await fetch(url('/api/session'), { method: 'POST', headers: { 'content-type': 'application/json', origin: url('') }, body: JSON.stringify({ nick: 'Anna' }) })).headers.get('set-cookie').split(';')[0];
  const response = await fetch(url('/api/handelser'), { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const read = lasSseBlock(reader);
  try {
    assert.match(await read(), /^retry: 3000\nevent: halsa\ndata: \{.*"protocolVersion":1/);
    assert.match(await read(), /event: lobby\ndata: \{"me":\{"playerId":"p-[0-9a-f]+","nick":"Anna","activity":"LEDIG","connection":"ANSLUTEN"\}/);
    assert.equal(app.strommar.size, 1);
    klocka.advance(PING_MS);
    assert.match(await read(), /^event: ping\ndata: \{"n":1\}/);
    const livstecken = await fetch(url('/api/livstecken'), { method: 'POST', headers: { cookie, origin: url('') } });
    assert.equal(livstecken.status, 204);
    assert.equal((await fetch(url('/api/livstecken'), { method: 'POST', headers: { origin: url('') } })).status, 401, 'livstecken kräver session');
    klocka.advance(PING_MS);
    assert.match(await read(), /^event: ping\ndata: \{"n":2\}/);
    /* Inga fler livstecken: efter TYST_MS från det senaste stängs strömmen och spelaren blir frånkopplad. */
    klocka.advance(PING_MS);
    assert.match(await read(), /^event: ping\ndata: \{"n":3\}/);
    assert.equal(app.strommar.size, 1, 'precis före gränsen är strömmen kvar');
    klocka.advance(TYST_MS - 2 * PING_MS);
    assert.equal(app.strommar.size, 0, 'tyst anslutning räknas som avbruten');
    assert.equal(app.lagring.listaSessioner(klocka.now())[0].connection, 'FRÅNKOPPLAD');
  } finally { await reader.cancel(); }
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(app.strommar.size, 0, 'stängd anslutning städas bort');
  assert.equal(klocka.pending(), 1, 'ingen pingtimer kvar – bara den periodiska städningen');
}));

test('Databasen hamnar utanför webbroten; en omstart avbryter pågående matcher utan vinnare innan servern öppnar, en gång (L18)', async () => {
  assert.throws(() => startaServer({ port: 0, dataDir: join(ROOT, 'assets'), logg: tyst }), /webbroten/);
  const dir = mkdtempSync(join(tmpdir(), 'tornstriden-'));
  const dataDir = join(dir, 'data');
  /* Första körningen: en duell pågår och en annan duell har redan avgjorts (Cia ger upp). */
  const forsta = startaServer({ port: 0, dataDir, logg: tyst });
  await forsta.klar;
  assert.equal(forsta.dbPath, join(dataDir, 'tornstriden.sqlite'));
  const duell = async (nicks, commandId) => {
    const ids = nicks.map(nick => { const { session } = forsta.sessioner.skapa(nick); forsta.sessioner.anslut(session.playerId); return session.playerId; });
    const room = forsta.rum.skapa(ids[0]);
    forsta.rum.bjudIn(ids[0], room.id, [ids[1]]);
    forsta.rum.acceptera(ids[1], forsta.rum.vyFor(ids[1]).inbjudningar.inkommande[0].id);
    forsta.rum.valjLag(ids[0], room.id, 'A'); forsta.rum.valjLag(ids[1], room.id, 'B');
    const rv = forsta.lagring.hamtaRum(room.id).rosterVersion;
    for (const id of ids) forsta.rum.redo(id, room.id, true, rv);
    const start = await forsta.tjanst.kommando(ids[0], { protocolVersion: 1, commandId, type: 'STARTA', roomId: room.id, payload: { rosterVersion: rv } });
    assert.equal(start.status, 'GODKÄND');
    return { ids, room, matchId: forsta.lagring.hamtaRum(room.id).matchId };
  };
  const { ids, room, matchId } = await duell(['Anna', 'Bo'], 's1');
  /* En andra instans på samma port och med samma data startar inte, och den rör inte den körande serverns matcher eller sessioner. */
  const krock = startaServer({ port: forsta.port(), dataDir, logg: tyst });
  await assert.rejects(krock.klar, /EADDRINUSE/);
  assert.equal(krock.omstart, null, 'ingen uppstädning utan port');
  assert.equal(forsta.lagring.hamtaMatch(matchId).status, 'PÅGÅR');
  for (const id of ids) assert.equal(forsta.lagring.hamtaSession(id).connection, 'ANSLUTEN');
  const avgjord = await duell(['Cia', 'Dag'], 's0');
  const geUpp = { protocolVersion: 1, commandId: 'g0', type: 'GE_UPP', matchId: avgjord.matchId, revision: forsta.matcher.matchFor(avgjord.ids[0]).view.revision, payload: {} };
  const uppgiven = await forsta.tjanst.kommando(avgjord.ids[0], geUpp);
  assert.equal(uppgiven.status, 'GODKÄND', uppgiven.message);
  const avgjordFore = { rad: forsta.lagring.hamtaMatch(avgjord.matchId), handelser: forsta.lagring.hamtaHandelser(avgjord.matchId) };
  assert.deepEqual([avgjordFore.rad.status, avgjordFore.rad.match.engine.winner], ['AVSLUTAD', 'B']);
  const vy = forsta.matcher.matchFor(ids[0]).view;
  const drag = await forsta.tjanst.kommando(ids[0], { protocolVersion: 1, commandId: 'd1', type: 'BEKRÄFTA_BYTE', matchId, revision: vy.revision, payload: { cards: [] } });
  assert.equal(drag.status, 'GODKÄND');
  const fore = forsta.lagring.hamtaMatch(matchId).match;
  /* Processen dör utan att städa (inga sluthändelser sparas vid avstängning). */
  await forsta.stang();
  /* Andra körningen: matchen avbryts innan servern lyssnar. */
  const andra = startaServer({ port: 0, dataDir, logg: tyst });
  assert.equal(andra.omstart, null, 'uppstädningen väntar tills porten är tagen');
  await andra.klar;
  assert.deepEqual([andra.omstart.avbrutna, andra.omstart.matcher], [1, [matchId]]);
  const halsa = await (await fetch(`http://127.0.0.1:${andra.port()}/api/halsa`)).json();
  assert.equal(halsa.matchtrafik.oppen, true, 'startspärren är borta');
  const rad = andra.lagring.hamtaMatch(matchId);
  assert.equal(rad.status, 'AVBRUTEN');
  assert.deepEqual([rad.match.engine.phase, rad.match.engine.winner, rad.match.engine.endReason], ['AVSLUTAD', null, 'SERVERAVBROTT']);
  assert.deepEqual(rad.match.engine.players.map(p => p.life), fore.engine.players.map(p => p.life), 'inga liv förlorade');
  assert.deepEqual([rad.match.klockor, rad.match.avbrott, rad.match.confirm], [{}, {}, null]);
  const handelser = andra.lagring.hamtaHandelser(matchId);
  assert.deepEqual(handelser.map(e => e.eventId), handelser.map((_, i) => i + 1), 'inga luckor');
  assert.deepEqual(handelser.filter(e => e.type === 'MATCHSLUT').map(e => e.data), [{ winner: null, endReason: 'SERVERAVBROTT' }]);
  /* Det sparade slutresultatet för den avgjorda matchen rörs inte. */
  assert.deepEqual({ rad: andra.lagring.hamtaMatch(avgjord.matchId), handelser: andra.lagring.hamtaHandelser(avgjord.matchId) }, avgjordFore, 'avgjord match oförändrad');
  assert.deepEqual(await andra.tjanst.kommando(avgjord.ids[0], geUpp), uppgiven, 'den avgjorda matchens kvittens finns kvar');
  assert.equal(andra.lagring.hamtaRum(room.id).status, 'STÄNGD');
  for (const id of ids) assert.deepEqual([andra.lagring.hamtaSession(id).activity, andra.lagring.hamtaSession(id).connection], ['FÖLJER_AVSLUT', 'FRÅNKOPPLAD']);
  /* Kvittenshistoriken finns kvar: samma commandId ger samma kvittens men utförs aldrig igen; nya drag avvisas. */
  const igen = await andra.tjanst.kommando(ids[0], { protocolVersion: 1, commandId: 'd1', type: 'BEKRÄFTA_BYTE', matchId, revision: vy.revision, payload: { cards: [] } });
  assert.deepEqual(igen, drag);
  const nytt = await andra.tjanst.kommando(ids[1], { protocolVersion: 1, commandId: 'd2', type: 'BEKRÄFTA_BYTE', matchId, revision: rad.match.revision, payload: { cards: [] } });
  assert.deepEqual([nytt.status, nytt.message], ['AVVISAD', 'Matchen avbröts. Gå till lobbyn.']);
  assert.equal(andra.lagring.hamtaMatch(matchId).match.revision, rad.match.revision);
  /* Vyn visar slutstatus och orsak. */
  const sluten = andra.matcher.matchFor(ids[1]).view;
  assert.deepEqual([sluten.phase, sluten.endReason, sluten.matchStatus, sluten.allowed], ['AVSLUTAD', 'SERVERAVBROTT', 'AVBRUTEN', []]);
  /* Till lobbyn och en ny match fungerar efter uppstädningen. */
  for (const id of ids) assert.equal((await andra.tjanst.kommando(id, { protocolVersion: 1, commandId: `l-${id}`, type: 'LÄMNA', roomId: room.id, payload: {} })).status, 'GODKÄND');
  for (const id of ids) andra.sessioner.anslut(id);
  const nyttRum = andra.rum.skapa(ids[0]);
  andra.rum.bjudIn(ids[0], nyttRum.id, [ids[1]]);
  andra.rum.acceptera(ids[1], andra.rum.vyFor(ids[1]).inbjudningar.inkommande[0].id);
  andra.rum.valjLag(ids[0], nyttRum.id, 'A'); andra.rum.valjLag(ids[1], nyttRum.id, 'B');
  const rv2 = andra.lagring.hamtaRum(nyttRum.id).rosterVersion;
  for (const id of ids) andra.rum.redo(id, nyttRum.id, true, rv2);
  assert.equal((await andra.tjanst.kommando(ids[0], { protocolVersion: 1, commandId: 's2', type: 'STARTA', roomId: nyttRum.id, payload: { rosterVersion: rv2 } })).status, 'GODKÄND');
  const nyMatch = andra.lagring.hamtaRum(nyttRum.id).matchId;
  await andra.stang();
  /* Tredje körningen: den gamla avbrutna matchen rörs inte igen; den nya avbryts. */
  const tredje = startaServer({ port: 0, dataDir, logg: tyst });
  await tredje.klar;
  assert.deepEqual([tredje.omstart.avbrutna, tredje.omstart.matcher], [1, [nyMatch]]);
  assert.equal(tredje.lagring.hamtaHandelser(matchId).filter(e => e.type === 'MATCHSLUT').length, 1, 'ingen dubbel sluthändelse');
  assert.equal(tredje.lagring.hamtaHandelser(matchId).length, handelser.length);
  await tredje.stang();
  rmSync(dir, { recursive: true, force: true });
});

test('Lagringsfel under uppstädningen: servern öppnar inte, och en ny start städar klart utan dubbla sluthändelser (L18)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tornstriden-'));
  const dataDir = join(dir, 'data');
  const forsta = startaServer({ port: 0, dataDir, logg: tyst, lagspel: true });
  await forsta.klar;
  /* Tre pågående matcher: en duell och två lagmatcher. */
  const matcher = [];
  for (const size of [2, 4, 4]) {
    const ids = Array.from({ length: size }, (_, i) => { const { session } = forsta.sessioner.skapa(`s${matcher.length}x${i}`); forsta.sessioner.anslut(session.playerId); return session.playerId; });
    const room = forsta.rum.skapa(ids[0]);
    forsta.rum.bjudIn(ids[0], room.id, ids.slice(1));
    for (const id of ids.slice(1)) forsta.rum.acceptera(id, forsta.rum.vyFor(id).inbjudningar.inkommande[0].id);
    ids.forEach((id, i) => forsta.rum.valjLag(id, room.id, i % 2 ? 'B' : 'A'));
    const rv = forsta.lagring.hamtaRum(room.id).rosterVersion;
    for (const id of ids) forsta.rum.redo(id, room.id, true, rv);
    forsta.rum.starta(ids[0], room.id, rv);
    matcher.push(forsta.lagring.hamtaRum(room.id).matchId);
  }
  await forsta.stang();
  /* Andra start: lagringen fallerar vid den andra matchens transaktion. */
  let lasningar = 0;
  const trasig = args => {
    const lagring = oppnaLagring(args);
    const vanlig = lagring.transaktion;
    /* Uppstädningen läser varje match i sin transaktion; den andra läsningen fallerar. */
    lagring.transaktion = fn => vanlig(ops => fn(new Proxy(ops, { get: (t, k) => k === 'hamtaMatch' ? id => { if (++lasningar === 2) throw new Error('disken är full'); return t.hamtaMatch(id); } : t[k] })));
    return lagring;
  };
  const trasigServer = startaServer({ port: 0, dataDir, logg: tyst, lagringsfabrik: trasig });
  await assert.rejects(trasigServer.klar, error => /^Uppstädningen efter omstart misslyckades – servern startar inte: disken är full$/.test(error.message) && error.cause?.message === 'disken är full');
  assert.equal(trasigServer.server.listening, false, 'porten stängdes utan att någon begäran hanterats');
  const kontroll = oppnaLagring({ path: join(dataDir, 'tornstriden.sqlite') });
  assert.deepEqual(matcher.map(id => kontroll.hamtaMatch(id).status), ['AVBRUTEN', 'PÅGÅR', 'PÅGÅR'], 'den första sparades, inget mer låtsas vara sparat');
  kontroll.stang();
  /* Tredje start: resten städas, den första rörs inte igen. */
  const tredje = startaServer({ port: 0, dataDir, logg: tyst, lagspel: true });
  await tredje.klar;
  assert.deepEqual([tredje.omstart.avbrutna, tredje.omstart.matcher], [2, matcher.slice(1)]);
  for (const id of matcher) {
    assert.equal(tredje.lagring.hamtaMatch(id).status, 'AVBRUTEN');
    assert.equal(tredje.lagring.hamtaHandelser(id).filter(e => e.type === 'MATCHSLUT').length, 1, `${id}: en sluthändelse`);
  }
  const lag = tredje.lagring.hamtaMatch(matcher[1]).match.engine;
  assert.deepEqual([lag.phase, lag.winnerTeam, lag.endReason], ['AVSLUTAD', null, 'SERVERAVBROTT']);
  assert.ok(lag.players.every(p => p.status === 'LEVANDE'), 'ingen individuell förlust');
  await tredje.stang();
  rmSync(dir, { recursive: true, force: true });
});

/* ---- L03: gästsession och lobby över HTTP ---- */

/* En "webbläsare" med egen kakburk. */
function klient(url) {
  let cookie = null;
  const headers = extra => ({ ...(cookie ? { cookie } : {}), ...extra });
  const call = async (path, { method = 'GET', body, origin = url('') } = {}) => {
    const response = await fetch(url(path), { method, headers: headers({ 'content-type': 'application/json', ...(origin ? { origin } : {}) }), body: body === undefined ? undefined : JSON.stringify(body) });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? null : set.split(';')[0];
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, setCookie: set, text };
  };
  return { call, cookie: () => cookie, setCookie: value => { cookie = value; } };
}
async function strom(url, cookie) {
  const response = await fetch(url('/api/handelser'), { headers: { cookie } });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  const svar = [];
  const pump = async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const event = block.match(/^event: (.+)$/m)?.[1]; const data = block.match(/^data: (.+)$/m)?.[1];
        if (event === 'ping') { svar.push(fetch(url('/api/livstecken'), { method: 'POST', headers: { cookie, origin: url(''), 'content-type': 'application/json' }, body: data }).then(r => r.text())); continue; }   // som klienten: svara på ping (L17)
        if (event) events.push({ event, data: JSON.parse(data) });
      }
    }
  };
  const done = pump();
  const vanta = async (event, n = 1) => { for (let i = 0; i < 200 && events.filter(e => e.event === event).length < n; i++) await new Promise(r => setTimeout(r, 5)); return events.filter(e => e.event === event).at(-1)?.data; };
  return { status: response.status, events, vanta, svarat: () => Promise.all(svar), stang: async () => { await reader.cancel(); await done.catch(() => {}); } };
}
/* Flyttar den styrda klockan i steg om PING_MS och låter strömmarna svara på varje ping, som riktiga klienter. */
async function flytta(klocka, ms, flikar) {
  for (let kvar = ms; kvar > 0; kvar -= PING_MS) {
    klocka.advance(Math.min(PING_MS, kvar));
    await new Promise(r => setTimeout(r, 15));
    await Promise.all(flikar.map(f => f.svarat()));
  }
}

test('Separata gäster får olika identitet, omladdning behåller den, och någon annans nick ger ingen åtkomst', () => medServer(async ({ url }) => {
  const anna = klient(url), bo = klient(url), inkraktare = klient(url);
  const a = await anna.call('/api/session', { method: 'POST', body: { nick: 'Anna' } });
  assert.equal(a.status, 201);
  assert.match(a.setCookie, /^tornstriden_session=[0-9a-f]{64}; Path=\/; Max-Age=86400; HttpOnly; SameSite=Lax$/, 'HttpOnly, Lax, ingen Secure utan HTTPS');
  assert.equal(a.body.me.nick, 'Anna');
  assert.ok(!a.text.includes(anna.cookie().split('=')[1]), 'token finns inte i svaret, bara i kakan');
  const b = await bo.call('/api/session', { method: 'POST', body: { nick: 'Bo' } });
  assert.notEqual(b.body.me.playerId, a.body.me.playerId);
  assert.deepEqual((await bo.call('/api/lobby')).body.players.map(p => p.nick), ['Anna', 'Bo']);
  const omladdad = await anna.call('/api/session', { method: 'POST', body: { nick: 'Något annat' } });
  assert.equal(omladdad.status, 200);
  assert.equal(omladdad.body.me.playerId, a.body.me.playerId, 'befintlig kaka återupptar sessionen i stället för att ta ett nytt nick');
  assert.equal((await anna.call('/api/session')).body.me.nick, 'Anna');
  const krock = await inkraktare.call('/api/session', { method: 'POST', body: { nick: 'anna' } });
  assert.equal(krock.status, 409);
  assert.equal(inkraktare.cookie(), null);
  assert.equal((await inkraktare.call('/api/lobby')).status, 401);
  inkraktare.setCookie('tornstriden_session=' + 'f'.repeat(64));
  assert.equal((await inkraktare.call('/api/lobby')).status, 401, 'påhittad token');
  assert.equal((await inkraktare.call('/api/session', { method: 'POST', body: { nick: 'x' } })).status, 400, 'för kort nick');
  assert.equal((await inkraktare.call('/api/session', { method: 'POST', body: { nick: 'Cesar' }, origin: null })).status, 403, 'skapa session kräver också rätt ursprung');
}));

test('HTML-liknande nick lagras som text och lobbyn/loggen saknar hemligheter', () => medServer(async ({ url, app }) => {
  const anna = klient(url);
  const svar = await anna.call('/api/session', { method: 'POST', body: { nick: '<b>Anna</b>' } });
  assert.equal(svar.status, 201);
  assert.equal(svar.body.me.nick, '<b>Anna</b>');
  const lobby = (await anna.call('/api/lobby')).body;
  assert.deepEqual(Object.keys(lobby.players[0]), ['playerId', 'nick', 'activity', 'connection']);
  const raw = app.lagring.hamtaSession(lobby.me.playerId);
  assert.ok(!JSON.stringify(lobby).includes(raw.tokenHash));
}));

test('Händelseströmmen kräver session, skickar lobbylistan till alla och hanterar extra flik och frånkoppling', () => medServer(async ({ url }) => {
  const anna = klient(url), bo = klient(url);
  await anna.call('/api/session', { method: 'POST', body: { nick: 'Anna' } });
  await bo.call('/api/session', { method: 'POST', body: { nick: 'Bo' } });
  const flikA = await strom(url, anna.cookie());
  const forsta = await flikA.vanta('lobby');
  assert.equal(forsta.me.connection, 'ANSLUTEN');
  assert.deepEqual(forsta.players.map(p => `${p.nick}:${p.connection}`), ['Anna:ANSLUTEN', 'Bo:FRÅNKOPPLAD']);
  const flikB = await strom(url, bo.cookie());
  await flikB.vanta('lobby');
  const uppdaterad = await flikA.vanta('lobby', 2);
  assert.deepEqual(uppdaterad.players.map(p => `${p.nick}:${p.connection}`), ['Anna:ANSLUTEN', 'Bo:ANSLUTEN'], 'Anna ser att Bo anslöt');
  const flikA2 = await strom(url, anna.cookie());
  await flikA2.vanta('lobby');
  assert.equal((await flikA.vanta('ersatt')).message, 'Spelet är öppet i en annan flik.');
  await new Promise(r => setTimeout(r, 30));
  assert.equal((await anna.call('/api/lobby')).body.me.connection, 'ANSLUTEN', 'den gamla flikens stängning fäller inte den nya anslutningen');
  const nickbyte = await anna.call('/api/kommando', { method: 'POST', body: { protocolVersion: 1, commandId: 'c1', type: 'SÄTT_NICK', payload: { nick: 'Annika' } } });
  assert.equal(nickbyte.body.status, 'GODKÄND');
  assert.equal((await flikB.vanta('lobby', 3)).players.map(p => p.nick).join(','), 'Annika,Bo', 'Bo ser nickbytet');
  assert.equal((await anna.call('/api/status?commandId=c1')).body.status, 'GODKÄND');
  assert.equal((await anna.call('/api/status?commandId=c9')).body.status, 'OKÄND');
  await flikB.stang();
  const efter = await flikA2.vanta('lobby', 3);
  assert.deepEqual(efter.players.map(p => `${p.nick}:${p.connection}`), ['Annika:ANSLUTEN', 'Bo:FRÅNKOPPLAD'], 'stängd ström ger FRÅNKOPPLAD');
  const lamna = await bo.call('/api/session', { method: 'DELETE' });
  assert.equal(lamna.status, 200);
  assert.match(lamna.setCookie, /Max-Age=0/);
  assert.deepEqual((await flikA2.vanta('lobby', 4)).players.map(p => p.nick), ['Annika']);
  assert.equal((await bo.call('/api/lobby')).status, 401);
  await flikA.stang(); await flikA2.stang();
}));

test('Bakom HTTPS-proxyn godkänns det konfigurerade ursprunget och kakan får Secure', () => medServer(async ({ url }) => {
  const post = headers => fetch(url('/api/session'), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ nick: 'Anna' }) });
  assert.equal((await post({ origin: 'https://annan.example', 'x-forwarded-proto': 'https' })).status, 403);
  const r = await post({ origin: 'https://tornstriden.landychev.se', 'x-forwarded-proto': 'https' });
  assert.equal(r.status, 201);
  assert.match(r.headers.get('set-cookie'), /; HttpOnly; SameSite=Lax; Secure$/);
}, { origins: ['https://tornstriden.landychev.se'] }));

test('Rum över HTTP: värden bjuder in, mottagaren ser inbjudan i strömmen, accepterar, och båda får rummet', () => medServer(async ({ url, klocka }) => {
  const anna = klient(url), bo = klient(url), cy = klient(url);
  const a = await anna.call('/api/session', { method: 'POST', body: { nick: 'Anna' } });
  const b = await bo.call('/api/session', { method: 'POST', body: { nick: 'Bo' } });
  await cy.call('/api/session', { method: 'POST', body: { nick: 'Cy' } });
  const flikA = await strom(url, anna.cookie()), flikB = await strom(url, bo.cookie()), flikC = await strom(url, cy.cookie());
  await flikC.vanta('lobby');
  const kommando = (k, commandId, type, extra = {}) => k.call('/api/kommando', { method: 'POST', body: { protocolVersion: 1, commandId, type, payload: {}, ...extra } });
  const skapat = await kommando(anna, 'k1', 'SKAPA_RUM');
  assert.equal(skapat.body.status, 'GODKÄND');
  const roomId = (await anna.call('/api/lobby')).body.rum.id;
  assert.equal((await bo.call('/api/lobby')).body.rum, null);
  assert.equal((await bo.call('/api/lobby')).body.players.find(p => p.nick === 'Anna').activity, 'I_RUM');
  const inbjudan = await kommando(anna, 'k2', 'BJUD_IN', { roomId, payload: { playerIds: [b.body.me.playerId, a.body.me.playerId] } });
  assert.equal(inbjudan.body.status, 'GODKÄND');
  assert.match(inbjudan.body.message, /skickad till Bo\. Anna: Det är du själv\./);
  const hosBo = (await flikB.vanta('lobby', 4)).inbjudningar.inkommande;   // 1 egen, 2 Cy ansluter, 3 Anna skapar rum, 4 inbjudan
  assert.equal(hosBo.length, 1);
  assert.equal(hosBo[0].from.nick, 'Anna');
  assert.equal(hosBo[0].expiresAt, klocka.now() + 120_000);
  assert.equal((await flikC.vanta('lobby', 3)).inbjudningar.inkommande.length, 0, 'Cy har ingen inbjudan');
  const accept = await kommando(bo, 'k3', 'ACCEPTERA', { payload: { invitationId: hosBo[0].id } });
  assert.equal(accept.body.status, 'GODKÄND');
  const rumA = (await flikA.vanta('lobby', 6)).rum;   // 1 egen, 2–3 Bo/Cy ansluter, 4 skapa, 5 inbjudan, 6 acceptans
  assert.deepEqual(rumA.players.map(p => `${p.nick}:${p.connection}`), ['Anna:ANSLUTEN', 'Bo:ANSLUTEN']);
  assert.equal(rumA.hostPlayerId, a.body.me.playerId);
  assert.equal((await bo.call('/api/lobby')).body.rum.id, roomId);
  assert.equal((await bo.call('/api/lobby')).body.inbjudningar.inkommande.length, 0);
  assert.ok(!JSON.stringify(rumA).includes('tokenHash'));
  await flikB.stang();
  const efterBo = (await flikA.vanta('lobby', 7)).rum;
  assert.deepEqual(efterBo.players.map(p => `${p.nick}:${p.connection}`), ['Anna:ANSLUTEN', 'Bo:FRÅNKOPPLAD'], 'frånkoppling syns i rummet');
  const lamna = await bo.call('/api/session', { method: 'DELETE' });
  assert.equal(lamna.status, 200);
  const efterLamna = (await flikA.vanta('lobby', 8)).rum;
  assert.deepEqual(efterLamna.players.map(p => p.nick), ['Anna'], 'att lämna lobbyn lämnar också rummet');
  await flikA.stang(); await flikC.stang();
}));

test('Lagval, Redo och start över HTTP: vyn visar startstatus och bara värden kan starta', () => medServer(async ({ url }) => {
  const anna = klient(url), bo = klient(url);
  const a = await anna.call('/api/session', { method: 'POST', body: { nick: 'Anna' } });
  const b = await bo.call('/api/session', { method: 'POST', body: { nick: 'Bo' } });
  const flikA = await strom(url, anna.cookie()), flikB = await strom(url, bo.cookie());
  await flikB.vanta('lobby');
  const kommando = (k, commandId, type, extra = {}) => k.call('/api/kommando', { method: 'POST', body: { protocolVersion: 1, commandId, type, payload: {}, ...extra } });
  await kommando(anna, 'k1', 'SKAPA_RUM');
  const roomId = (await anna.call('/api/lobby')).body.rum.id;
  await kommando(anna, 'k2', 'BJUD_IN', { roomId, payload: { playerIds: [b.body.me.playerId] } });
  const inv = (await bo.call('/api/lobby')).body.inbjudningar.inkommande[0].id;
  await kommando(bo, 'k3', 'ACCEPTERA', { payload: { invitationId: inv } });
  let vy = (await anna.call('/api/lobby')).body;
  assert.deepEqual(vy.start.skal, ['Anna, Bo har inte valt lag.', 'Väntar på Anna, Bo.']);
  assert.equal((await kommando(anna, 'k4', 'VÄLJ_LAG', { roomId, payload: { teamId: 'A' } })).body.status, 'GODKÄND');
  assert.equal((await kommando(bo, 'k5', 'VÄLJ_LAG', { roomId, payload: { teamId: 'A' } })).body.status, 'GODKÄND');
  vy = (await bo.call('/api/lobby')).body;
  assert.deepEqual(vy.start.skal, ['Lagen är ojämna: 2 mot 0. Någon behöver byta lag.', 'Väntar på Anna, Bo.']);
  await kommando(bo, 'k6', 'VÄLJ_LAG', { roomId, payload: { teamId: 'B' } });
  const v = (await bo.call('/api/lobby')).body.rum.rosterVersion;
  const gammal = await kommando(anna, 'k7', 'REDO', { roomId, payload: { ready: true, rosterVersion: v - 1 } });
  assert.equal(gammal.body.status, 'AVVISAD');
  assert.match(gammal.body.message, /Uppställningen har ändrats/);
  await kommando(anna, 'k8', 'REDO', { roomId, payload: { ready: true, rosterVersion: v } });
  await kommando(bo, 'k9', 'REDO', { roomId, payload: { ready: true, rosterVersion: v } });
  await flikB.vanta('lobby', 9);   // 1 egen, 2 skapa, 3 inbjudan, 4 acceptans, 5–7 lagval, 8–9 Redo
  vy = (await bo.call('/api/lobby')).body;
  assert.deepEqual(vy.rum.players.map(p => `${p.nick}:${p.teamId}:${p.ready}`), ['Anna:A:true', 'Bo:B:true']);
  assert.deepEqual(vy.start, { kanStarta: true, skal: [], antal: { A: 1, B: 1 }, format: 'duell', tillganglig: true, tillgangligaFormat: [2, 4, 6, 8] });
  const start = await kommando(bo, 'k10', 'STARTA', { roomId, payload: { rosterVersion: v } });
  assert.equal(start.body.status, 'AVVISAD');
  assert.match(start.body.message, /Bara värden/);
  assert.equal((await anna.call('/api/lobby')).body.rum.status, 'FÖRBEREDELSE');
  await flikA.stang(); await flikB.stang();
}));

test('Onlineduell över HTTP: start ger privata matchvyer i strömmen, drag ger händelser, fel tur avvisas, och en tidsgräns når båda utan kommando', () => medServer(async ({ url, app, klocka }) => {
  const anna = klient(url), bo = klient(url);
  const a = await anna.call('/api/session', { method: 'POST', body: { nick: 'Anna' } });
  const b = await bo.call('/api/session', { method: 'POST', body: { nick: 'Bo' } });
  const flikA = await strom(url, anna.cookie()), flikB = await strom(url, bo.cookie());
  await flikB.vanta('lobby');
  let n = 0;
  const kommando = (k, type, extra = {}) => k.call('/api/kommando', { method: 'POST', body: { protocolVersion: 1, commandId: `h${++n}`, type, payload: {}, ...extra } });
  await kommando(anna, 'SKAPA_RUM');
  const roomId = (await anna.call('/api/lobby')).body.rum.id;
  await kommando(anna, 'BJUD_IN', { roomId, payload: { playerIds: [b.body.me.playerId] } });
  await kommando(bo, 'ACCEPTERA', { payload: { invitationId: (await bo.call('/api/lobby')).body.inbjudningar.inkommande[0].id } });
  await kommando(anna, 'VÄLJ_LAG', { roomId, payload: { teamId: 'A' } });
  await kommando(bo, 'VÄLJ_LAG', { roomId, payload: { teamId: 'B' } });
  const v = (await bo.call('/api/lobby')).body.rum.rosterVersion;
  await kommando(anna, 'REDO', { roomId, payload: { ready: true, rosterVersion: v } });
  await kommando(bo, 'REDO', { roomId, payload: { ready: true, rosterVersion: v } });
  assert.equal((await anna.call('/api/match')).status, 404, 'ingen match före start');
  const start = await kommando(anna, 'STARTA', { roomId, payload: { rosterVersion: v } });
  assert.equal(start.body.status, 'GODKÄND', start.body.message);
  const ma = await flikA.vanta('match'), mb = await flikB.vanta('match');
  assert.equal(ma.view.mySeat, 'A'); assert.equal(mb.view.mySeat, 'B');
  assert.equal(ma.view.me.hand.length, 10);
  assert.ok(mb.view.me.hand.every(c => !JSON.stringify(ma).includes(`"${c.instanceId}"`)), 'Bos kort läcker inte till Anna');
  assert.equal(ma.view.players.find(p => p.id === 'B').name, 'Bo');
  assert.equal((await anna.call('/api/match')).body.view.matchId, ma.view.matchId);
  assert.equal((await anna.call('/api/lobby')).body.me.activity, 'SPELAR');
  /* Fel tur */
  const felTur = await kommando(bo, 'BEKRÄFTA_BYTE', { matchId: mb.view.matchId, revision: mb.view.revision, payload: { cards: [] } });
  assert.equal(felTur.body.status, 'AVVISAD');
  assert.match(felTur.body.message, /inte din tur/);
  /* Annas byte: båda får ny vy med händelser */
  const byte = await kommando(anna, 'BEKRÄFTA_BYTE', { matchId: ma.view.matchId, revision: ma.view.revision, payload: { cards: [ma.view.me.hand[0].instanceId] } });
  assert.equal(byte.body.status, 'GODKÄND');
  assert.equal(byte.body.revision, 1);
  const ma2 = await flikA.vanta('match', 2), mb2 = await flikB.vanta('match', 2);
  assert.equal(ma2.view.revision, 1); assert.equal(mb2.view.revision, 1);
  assert.deepEqual(ma2.events.map(e => e.type).slice(0, 1), ['BYTE']);
  assert.equal(mb2.view.activePlayer, 'B');
  assert.ok(mb2.view.allowed.some(x => x.type === 'BEKRÄFTA_BYTE'));
  assert.ok(!JSON.stringify(mb2.events).includes('"hand"'), 'händelser bär inga händer');
  /* Omladdning: /api/match ger samma vy och händelserna efter ett givet ID */
  const igen = (await anna.call(`/api/match?efterEventId=0`)).body;
  assert.equal(igen.view.revision, 1);
  assert.equal(igen.events.length, ma2.view.lastEventId);
  assert.equal((await anna.call('/api/status?commandId=' + byte.body.commandId + '&scope=match:' + ma.view.matchId)).body.status, 'GODKÄND');
  /* L16: Bo har klockan och Anna ser den; när tiden går ut får båda strömmarna slutläget utan något kommando. */
  assert.deepEqual(mb2.view.deadline, { playerId: 'B', at: klocka.now() + 90_000 });
  assert.equal(ma2.view.deadline, null);
  assert.deepEqual(ma2.view.clocks, { B: klocka.now() + 90_000 });
  await flytta(klocka, 90_000, [flikA, flikB]);
  await app.matcher.klockor().klart();
  const slutA = await flikA.vanta('match', 3), slutB = await flikB.vanta('match', 3);
  for (const slut of [slutA, slutB]) assert.deepEqual([slut.view.phase, slut.view.winner, slut.view.endReason, slut.status, slut.view.deadline], ['AVSLUTAD', 'A', 'TIDSGRÄNS', 'AVSLUTAD', null]);
  assert.ok(slutB.events.some(e => e.type === 'MATCHSLUT'));
  await flikA.stang(); await flikB.stang();
}));

/* ---- L17: avbrott och återkomst över HTTP ---- */
test('Avbrott över HTTP: en stängd ström blir ett avbrott som motståndaren ser, en ny flik tar över utan avbrott, och återkomsten visar aktuellt läge', () => medServer(async ({ url, app, klocka }) => {
  const anna = klient(url), bo = klient(url);
  await anna.call('/api/session', { method: 'POST', body: { nick: 'Anna' } });
  const b = await bo.call('/api/session', { method: 'POST', body: { nick: 'Bo' } });
  let flikA = await strom(url, anna.cookie()), flikB = await strom(url, bo.cookie());
  await flikB.vanta('lobby');
  let n = 0;
  const kommando = (k, type, extra = {}) => k.call('/api/kommando', { method: 'POST', body: { protocolVersion: 1, commandId: `a${++n}`, type, payload: {}, ...extra } });
  await kommando(anna, 'SKAPA_RUM');
  const roomId = (await anna.call('/api/lobby')).body.rum.id;
  await kommando(anna, 'BJUD_IN', { roomId, payload: { playerIds: [b.body.me.playerId] } });
  await kommando(bo, 'ACCEPTERA', { payload: { invitationId: (await bo.call('/api/lobby')).body.inbjudningar.inkommande[0].id } });
  await kommando(anna, 'VÄLJ_LAG', { roomId, payload: { teamId: 'A' } });
  await kommando(bo, 'VÄLJ_LAG', { roomId, payload: { teamId: 'B' } });
  const v = (await bo.call('/api/lobby')).body.rum.rosterVersion;
  await kommando(anna, 'REDO', { roomId, payload: { ready: true, rosterVersion: v } });
  await kommando(bo, 'REDO', { roomId, payload: { ready: true, rosterVersion: v } });
  assert.equal((await kommando(anna, 'STARTA', { roomId, payload: { rosterVersion: v } })).body.status, 'GODKÄND');
  const start = await flikA.vanta('match');
  const matchId = start.view.matchId;
  await flikB.vanta('match');
  /* En andra flik för Anna tar över: den gamla strömmen stängs, men det är inget avbrott. */
  const flikA2 = await strom(url, anna.cookie());
  await flikA2.vanta('match');
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(app.lagring.hamtaMatch(matchId).match.avbrott ?? {}, {}, 'ny flik är inget avbrott');
  assert.ok(flikA.events.some(e => e.event === 'ersatt'));
  await flikA.stang();
  flikA = flikA2;
  const vantaPa = async villkor => { for (let i = 0; i < 200 && !villkor(); i++) await new Promise(r => setTimeout(r, 5)); assert.ok(villkor()); };
  const boId = b.body.me.playerId;
  const borta = () => app.lagring.hamtaSession(boId).connection === 'FRÅNKOPPLAD';
  /* Bo laddar om (stänger och öppnar inom nåden): inget avbrott, ingen budget dras. */
  await flikB.stang();
  await vantaPa(borta);   // servern har sett stängningen; nåden löper
  flikB = await strom(url, bo.cookie());
  await flikB.vanta('match');
  await flytta(klocka, OMLADDNING_MS + PING_MS, [flikA, flikB]);
  assert.deepEqual(app.lagring.hamtaMatch(matchId).match.avbrott ?? {}, {}, 'en omladdning är inget avbrott');
  assert.equal(app.lagring.hamtaHandelser(matchId).filter(e => e.type === 'AVBROTT').length, 0);
  /* Bo stänger sin flik: efter nåden får Anna avbrottet med Bos frist, räknad från stängningen, utan att något kommando skickats. */
  const stangd = klocka.now();
  await flikB.stang();
  await vantaPa(borta);
  await flytta(klocka, OMLADDNING_MS, [flikA]);
  await app.matcher.klockor().klart();
  await vantaPa(() => flikA.events.some(e => e.event === 'match' && e.data.view.disconnects?.B));
  const avbrott = flikA.events.filter(e => e.event === 'match' && e.data.view.disconnects?.B).at(-1).data;
  assert.equal(avbrott.view.disconnects.B, stangd + 30_000);
  assert.equal(avbrott.view.players.find(p => p.id === 'B').connection, 'FRÅNKOPPLAD');
  assert.ok(avbrott.events.some(e => e.type === 'AVBROTT' && e.data.playerId === 'B'));
  /* Annas drag går igenom medan Bo är borta (det är hennes tur). */
  assert.equal((await kommando(anna, 'BEKRÄFTA_BYTE', { matchId, revision: avbrott.view.revision, payload: { cards: [] } })).body.status, 'GODKÄND');
  /* Bo kommer tillbaka: strömmen ger direkt aktuell vy (Annas byte syns), och Anna ser återkomsten. */
  flikB = await strom(url, bo.cookie());
  const bosVy = await flikB.vanta('match');
  assert.equal(bosVy.view.activePlayer, 'B', 'återkomsten visar läget efter avbrottet');
  await new Promise(r => setTimeout(r, 30));
  const efter = app.lagring.hamtaMatch(matchId).match;
  assert.deepEqual(efter.avbrott, {});
  assert.equal(efter.avbrottsbudget[b.body.me.playerId] >= 0, true);
  const sista = flikA.events.filter(e => e.event === 'match').at(-1).data;
  assert.deepEqual(sista.view.disconnects, {});
  assert.ok(sista.events.some(e => e.type === 'ÅTERANSLUTEN'));
  await flikA.stang(); await flikB.stang();
}));

test('Avbrott över HTTP: en ström som stängs strax före turtidens slut skyddar den kvarvarande tiden – ingen förlust under nåden (granskning L17)', () => medServer(async ({ url, app, klocka }) => {
  const anna = klient(url), bo = klient(url);
  await anna.call('/api/session', { method: 'POST', body: { nick: 'Anna' } });
  const b = await bo.call('/api/session', { method: 'POST', body: { nick: 'Bo' } });
  const flikar = { A: await strom(url, anna.cookie()), B: await strom(url, bo.cookie()) };
  await flikar.B.vanta('lobby');
  let n = 0;
  const kommando = (k, type, extra = {}) => k.call('/api/kommando', { method: 'POST', body: { protocolVersion: 1, commandId: `n${++n}`, type, payload: {}, ...extra } });
  await kommando(anna, 'SKAPA_RUM');
  const roomId = (await anna.call('/api/lobby')).body.rum.id;
  await kommando(anna, 'BJUD_IN', { roomId, payload: { playerIds: [b.body.me.playerId] } });
  await kommando(bo, 'ACCEPTERA', { payload: { invitationId: (await bo.call('/api/lobby')).body.inbjudningar.inkommande[0].id } });
  await kommando(anna, 'VÄLJ_LAG', { roomId, payload: { teamId: 'A' } });
  await kommando(bo, 'VÄLJ_LAG', { roomId, payload: { teamId: 'B' } });
  const v = (await bo.call('/api/lobby')).body.rum.rosterVersion;
  await kommando(anna, 'REDO', { roomId, payload: { ready: true, rosterVersion: v } });
  await kommando(bo, 'REDO', { roomId, payload: { ready: true, rosterVersion: v } });
  assert.equal((await kommando(anna, 'STARTA', { roomId, payload: { rosterVersion: v } })).body.status, 'GODKÄND');
  const start = await flikar.A.vanta('match');
  await flikar.B.vanta('match');
  const matchId = start.view.matchId;
  const tur = start.view.activePlayer;                       // den som byter först har klockan
  const annan = tur === 'A' ? 'B' : 'A';
  const turId = app.lagring.hamtaMatch(matchId).match.seats[tur];
  const deadline = app.lagring.hamtaMatch(matchId).match.klockor[turId].deadline;
  /* 89 sekunder går med besvarade ping; sedan stängs strömmen för den som har turen. */
  await flytta(klocka, deadline - 1_000 - klocka.now(), [flikar.A, flikar.B]);
  const stangd = klocka.now();
  await flikar[tur].stang();
  for (let i = 0; i < 200 && app.lagring.hamtaSession(turId).connection !== 'FRÅNKOPPLAD'; i++) await new Promise(r => setTimeout(r, 5));
  await app.matcher.klockor().klart();
  const direkt = app.lagring.hamtaMatch(matchId).match;
  assert.deepEqual([direkt.avbrott[turId]?.start, direkt.avbrott[turId]?.deadline], [stangd, stangd + 30_000], 'avbrottet registreras direkt, räknat från stängningen');
  assert.deepEqual([direkt.klockor[turId].deadline, direkt.klockor[turId].kvar], [null, 1_000], 'den sista sekunden är sparad');
  /* Turtiden (90 s) och nåden (92 s) passerar: ingen förlust, samma avbrott. */
  await flytta(klocka, OMLADDNING_MS + PING_MS, [flikar[annan]]);
  await app.matcher.klockor().klart();
  const efter = app.lagring.hamtaMatch(matchId);
  assert.deepEqual([efter.status, efter.match.engine.phase, efter.match.engine.winner], ['PÅGÅR', 'KORTBYTE', null]);
  assert.equal(app.lagring.hamtaHandelser(matchId).filter(e => e.type === 'AVBROTT').length, 1);
  /* Återkomsten återupptar klockan med den sparade sekunden. */
  flikar[tur] = await strom(url, (tur === 'A' ? anna : bo).cookie());
  await flikar[tur].vanta('match');
  await app.matcher.klockor().klart();
  const tillbaka = app.lagring.hamtaMatch(matchId).match;
  assert.deepEqual(tillbaka.avbrott, {});
  assert.equal(tillbaka.klockor[turId].deadline, klocka.now() + 1_000);
  await flikar.A.stang(); await flikar.B.stang();
}));

test('Utskick (L20): ett matchdrag skickar inte lobbyn till alla igen, och bara matchens strömmar får matchvyn; matchslutet når lobbyn', () => medServer(async ({ url }) => {
  const [anna, bo, cy] = [klient(url), klient(url), klient(url)];
  const id = {};
  for (const [k, nick] of [[anna, 'Anna'], [bo, 'Bo'], [cy, 'Cy']]) id[nick] = (await k.call('/api/session', { method: 'POST', body: { nick } })).body.me.playerId;
  const [flikA, flikB, flikC] = [await strom(url, anna.cookie()), await strom(url, bo.cookie()), await strom(url, cy.cookie())];
  await flikC.vanta('lobby');
  let n = 0;
  const kommando = (k, type, extra = {}) => k.call('/api/kommando', { method: 'POST', body: { protocolVersion: 1, commandId: `u${++n}`, type, payload: {}, ...extra } });
  await kommando(anna, 'SKAPA_RUM');
  const roomId = (await anna.call('/api/lobby')).body.rum.id;
  await kommando(anna, 'BJUD_IN', { roomId, payload: { playerIds: [id.Bo] } });
  await kommando(bo, 'ACCEPTERA', { payload: { invitationId: (await bo.call('/api/lobby')).body.inbjudningar.inkommande[0].id } });
  await kommando(anna, 'VÄLJ_LAG', { roomId, payload: { teamId: 'A' } });
  await kommando(bo, 'VÄLJ_LAG', { roomId, payload: { teamId: 'B' } });
  const v = (await bo.call('/api/lobby')).body.rum.rosterVersion;
  for (const k of [anna, bo]) await kommando(k, 'REDO', { roomId, payload: { ready: true, rosterVersion: v } });
  assert.equal((await kommando(anna, 'STARTA', { roomId, payload: { rosterVersion: v } })).body.status, 'GODKÄND');
  await flikA.vanta('match'); await flikB.vanta('match');
  await new Promise(r => setTimeout(r, 30));
  const lobbyFore = flikC.events.filter(e => e.event === 'lobby').length;
  /* Byten och startbekräftelser: matchens två strömmar får vyer; Cy i lobbyn får varken lobby eller match. */
  for (const k of [anna, bo, anna, bo]) { const m = (await k.call('/api/match')).body.view; assert.equal((await kommando(k, 'BEKRÄFTA_BYTE', { matchId: m.matchId, revision: m.revision, payload: { cards: [] } })).body.status, 'GODKÄND'); }
  for (const k of [anna, bo]) { const m = (await k.call('/api/match')).body.view; await kommando(k, 'BEKRÄFTA_START', { matchId: m.matchId, revision: m.revision }); }
  await new Promise(r => setTimeout(r, 30));
  assert.equal(flikC.events.filter(e => e.event === 'lobby').length, lobbyFore, 'oförändrad lobby skickas inte igen');
  assert.equal(flikC.events.filter(e => e.event === 'match').length, 0, 'den som inte spelar får ingen matchvy');
  assert.ok(flikA.events.filter(e => e.event === 'match').length >= 6 && flikB.events.filter(e => e.event === 'match').length >= 6);
  /* Matchslut (Ge upp) ändrar lobbylistan: nu får alla den nya lobbyn. */
  const m = (await anna.call('/api/match')).body.view;
  assert.equal((await kommando(anna, 'GE_UPP', { matchId: m.matchId, revision: m.revision })).body.status, 'GODKÄND');
  await new Promise(r => setTimeout(r, 30));
  const senaste = flikC.events.filter(e => e.event === 'lobby').at(-1).data;
  assert.ok(flikC.events.filter(e => e.event === 'lobby').length > lobbyFore, 'matchslutet syns i lobbyn');
  assert.deepEqual(['Anna', 'Bo'].map(nick => senaste.players.find(p => p.nick === nick).activity), ['FÖLJER_AVSLUT', 'FÖLJER_AVSLUT']);
  for (const f of [flikA, flikB, flikC]) await f.stang();
}));

test('Utskick (L20): kommandotypen avgör utskicket – en inbjudan med ett extra matchId når ändå mottagaren', () => medServer(async ({ url }) => {
  const [anna, bo] = [klient(url), klient(url)];
  const id = {};
  for (const [k, nick] of [[anna, 'Anna'], [bo, 'Bo']]) id[nick] = (await k.call('/api/session', { method: 'POST', body: { nick } })).body.me.playerId;
  const flikB = await strom(url, bo.cookie());
  await flikB.vanta('lobby');
  const kommando = (k, type, extra = {}) => k.call('/api/kommando', { method: 'POST', body: { protocolVersion: 1, commandId: `x${type}`, type, payload: {}, ...extra } });
  await kommando(anna, 'SKAPA_RUM');
  const roomId = (await anna.call('/api/lobby')).body.rum.id;
  await new Promise(r => setTimeout(r, 30));
  const fore = flikB.events.filter(e => e.event === 'lobby').length;
  const svar = await kommando(anna, 'BJUD_IN', { roomId, matchId: 'm-finns-inte', payload: { playerIds: [id.Bo] } });
  assert.equal(svar.body.status, 'GODKÄND');
  const inbjudan = await flikB.vanta('lobby', fore + 1);
  assert.equal(inbjudan?.inbjudningar?.inkommande?.length, 1, 'Bo ser inbjudan direkt');
  /* Kvittensen hör till rummet, inte till det påhittade matchId:t. */
  assert.equal((await anna.call(`/api/status?commandId=xBJUD_IN&scope=${encodeURIComponent(`rum:${roomId}`)}`)).body.status, 'GODKÄND');
  await flikB.stang();
}));

/* ---- L14: lagmatch över HTTP ---- */

/* En testklients val ur sin egen vy (lagmatch): byt inget, välj mål, spela eller avstå. */
function lagval(view, random) {
  const pick = list => list[Math.floor(random() * list.length)];
  const val = view.allowed.filter(a => a.type !== 'GE_UPP');
  if (!val.length) return null;
  const a = pick(val);
  if (a.type === 'BEKRÄFTA_BYTE') return { type: a.type, payload: { cards: a.cards.slice(0, Math.floor(random() * 3)).map(c => c.instanceId) } };
  if (a.type === 'VÄLJ_MÅL') return { type: a.type, payload: { targetPlayerId: pick(a.players) } };
  if (a.type === 'SPELA_ATTACK') return a.normal.length ? { type: a.type, payload: { instanceId: pick(a.normal).instanceId } } : { type: a.type, payload: { instanceId: pick(a.simple).instanceId, usage: 'simple' } };
  if (a.type === 'SPELA_FÖRSVAR') {
    if (!a.cards.length || random() < 0.3) return { type: 'AVSTÅ_FÖRSVAR', payload: {} };
    const c = pick(a.cards);
    return { type: a.type, payload: { instanceId: c.instanceId, ...(c.cardTargets?.length ? { targetInstanceId: pick(c.cardTargets) } : {}), ...(c.playerTargets?.length ? { targetPlayerId: pick(c.playerTargets) } : {}) } };
  }
  return { type: a.type, payload: {} };
}

test('Lagmatch över HTTP: fyra separata klienter med egna kakor och strömmar spelar en hel match utan att se varandras kort', () => medServer(async ({ url, app }) => {
  const namn = ['Anna', 'Bo', 'Cy', 'Di'];
  const klienter = namn.map(() => klient(url));
  const ids = [];
  for (const [i, k] of klienter.entries()) ids.push((await k.call('/api/session', { method: 'POST', body: { nick: namn[i] } })).body.me.playerId);
  const flikar = [];
  for (const k of klienter) flikar.push(await strom(url, k.cookie()));
  let n = 0;
  const kommando = (k, type, extra = {}) => k.call('/api/kommando', { method: 'POST', body: { protocolVersion: 1, commandId: `l${++n}`, type, payload: {}, ...extra } });
  const [anna, ...ovriga] = klienter;
  await kommando(anna, 'SKAPA_RUM');
  const roomId = (await anna.call('/api/lobby')).body.rum.id;
  await kommando(anna, 'BJUD_IN', { roomId, payload: { playerIds: ids.slice(1) } });
  for (const k of ovriga) await kommando(k, 'ACCEPTERA', { payload: { invitationId: (await k.call('/api/lobby')).body.inbjudningar.inkommande[0].id } });
  for (const [i, k] of klienter.entries()) await kommando(k, 'VÄLJ_LAG', { roomId, payload: { teamId: i % 2 ? 'B' : 'A' } });
  const v = (await anna.call('/api/lobby')).body.rum.rosterVersion;
  for (const k of klienter) await kommando(k, 'REDO', { roomId, payload: { ready: true, rosterVersion: v } });
  assert.deepEqual((await anna.call('/api/lobby')).body.start.tillgangligaFormat, [2, 4, 6, 8]);
  const start = await kommando(anna, 'STARTA', { roomId, payload: { rosterVersion: v } });
  assert.equal(start.body.status, 'GODKÄND', start.body.message);
  const forsta = await Promise.all(flikar.map(f => f.vanta('match')));
  forsta.forEach((m, i) => assert.deepEqual([m.view.viewer, m.view.format, m.view.me.hand.length, m.view.phase], [ids[i], 'lag', 10, 'KORTBYTE']));
  const matchId = forsta[0].view.matchId;
  /* Varje klient hämtar sin vy över HTTP och väljer bara ur den; alla som kan välja skickar samtidigt. */
  const random = styrdSlump(21);
  let steg = 0, kommandon = 0;
  for (;;) {
    assert.ok(++steg < 2000, 'matchen tog aldrig slut');
    const svar = await Promise.all(klienter.map(k => k.call('/api/match')));
    const engine = app.lagring.hamtaMatch(matchId).match.engine;
    svar.forEach((s, i) => {
      validatePrivateView(s.body.view);
      assertNoSecrets(s.body, ids[i]);
      const { lastResult, ...rest } = s.body.view;
      const text = JSON.stringify(rest);
      for (const p of engine.players) if (p.id !== ids[i]) for (const inst of p.hand) assert.ok(!text.includes(`"${inst}"`), `${p.id}s kort syns för ${namn[i]}`);
    });
    const vyer = svar.map(s => s.body.view);
    if (vyer[0].phase === 'AVSLUTAD') break;
    const drag = vyer.map((view, i) => ({ i, view, val: lagval(view, random) })).filter(d => d.val);
    assert.ok(drag.length, `ingen kan välja i fas ${vyer[0].phase}`);
    const kvitton = await Promise.all(drag.map(d => kommando(klienter[d.i], d.val.type, { matchId, revision: d.view.revision, payload: d.val.payload })));
    kvitton.forEach((r, j) => assert.equal(r.body.status, 'GODKÄND', `${drag[j].val.type} ${namn[drag[j].i]}: ${r.body.message}`));
    kommandon += kvitton.length;
  }
  assert.ok(kommandon > 50, `${kommandon} kommandon`);
  await new Promise(r => setTimeout(r, 50));
  /* Strömmarna: bara egen vy, inga händer i händelserna, slutläget kom fram till alla */
  flikar.forEach((f, i) => {
    const matcher = f.events.filter(e => e.event === 'match').map(e => e.data);
    assert.ok(matcher.length > 10);
    for (const m of matcher) {
      assert.equal(m.view.viewer, ids[i]);
      assert.equal(m.view.matchId, matchId);
      assertNoSecrets(m.view, ids[i]);
      assert.ok(m.events.every(e => e.matchId === matchId && e.recipient === null && !JSON.stringify(e.data).includes('"hand"')));
    }
    assert.deepEqual([matcher.at(-1).view.phase, matcher.at(-1).status], ['AVSLUTAD', 'AVSLUTAD']);
  });
  /* Tillbaka till lobbyn */
  for (const k of klienter) assert.equal((await kommando(k, 'LÄMNA', { roomId })).body.status, 'GODKÄND');
  assert.ok((await anna.call('/api/lobby')).body.players.every(p => p.activity === 'LEDIG'));
  for (const f of flikar) await f.stang();
}, { lagspel: true, slump: styrdSlump(9) }));
