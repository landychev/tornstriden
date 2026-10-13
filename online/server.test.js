import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startaServer, PULS_MS } from './server.js';
import { oppnaLagring } from './lagring.js';
import { isBlocked, ROOT } from '../server.js';
import { PROTOCOL_VERSION, MATCH_COMMAND } from '../kontrakt.js';
import { styrdKlocka } from '../teststod.js';

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
  for (const path of ['/online/server.js', '/online/lagring.js', '/online/tjanst.test.js', '/teststod.js', '/kontrakt.test.js', '/package.json', '/deploy.sh', '/scripts/skapa-ljud.py', '/.git/HEAD', '/online/../online/lagring.js']) {
    assert.equal((await fetch(url(path))).status, 404, path);
  }
  for (const path of ['/match.html', '/kontrakt.js', '/match.js']) assert.equal((await fetch(url(path))).status, 200, path);
  assert.equal((await fetch(url('/api/okand'))).status, 404);
}));

test('Den statiska utvecklingsservern spärrar samma vägar', () => {
  for (const path of ['/online', '/online/lagring.js', '/node_modules/x.js', '/.git/config', '/match.test.js', '/teststod.js']) assert.ok(isBlocked(path), path);
  for (const path of ['/match.html', '/kontrakt.js', '/assets/kort/drakeld.jpg', '/online-hjalp.html']) assert.ok(!isBlocked(path), path);
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

test('Händelseströmmen öppnas med hälsa, slår puls via den injicerade klockan och stängs med servern', () => medServer(async ({ app, url, klocka }) => {
  assert.equal((await fetch(url('/api/handelser'))).status, 401, 'strömmen kräver session');
  const cookie = (await fetch(url('/api/session'), { method: 'POST', headers: { 'content-type': 'application/json', origin: url('') }, body: JSON.stringify({ nick: 'Anna' }) })).headers.get('set-cookie').split(';')[0];
  const response = await fetch(url('/api/handelser'), { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const read = async () => decoder.decode((await reader.read()).value);
  const first = await read();
  assert.match(first, /^retry: 3000\nevent: halsa\ndata: \{.*"protocolVersion":1/);
  assert.match(first, /event: lobby\ndata: \{"me":\{"playerId":"p-[0-9a-f]+","nick":"Anna","activity":"LEDIG","connection":"ANSLUTEN"\}/);
  assert.equal(app.strommar.size, 1);
  klocka.advance(PULS_MS);
  assert.match(await read(), /^: puls/);
  klocka.advance(PULS_MS);
  assert.match(await read(), /^: puls/);
  await reader.cancel();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(app.strommar.size, 0, 'stängd anslutning städas bort');
  assert.equal(klocka.pending(), 1, 'ingen pulstimer kvar – bara den periodiska städningen');
}));

test('Databasen hamnar utanför webbroten och gamla pågående matcher stänger matchtrafiken vid start', async () => {
  assert.throws(() => startaServer({ port: 0, dataDir: join(ROOT, 'assets'), logg: tyst }), /webbroten/);
  const dir = mkdtempSync(join(tmpdir(), 'tornstriden-'));
  const dataDir = join(dir, 'data');
  const forsta = startaServer({ port: 0, dataDir, logg: tyst });
  await forsta.klar;
  assert.equal(forsta.dbPath, join(dataDir, 'tornstriden.sqlite'));
  forsta.lagring.sparaMatch({ id: 'm1', revision: 2, rulesVersion: 'duell-v1', deckVersion: 'duell-50-v1', instances: {} });
  await forsta.stang();
  const andra = startaServer({ port: 0, dataDir, logg: tyst });
  await andra.klar;
  const halsa = await (await fetch(`http://127.0.0.1:${andra.port()}/api/halsa`)).json();
  assert.equal(halsa.matchtrafik.oppen, false);
  assert.match(halsa.matchtrafik.orsak, /startades om med 1 pågående/);
  await andra.stang();
  const kontroll = oppnaLagring({ path: join(dataDir, 'tornstriden.sqlite') });
  assert.equal(kontroll.hamtaMatch('m1').match.revision, 2, 'data överlevde två serverstarter');
  kontroll.stang();
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
  const pump = async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value);
      let index;
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const event = block.match(/^event: (.+)$/m)?.[1]; const data = block.match(/^data: (.+)$/m)?.[1];
        if (event) events.push({ event, data: JSON.parse(data) });
      }
    }
  };
  const done = pump();
  const vanta = async (event, n = 1) => { for (let i = 0; i < 200 && events.filter(e => e.event === event).length < n; i++) await new Promise(r => setTimeout(r, 5)); return events.filter(e => e.event === event).at(-1)?.data; };
  return { status: response.status, events, vanta, stang: async () => { await reader.cancel(); await done.catch(() => {}); } };
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

test('Lagval, Redo och start över HTTP: vyn visar startstatus och ett ofärdigt format spärras', () => medServer(async ({ url }) => {
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
  assert.deepEqual(vy.start, { kanStarta: true, skal: [], antal: { A: 1, B: 1 }, format: 'duell', tillganglig: true, tillgangligaFormat: [2] });
  const start = await kommando(bo, 'k10', 'STARTA', { roomId, payload: { rosterVersion: v } });
  assert.equal(start.body.status, 'AVVISAD');
  assert.match(start.body.message, /Bara värden/);
  assert.equal((await anna.call('/api/lobby')).body.rum.status, 'FÖRBEREDELSE');
  await flikA.stang(); await flikB.stang();
}));

test('Onlineduell över HTTP: start ger privata matchvyer i strömmen, drag ger händelser, fel tur avvisas', () => medServer(async ({ url }) => {
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
  await flikA.stang(); await flikB.stang();
}));
