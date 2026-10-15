/* Serveromstart med riktig process (arbetsordning L18, beslut 27B): servern dödas med SIGKILL mitt i en match,
   under sparande och under uppstädningen efter omstart. Varje gång ska nästa start ge ett säkert slutläge:
   gamla matcher AVBRUTNA utan vinnare (SERVERAVBROTT) med exakt en sluthändelse, sparade kvittenser kvar,
   inga nya drag i gamla matcher och nya matcher möjliga. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startaServer } from './server.js';
import { styrdKlocka } from '../teststod.js';
import { auditTeam } from '../lagkortlek.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tyst = { info() {}, warn() {}, error() {} };
const ledigPort = () => new Promise(resolve => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

/* Startar `node online/server.js` mot datakatalogen och väntar tills den lyssnar (eller avslutas). */
async function startaProcess(dataDir) {
  const port = await ledigPort();
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'online/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TORNSTRIDEN_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let ut = '';
  proc.stdout.on('data', d => { ut += d; });
  proc.stderr.on('data', d => { ut += d; });
  const slut = new Promise(resolve => proc.on('exit', code => resolve(code)));
  const redo = await Promise.race([
    (async () => { while (!ut.includes('Tornstriden online:')) await new Promise(r => setTimeout(r, 10)); return true; })(),
    slut.then(() => false)
  ]);
  return { proc, port, url: path => `http://127.0.0.1:${port}${path}`, redo, utdata: () => ut, doda: async () => { proc.kill('SIGKILL'); await slut; }, stoppa: async () => { proc.kill('SIGTERM'); await slut; } };
}

/* En "webbläsare" med egen kaka. `strom(url)` öppnar händelseströmmen (en ansluten spelare) och svarar på ping. */
const oppnaStrommar = new Set();
function klient(url) {
  let cookie = null;
  const anrop = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(anrop.url(path), { method, headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json', origin: anrop.url('') }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  anrop.strom = async serverUrl => {
    const ctrl = new AbortController();
    const response = await fetch(serverUrl('/api/handelser'), { headers: { cookie }, signal: ctrl.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let i;
          while ((i = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, i); buffer = buffer.slice(i + 2);
            if (/^event: ping$/m.test(block)) fetch(serverUrl('/api/livstecken'), { method: 'POST', headers: { cookie, origin: serverUrl(''), 'content-type': 'application/json' }, body: block.match(/^data: (.+)$/m)?.[1] }).catch(() => {});
          }
        }
      } catch { /* servern dog eller strömmen stängdes */ }
    })();
    const stang = () => ctrl.abort();
    oppnaStrommar.add(stang);
    return stang;
  };
  anrop.url = url;
  return anrop;
}
const stangStrommar = () => { for (const stang of oppnaStrommar) stang(); oppnaStrommar.clear(); };
let n = 0;
const kommando = (k, type, extra = {}) => k('/api/kommando', { method: 'POST', body: { protocolVersion: 1, commandId: `k${++n}`, type, payload: {}, ...extra } });

/* Rum och start över HTTP: lagen växelvis A/B. Returnerar matchId. */
async function startaMatch(klienter, ids) {
  const [vard, ...ovriga] = klienter;
  await kommando(vard, 'SKAPA_RUM');
  const roomId = (await vard('/api/lobby')).body.rum.id;
  await kommando(vard, 'BJUD_IN', { roomId, payload: { playerIds: ids.slice(1) } });
  for (const k of ovriga) await kommando(k, 'ACCEPTERA', { payload: { invitationId: (await k('/api/lobby')).body.inbjudningar.inkommande[0].id } });
  for (const [i, k] of klienter.entries()) await kommando(k, 'VÄLJ_LAG', { roomId, payload: { teamId: i % 2 ? 'B' : 'A' } });
  const v = (await vard('/api/lobby')).body.rum.rosterVersion;
  for (const k of klienter) await kommando(k, 'REDO', { roomId, payload: { ready: true, rosterVersion: v } });
  const start = await kommando(vard, 'STARTA', { roomId, payload: { rosterVersion: v } });
  assert.equal(start.body.status, 'GODKÄND', start.body.message);
  return { roomId, matchId: (await vard('/api/match')).body.view.matchId };
}
async function gaster(srv, namn) {
  const klienter = [], ids = [];
  for (const nick of namn) { const k = klient(srv.url); ids.push((await k('/api/session', { method: 'POST', body: { nick } })).body.me.playerId); await k.strom(srv.url); klienter.push(k); }
  await new Promise(r => setTimeout(r, 50));   // strömmarna har anslutit
  return { klienter, ids };
}
/* Ny serverprocess på en ny port: klienterna följer med (samma kakor, nya strömmar). */
async function flytta(klienter, srv) {
  stangStrommar();
  for (const k of klienter) { k.url = srv.url; await k.strom(srv.url); }
  await new Promise(r => setTimeout(r, 50));
}
/* Läser databasen direkt (utan servern) för kontroller. */
function lasDb(dataDir) {
  const db = new DatabaseSync(join(dataDir, 'tornstriden.sqlite'));
  const res = {
    status: id => db.prepare('SELECT status FROM matcher WHERE id = ?').get(id)?.status,
    slut: id => db.prepare("SELECT COUNT(*) AS n FROM handelser WHERE match_id = ? AND typ = 'MATCHSLUT'").get(id).n,
    handelser: id => db.prepare('SELECT event_id FROM handelser WHERE match_id = ? ORDER BY event_id').all(id).map(r => r.event_id),
    state: id => JSON.parse(db.prepare('SELECT state FROM matcher WHERE id = ?').get(id).state),
    raknaAvbrutna: () => db.prepare("SELECT COUNT(*) AS n FROM matcher WHERE status = 'AVBRUTEN'").get().n,
    raw: db,
    stang: () => db.close()
  };
  return res;
}

test('SIGKILL mitt i en duell: nästa start visar avbrottet, behåller kvittenser, avvisar nya drag och tillåter en ny match', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tornstriden-omstart-'));
  const dataDir = join(dir, 'data');
  try {
    let srv = await startaProcess(dataDir);
    assert.ok(srv.redo, srv.utdata());
    const { klienter: [anna, bo], ids } = await gaster(srv, ['Anna', 'Bo']);
    const { roomId, matchId } = await startaMatch([anna, bo], ids);
    const vy = (await anna('/api/match')).body.view;
    const drag = { protocolVersion: 1, commandId: 'byte-1', type: 'BEKRÄFTA_BYTE', matchId, revision: vy.revision, payload: { cards: [] } };
    const kvitto = (await anna('/api/kommando', { method: 'POST', body: drag })).body;
    assert.equal(kvitto.status, 'GODKÄND');
    await srv.doda();

    srv = await startaProcess(dataDir);
    assert.ok(srv.redo, srv.utdata());
    await flytta([anna, bo], srv);
    for (const k of [anna, bo]) {
      const m = (await k('/api/match')).body;
      assert.deepEqual([m.status, m.view.phase, m.view.endReason, m.view.winner, m.view.allowed], ['AVBRUTEN', 'AVSLUTAD', 'SERVERAVBROTT', null, []], 'slutstatus och orsak');
    }
    assert.deepEqual((await anna('/api/kommando', { method: 'POST', body: drag })).body, kvitto, 'känt commandId: tidigare kvittens, utförs inte igen');
    const nytt = (await kommando(bo, 'BEKRÄFTA_BYTE', { matchId, revision: (await bo('/api/match')).body.view.revision, payload: { cards: [] } })).body;
    assert.deepEqual([nytt.status, nytt.message], ['AVVISAD', 'Matchen avbröts. Gå till lobbyn.']);
    assert.equal((await anna('/api/lobby')).body.me.activity, 'FÖLJER_AVSLUT');
    for (const k of [anna, bo]) assert.equal((await kommando(k, 'LÄMNA', { roomId })).body.status, 'GODKÄND');
    assert.equal((await anna('/api/lobby')).body.me.activity, 'LEDIG');
    const ny = await startaMatch([anna, bo], ids);
    assert.notEqual(ny.matchId, matchId, 'en ny match efter uppstädningen');
    stangStrommar();
    await srv.stoppa();

    const db = lasDb(dataDir);
    assert.equal(db.status(matchId), 'AVBRUTEN');
    assert.equal(db.slut(matchId), 1);
    assert.deepEqual(db.handelser(matchId), db.handelser(matchId).map((_, i) => i + 1));
    db.stang();
  } finally { stangStrommar(); rmSync(dir, { recursive: true, force: true }); }
});

test('SIGKILL under sparande: varje godkänd kvittens finns kvar efter omstarten och matchen avslutas säkert', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tornstriden-omstart-'));
  const dataDir = join(dir, 'data');
  try {
    let srv = await startaProcess(dataDir);
    assert.ok(srv.redo, srv.utdata());
    const { klienter, ids } = await gaster(srv, ['Ada', 'Ben', 'Cia', 'Dan']);
    const { matchId } = await startaMatch(klienter, ids);
    /* Alla väljer så fort de kan; servern dödas mitt i strömmen av drag. */
    const godkanda = [];
    let igang = true;
    const spelare = klienter.map(async (k, i) => {
      while (igang) {
        let v;
        try { v = (await k('/api/match')).body?.view; } catch { return; }
        const a = v?.allowed.find(x => x.type !== 'GE_UPP');
        if (!a) { await new Promise(r => setTimeout(r, 2)); continue; }
        const payload = a.type === 'BEKRÄFTA_BYTE' ? { cards: [] } : a.type === 'VÄLJ_MÅL' ? { targetPlayerId: a.players[0] } : a.type === 'SPELA_ATTACK' ? { instanceId: a.simple[0].instanceId, usage: 'simple' } : {};
        const type = a.type === 'SPELA_FÖRSVAR' ? 'AVSTÅ_FÖRSVAR' : a.type;
        const commandId = `p${i}-${++n}`;
        try {
          const svar = (await k('/api/kommando', { method: 'POST', body: { protocolVersion: 1, commandId, type, matchId, revision: v.revision, payload } })).body;
          if (svar.status === 'GODKÄND') godkanda.push({ k, commandId, svar });
        } catch { return; }   // servern dog medan draget var på väg: ingen kvittens, inget löfte
      }
    });
    while (godkanda.length < 12) await new Promise(r => setTimeout(r, 5));
    await srv.doda();
    igang = false;
    await Promise.all(spelare);

    srv = await startaProcess(dataDir);
    assert.ok(srv.redo, srv.utdata());
    await flytta(klienter, srv);
    for (const { k, commandId, svar } of godkanda) {
      const status = (await k(`/api/status?commandId=${commandId}&scope=match:${matchId}`)).body;
      assert.deepEqual(status, svar, `${commandId}: kvittensen som klienten fick finns sparad`);
    }
    stangStrommar();
    await srv.stoppa();
    const db = lasDb(dataDir);
    assert.equal(db.status(matchId), 'AVBRUTEN');
    assert.equal(db.slut(matchId), 1);
    const handelser = db.handelser(matchId);
    assert.deepEqual(handelser, handelser.map((_, i) => i + 1), 'inga luckor eller halva drag');
    const post = db.state(matchId);
    assert.equal(post.lastEventId, handelser.length);
    assert.ok(Math.max(...godkanda.map(g => g.svar.revision)) < post.engine.revision, 'avbrottet kom efter alla godkända drag');
    assert.ok(post.engine.players.every(p => p.status === 'LEVANDE' || p.eliminationReason === 'LIV'), 'ingen utslagen på grund av serverfelet');
    auditTeam(post.engine);   // kortbokföringen stämmer i den avbrutna matchen
    db.stang();
  } finally { stangStrommar(); rmSync(dir, { recursive: true, force: true }); }
});

test('SIGKILL under uppstädningen: nästa start städar resten, varje match får exakt en sluthändelse', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tornstriden-omstart-'));
  const dataDir = join(dir, 'data');
  try {
    /* Många pågående matcher från en tidigare körning: en riktig duell och en riktig lagmatch, kopierade under nya
       id så att uppstädningen tar tid nog att avbrytas mitt i. Processen "dör" utan uppstädning. */
    const forsta = startaServer({ port: 0, dataDir, klocka: styrdKlocka(1_000_000), logg: tyst });
    await forsta.klar;
    const forlagor = [];
    for (const size of [2, 4]) {
      const ids = Array.from({ length: size }, (_, i) => { const { session } = forsta.sessioner.skapa(`g${size}x${i}`); forsta.sessioner.anslut(session.playerId); return session.playerId; });
      const room = forsta.rum.skapa(ids[0]);
      forsta.rum.bjudIn(ids[0], room.id, ids.slice(1));
      for (const id of ids.slice(1)) forsta.rum.acceptera(id, forsta.rum.vyFor(id).inbjudningar.inkommande[0].id);
      ids.forEach((id, i) => forsta.rum.valjLag(id, room.id, i % 2 ? 'B' : 'A'));
      const rv = forsta.lagring.hamtaRum(room.id).rosterVersion;
      for (const id of ids) forsta.rum.redo(id, room.id, true, rv);
      forsta.rum.starta(ids[0], room.id, rv);
      forlagor.push(forsta.lagring.hamtaMatch(forsta.lagring.hamtaRum(room.id).matchId).match);
    }
    const ANTAL = 1500;
    forsta.lagring.transaktion(ops => {
      for (let i = 0; i < ANTAL; i++) {
        const post = structuredClone(forlagor[i % 2]);
        post.id = `m-kopia-${i}`;
        ops.sparaMatch(post);
      }
    });
    await forsta.stang();
    const total = ANTAL + 2;

    /* Ny process; provet läser databasen tätt och dödar processen när uppstädningen är halvvägs. */
    const db = lasDb(dataDir);
    const port = await ledigPort();
    const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'online/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TORNSTRIDEN_DATA_DIR: dataDir }, stdio: 'ignore' });
    const slut = new Promise(resolve => proc.on('exit', resolve));
    let dodadVid = null;
    for (;;) {
      const k = db.raknaAvbrutna();
      if (k > 0 && k < total) { proc.kill('SIGKILL'); dodadVid = k; break; }
      if (k === total || proc.exitCode !== null) break;
      await new Promise(r => setImmediate(r));
    }
    await slut;
    assert.ok(dodadVid !== null, 'processen dödades mitt i uppstädningen');
    const halvvags = db.raknaAvbrutna();
    assert.ok(halvvags > 0 && halvvags < total, `${halvvags} av ${total} avbrutna när processen dog`);
    const fel = sql => db.raw.prepare(sql).get().n;
    assert.equal(fel("SELECT COUNT(*) AS n FROM matcher m WHERE m.status = 'AVBRUTEN' AND (SELECT COUNT(*) FROM handelser h WHERE h.match_id = m.id AND h.typ = 'MATCHSLUT') != 1"), 0, 'varje avbruten har exakt en sluthändelse');
    assert.equal(fel("SELECT COUNT(*) AS n FROM matcher m WHERE m.status = 'PÅGÅR' AND (SELECT COUNT(*) FROM handelser h WHERE h.match_id = m.id AND h.typ = 'MATCHSLUT') != 0"), 0, 'ingen halv uppstädning');

    /* Nästa start städar resten, och bara resten. */
    const srv = await startaProcess(dataDir);
    assert.ok(srv.redo, srv.utdata());
    assert.match(srv.utdata(), new RegExp(`${total - halvvags} pågående match\\(er\\) avbröts`));
    await srv.stoppa();
    assert.equal(db.raknaAvbrutna(), total);
    assert.equal(fel("SELECT COUNT(*) AS n FROM matcher m WHERE (SELECT COUNT(*) FROM handelser h WHERE h.match_id = m.id AND h.typ = 'MATCHSLUT') != 1"), 0, 'exakt en sluthändelse per match');
    assert.equal(fel("SELECT COUNT(*) AS n FROM matcher WHERE status = 'PÅGÅR'"), 0);
    db.stang();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
