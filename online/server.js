/* Onlineserver för Tornstriden (arbetsordning L02–L03): `npm run online`, sedan http://127.0.0.1:8766/
   Inga npm-beroenden: inbyggt node:http, node:sqlite och Server-Sent Events (EventSource) för
   meddelanden från servern; kommandon skickas med fetch POST. Bakom Apache räcker ProxyPass för
   /api/ (ingen WebSocket-modul behövs). Lokalt serveras även de statiska filerna från samma port,
   så att kakor och EventSource får samma ursprung; i drift sköter Apache de statiska filerna.

   Sessionen (L03) ligger i HttpOnly-kakan `tornstriden_session`, SameSite=Lax, Secure bakom HTTPS.
   Varje skrivande anrop kräver att Origin stämmer med Host (eller TORNSTRIDEN_ORIGINS).

   Miljövariabler: PORT (8766), HOST (127.0.0.1), TORNSTRIDEN_DATA_DIR (../tornstriden-data, utanför
   webbrot och Git), TORNSTRIDEN_STATIC=0 stänger av statiska filer, TORNSTRIDEN_SECURE=1 tvingar
   Secure-kakor, TORNSTRIDEN_ORIGINS=https://tornstriden.landychev.se,... tillåtna ursprung,
   TORNSTRIDEN_LAGSPEL=0 stänger lagformaten 4/6/8 i lobbyn (öppna sedan lagvyn finns, L15).

   Livstecken (L17): strömmen skickar `ping {n}` var PING_MS; klienten svarar med POST /api/livstecken {n}.
   Har ingen ping besvarats på TYST_MS (räknat från när den senast besvarade pingen skickades) räknas det som ett
   avbrott, precis som en stängd anslutning: strömmen stängs och spelaren markeras frånkopplad för just den
   anslutningsgenerationen. En stängd ström får OMLADDNING_MS nåd innan avbrottet registreras i matchen – en
   omladdning eller ett sidbyte (lobbyn → matchsidan) blir då inget avbrott alls – men fristen räknas ändå från
   stängningen. En ny ström är en återkomst. Varken flikbyte eller omladdning skickar Ge upp.

   Omstart (L18, beslut 27B): innan servern lyssnar avbryts matcher som var pågående i förra körningen, utan
   vinnare (SERVERAVBROTT), och deltagarna kan gå till lobbyn. Misslyckas det (t.ex. lagringsfel) startar
   servern inte alls – den låtsas aldrig ha sparat avbrotten och tar inte emot några drag. */
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serveFile, ROOT } from '../server.js';
import { oppnaLagring } from './lagring.js';
import { skapaTjanst, systemklocka } from './tjanst.js';
import { skapaSessioner, SessionsFel, SESSION_TTL_MS } from './session.js';
import { skapaRumshantering } from './rum.js';
import { skapaMatcher } from './matcher.js';
import { PROTOCOL_VERSION, MAX_COMMAND_BYTES, CONNECTION, ContractError, publicSession } from '../kontrakt.js';

export const TJANST = 'tornstriden-online';
export const PING_MS = 5_000;    // ping i strömmen; håller också proxyn från att stänga tysta anslutningar
export const TYST_MS = 15_000;   // utan livstecken så här länge räknas anslutningen som avbruten (huvudplan §10)
export const OMLADDNING_MS = 3_000;   // nåd för en stängd ström innan matchen ser ett avbrott (omladdning, sidbyte)
export const STADNING_MS = 60_000;   // periodisk städning av rum, inbjudningar och sessioner
export const KAKA = 'tornstriden_session';

export function standardDataDir() { return resolve(ROOT, '..', 'tornstriden-data'); }

export function startaServer({ lagringsfabrik = oppnaLagring, port = Number(process.env.PORT) || 8766, host = process.env.HOST || '127.0.0.1', dataDir = process.env.TORNSTRIDEN_DATA_DIR || standardDataDir(), statiskt = process.env.TORNSTRIDEN_STATIC !== '0', secure = process.env.TORNSTRIDEN_SECURE === '1', origins = (process.env.TORNSTRIDEN_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean), lagspel = process.env.TORNSTRIDEN_LAGSPEL !== '0', klocka = systemklocka, slump = Math.random, logg = console } = {}) {
  const dbPath = dataDir === ':memory:' ? dataDir : join(resolve(dataDir), 'tornstriden.sqlite');
  if (dbPath !== ':memory:' && resolve(dbPath).startsWith(ROOT)) throw new Error(`Databasen får inte ligga i webbroten: ${dbPath}`);
  const lagring = lagringsfabrik({ path: dbPath, klocka });
  const tjanst = skapaTjanst({ lagring, klocka, slump, logg });
  const sessioner = skapaSessioner({ lagring, klocka });
  sessioner.registrera(tjanst);
  const rum = skapaRumshantering({ lagring, klocka, ko: tjanst.ko, logg });
  rum.registrera(tjanst);
  const matcher = skapaMatcher({ lagring, klocka, rum, lagspel });
  matcher.registrera(tjanst);   // duell för 2 deltagare, lagmatch för 4/6/8 (L14)
  /* Uppstart efter omstart (27B): alla frånkopplade, rummens timers tillbaka och gamla pågående matcher
     avbrutna utan vinnare. Körs först när porten är tagen (se `klar`), så att en andra instans på samma
     port aldrig rör en körande servers matcher. */
  let omstart = null;
  function forbered() {
    sessioner.markeraAllaFrankopplade();
    rum.aterstall();
    omstart = matcher.avbrytEfterOmstart();
    if (omstart.avbrutna) logg.warn(`[server] servern startades om: ${omstart.avbrutna} pågående match(er) avbröts utan vinnare (SERVERAVBROTT).`);
  }
  const strommar = new Set();   // { res, puls, playerId, generation, lastEventId, senast }

  const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
  const halsa = () => ({ tjanst: TJANST, protocolVersion: PROTOCOL_VERSION, schemaversion: lagring.schemaversion, matchtrafik: { oppen: tjanst.matchtrafik.oppen, orsak: tjanst.matchtrafik.orsak }, tid: klocka.now() });

  /* ---- Kakor, session och Origin ---- */
  const kakor = req => Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=')).filter(([k, v]) => k && v !== undefined).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  const arSaker = req => secure || req.headers['x-forwarded-proto'] === 'https';
  const sattKaka = (req, token) => `${KAKA}=${token}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; SameSite=Lax${arSaker(req) ? '; Secure' : ''}`;
  const raderaKaka = req => `${KAKA}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${arSaker(req) ? '; Secure' : ''}`;
  const sessionFor = req => sessioner.hamta(kakor(req)[KAKA]);
  function tillatetUrsprung(req) {
    const origin = req.headers.origin;
    if (!origin) return req.headers['sec-fetch-site'] === 'same-origin' || req.headers['sec-fetch-site'] === 'none';   // äldre klienter utan Origin avvisas om de heller inte säger same-origin
    if (origins.includes(origin)) return true;
    let host;
    try { host = new URL(origin).host; } catch { return false; }
    return host === req.headers.host;
  }

  function lasKropp(req) {
    return new Promise((resolveBody, rejectBody) => {
      let text = '';
      let forStor = Number(req.headers['content-length']) > MAX_COMMAND_BYTES;   // större gränser sätts i proxyn (L21)
      req.setEncoding('utf8');
      req.on('data', chunk => { if (forStor) return; text += chunk; if (text.length > MAX_COMMAND_BYTES) forStor = true; });
      req.on('end', () => forStor ? rejectBody(Object.assign(new Error('För stort kommando.'), { status: 413 })) : resolveBody(text));
      req.on('error', rejectBody);
    });
  }
  async function lasJson(req) {
    const text = await lasKropp(req);
    try { return JSON.parse(text || 'null'); } catch { throw Object.assign(new Error('Kroppen måste vara JSON.'), { status: 400 }); }
  }

  /* ---- Händelseström (SSE) och utskick ---- */
  const skicka = (strom, event, data) => { if (!strom.res.writableEnded) strom.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  /* Allt en spelare behöver för lobbyn och sitt rum; skickas i sin helhet vid varje ändring. */
  const lobbyvy = session => ({ me: publicSession(session), players: sessioner.lobbylista(), ...rum.vyFor(session.playerId) });
  function sandLobby() {
    const players = sessioner.lobbylista();
    for (const strom of strommar) skicka(strom, 'lobby', { me: players.find(p => p.playerId === strom.playerId) ?? null, players, ...rum.vyFor(strom.playerId) });
  }
  /* Matchvy till varje deltagare som har en ström: egen privat vy + händelser sedan strömmens senaste. */
  function sandMatch() {
    for (const strom of strommar) {
      const m = matcher.matchFor(strom.playerId, { efterEventId: strom.lastEventId });
      if (!m) { strom.lastEventId = 0; continue; }
      if (strom.lastEventId === m.view.lastEventId && strom.matchId === m.view.matchId) continue;
      strom.matchId = m.view.matchId;
      strom.lastEventId = m.view.lastEventId;
      skicka(strom, 'match', { view: m.view, events: m.events, status: m.status });
    }
  }
  const sandAlla = () => { sandLobby(); sandMatch(); };
  rum.pa(sandAlla);
  matcher.pa(sandAlla);   // tidsgräns, avbrott och återkomst ändrar matchen utan något kommando
  let stadning = klocka.setTimeout(function stada() {
    try { const r = rum.stada(); sessioner.rensaUtgangna(); if (r.utgangna || r.stangda || r.raderade) sandLobby(); } catch (error) { logg.warn(`[server] städning: ${error.message}`); }
    stadning = klocka.setTimeout(stada, STADNING_MS);
  }, STADNING_MS);
  function stangStrom(strom) {
    klocka.clearTimeout(strom.puls);
    strommar.delete(strom);
    if (!strom.res.writableEnded) strom.res.end();
  }

  /* Strömmen är borta (stängd av klienten eller tyst för länge): frånkopplad för just den generationen.
     En gammal ström som redan ersatts av en ny flik eller återanslutning gör ingenting. */
  const nadTimers = new Set();
  function tappa(strom, { tyst = false } = {}) {
    const varAktiv = strommar.has(strom);
    const tid = klocka.now();   // avbrottets början: fristen räknas härifrån även efter nåden
    stangStrom(strom);
    if (!varAktiv || !sessioner.kopplaFran(strom.playerId, strom.generation)) return;
    rum.markeraAnslutning(strom.playerId, CONNECTION.offline);
    sandLobby();
    const { playerId, generation } = strom;
    if (tyst) { matcher.frankopplad(playerId, generation, tid); return; }   // redan 15 s utan svar
    /* Nåd: en omladdning blir inget avbrott. Men går spelarens turklocka ut under nåden registreras avbrottet
       direkt (räknat från stängningen), så att den kvarvarande turtiden skyddas. Kommer en ny ström inom nåden
       har generationen bytts och det senare avbrottet ignoreras i matchkön. */
    matcher.frankopplad(playerId, generation, tid, { nad: OMLADDNING_MS });
    const id = klocka.setTimeout(() => { nadTimers.delete(id); matcher.frankopplad(playerId, generation, tid); }, OMLADDNING_MS);
    nadTimers.add(id);
  }

  function oppnaStrom(req, res, session) {
    const tid = klocka.now();   // återkomstens mottagningstid (avgör mot fristen, inte när kön hinner fram)
    /* En styrande anslutning per session: en extra flik tar över och den gamla får besked. */
    for (const gammal of [...strommar].filter(s => s.playerId === session.playerId)) {
      skicka(gammal, 'ersatt', { message: 'Spelet är öppet i en annan flik.' });
      stangStrom(gammal);
    }
    const generation = sessioner.anslut(session.playerId);
    rum.markeraAnslutning(session.playerId, CONNECTION.online);
    matcher.ansluten(session.playerId, generation, tid);
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`retry: 3000\nevent: halsa\ndata: ${JSON.stringify(halsa())}\n\n`);
    const strom = { res, puls: null, playerId: session.playerId, generation, lastEventId: 0, matchId: null, senast: tid, ping: 0, pingTid: new Map() };
    /* Ping var PING_MS; har ingen ping besvarats på TYST_MS är anslutningen avbruten. */
    const pinga = () => {
      if (res.writableEnded) return;
      if (klocka.now() - strom.senast >= TYST_MS) { tappa(strom, { tyst: true }); return; }
      strom.ping += 1;
      strom.pingTid.set(strom.ping, klocka.now());
      if (strom.pingTid.size > 8) strom.pingTid.delete(strom.ping - 8);
      skicka(strom, 'ping', { n: strom.ping });
      strom.puls = klocka.setTimeout(pinga, PING_MS);
    };
    strom.puls = klocka.setTimeout(pinga, PING_MS);
    strommar.add(strom);
    sandLobby();   // även den nya strömmen får sin första lobbyvy här
    const m = matcher.matchFor(session.playerId);
    if (m) { strom.matchId = m.view.matchId; strom.lastEventId = m.view.lastEventId; skicka(strom, 'match', { view: m.view, events: [], status: m.status }); }
    req.on('close', () => tappa(strom));
  }

  /* ---- Routing ---- */
  async function hantera(req, res) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) {
      if (statiskt) serveFile(req, res); else json(res, 404, { message: 'Inte här: statiska filer serveras av webbservern.' });
      return;
    }
    const skrivande = req.method !== 'GET' && req.method !== 'HEAD';
    if (skrivande && !tillatetUrsprung(req)) return json(res, 403, { message: 'Anropet kommer från ett annat ursprung.' });
    const session = sessionFor(req);
    const { pathname } = url;

    if (pathname === '/api/halsa' && req.method === 'GET') return json(res, 200, halsa());

    if (pathname === '/api/session' && req.method === 'POST') {
      if (session) return json(res, 200, lobbyvy(session));   // befintlig session återupptas före ny nickreservation
      const body = await lasJson(req);
      const { session: ny, token } = sessioner.skapa(body?.nick);
      logg.info(`[session] ny gäst ${ny.playerId}`);
      return json(res, 201, lobbyvy(ny), { 'set-cookie': sattKaka(req, token) });
    }
    if (pathname === '/api/session' && req.method === 'GET') return json(res, 200, session ? lobbyvy(session) : { me: null });   // "vem är jag?" är aldrig ett fel
    if (pathname === '/api/session' && req.method === 'DELETE') {
      if (session) {
        if (session.roomId) { try { rum.lamna(session.playerId, session.roomId); } catch { /* rummet kan redan vara borta */ } }
        sessioner.lamna(session.playerId);
        for (const strom of [...strommar].filter(s => s.playerId === session.playerId)) stangStrom(strom);
        sandLobby();
      }
      return json(res, 200, { message: 'Du har lämnat lobbyn.' }, { 'set-cookie': raderaKaka(req) });
    }

    /* Allt nedan kräver session. */
    const kravSession = () => { if (!session) throw new SessionsFel(401, 'Ingen session. Välj ett nick först.'); return session; };
    if (pathname === '/api/lobby' && req.method === 'GET') return json(res, 200, lobbyvy(kravSession()));
    if (pathname === '/api/handelser' && req.method === 'GET') return oppnaStrom(req, res, kravSession());
    if (pathname === '/api/livstecken' && req.method === 'POST') {
      const { playerId } = kravSession();
      const n = Number((await lasKropp(req).catch(() => '')).match(/"n":\s*(\d+)/)?.[1]);
      /* Svaret på ping n bevisar att anslutningen levde när ping n skickades; utan n räknas nu. */
      for (const strom of strommar) if (strom.playerId === playerId) strom.senast = Math.max(strom.senast, strom.pingTid.get(n) ?? (Number.isInteger(n) ? strom.senast : klocka.now()));
      res.writeHead(204, { 'cache-control': 'no-store' });
      return res.end();
    }
    if (pathname === '/api/kommando' && req.method === 'POST') {
      const { playerId } = kravSession();
      const receipt = await tjanst.kommando(playerId, await lasJson(req));
      if (receipt.status === 'GODKÄND') sandAlla();   // nickbyte, rum och matchdrag syns för alla berörda
      return json(res, 200, receipt);
    }
    if (pathname === '/api/match' && req.method === 'GET') {
      const { playerId } = kravSession();
      const efter = url.searchParams.get('efterEventId');
      const m = matcher.matchFor(playerId, { efterEventId: efter === null ? null : Number(efter) });
      return m ? json(res, 200, m) : json(res, 404, { message: 'Du är inte i någon match.' });
    }
    if (pathname === '/api/status' && req.method === 'GET') {
      const { playerId } = kravSession();
      const commandId = url.searchParams.get('commandId');
      if (!commandId) return json(res, 400, { message: 'commandId krävs.' });
      return json(res, 200, tjanst.status(playerId, url.searchParams.get('scope') ?? `spelare:${playerId}`, commandId));
    }
    json(res, 404, { message: 'Okänd adress.' });
  }

  const server = createServer((req, res) => {
    hantera(req, res).catch(error => {
      if (error instanceof ContractError) return json(res, 400, { message: error.message, field: error.field });
      if (error instanceof SessionsFel || error.status) return json(res, error.status, { message: error.message });
      logg.error(`[server] ${req.method} ${req.url}: ${error.message}`);
      if (!res.headersSent) json(res, 500, { message: 'Internt fel.' }); else res.end();
    });
  });
  /* `listening` kommer före varje anslutning och förberedelsen är synkron: ingen begäran hanteras innan
     avbrotten är sparade. Är porten upptagen eller misslyckas förberedelsen startar servern inte. */
  let startad = false;
  const klar = new Promise((resolveStart, rejectStart) => {
    const avbryt = error => {
      klocka.clearTimeout(stadning);
      rum.stang();
      server.close();
      try { lagring.stang(); } catch { /* lagringen kan redan vara trasig */ }
      rejectStart(error);
    };
    server.on('error', error => { if (!startad) avbryt(error); else logg.error(`[server] ${error.message}`); });
    server.once('listening', () => {
      try { forbered(); } catch (error) { return avbryt(new Error(`Uppstädningen efter omstart misslyckades – servern startar inte: ${error.message}`, { cause: error })); }
      startad = true;
      resolveStart();
    });
  });
  server.listen(port, host);

  async function stang() {
    klocka.clearTimeout(stadning);
    for (const id of nadTimers) klocka.clearTimeout(id);
    rum.stang();
    await matcher.stang();
    for (const strom of [...strommar]) stangStrom(strom);
    await new Promise(resolveClose => server.close(resolveClose));
    lagring.stang();
  }

  return { server, tjanst, lagring, sessioner, rum, matcher, duell: matcher.duell, klar, stang, strommar, port: () => server.address()?.port, dbPath, get omstart() { return omstart; } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let app;
  try { app = startaServer(); } catch (error) { console.error(`Kunde inte starta: ${error.message}`); process.exit(1); }
  app.klar.then(() => {
    console.log(`Tornstriden online: http://127.0.0.1:${app.port()}/  (data i ${app.dbPath}, Ctrl+C avslutar)`);
  }).catch(error => { console.error(`Kunde inte starta: ${error.message}`); process.exit(1); });
  const avsluta = () => app.stang().then(() => process.exit(0));
  process.on('SIGINT', avsluta);
  process.on('SIGTERM', avsluta);
}
