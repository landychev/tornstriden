/* Belastnings-, isolerings- och missbruksprov (arbetsordning L20) mot en riktig serverprocess (online/server.js).

   Kapacitetsmål (arbetsordningen, beslutsraden för L20–L22): 10 samtidiga matcher med upp till 80 anslutningar.
   Standardkörningen är målet självt: tio lagmatcher med åtta deltagare var. `--storlekar 2,4,6,8,…` ger en
   blandning. Varje deltagare är en egen HTTP-klient med egen kaka och en egen SSE-ström som svarar på ping, precis
   som en webbläsare. Hela flödet går över HTTP: nick, rum, inbjudan, acceptans, lag, Redo, Starta, matchen till
   slut och Lämna tillbaka till lobbyn.

   Deltagarna väljer ur sin egen privata vy efter en kort betänketid (standard 150–600 ms), som stressar mer än
   verkliga spelare. I två matcher lämnar tre i samma lag (1 mot 4, ojämna lag). I en match tappar en spelare
   strömmen och kommer tillbaka; i en annan slutar en spelare svara på ping tills servern stänger strömmen
   (verkliga avbrott över nätet, med verklig tid).

   Mäts: svarstid för kommandon (p50/p95/max), tid tills alla anslutna i matchen har fått händelsen som draget gav
   (händelse-ID ur kvittensen, inte revision – bekräftelser ändrar händelse-ID men inte revision), serverns CPU och
   minne (/proc på Linux, annars `ps`), felkoder och avvisningar. Varje godkänt drag ska nå alla anslutna i matchen:
   utskick som fortfarande väntar när matchen är slut, och en sista vy som saknas, fäller provet. Dessutom prövas
   för sig att en bekräftelse (nytt händelse-ID, samma revision) når båda strömmarna utan att något annat händer. Saknas mätvärden
   för minnet blir kontrollen "ej verifierat" och provet faller. Kontrolleras: inga hemliga nycklar och ingen annans hand i något
   svar eller någon strömhändelse, inget från en annan match, händelse-ID i stigande ordning utan dubbletter,
   alla matcher avslutade och alla tillbaka som lediga.

   Därefter missbruk och gränser mot samma process: statiska filer utanför klientlistan, ursprung, session,
   storlek, ogiltig JSON, påstådd identitet, främmande match, samma commandId med annat innehåll, en skur av
   gamla drag, flera strömmar per session, andras kvittenser och taket för antalet sessioner.

   Kör från projektroten: `node scripts/prova-belastning.mjs [--storlekar 8,8,…] [--tanke 150-600]`.
   Resultatet skrivs också som JSON i en tillfällig katalog. */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoSecrets, validatePrivateView, PROTOCOL_VERSION, MATCH_COMMAND } from '../kontrakt.js';
import { styrdSlump } from '../teststod.js';

const arg = (namn, standard) => { const i = process.argv.indexOf(`--${namn}`); return i === -1 ? standard : process.argv[i + 1]; };
const STORLEKAR = arg('storlekar', '8,8,8,8,8,8,8,8,8,8').split(',').map(Number);
const [TANKE_MIN, TANKE_MAX] = arg('tanke', '150-600').split('-').map(Number);
const MAL = { matcher: 10, anslutningar: 80, p95KommandoMs: 250, maxKommandoMs: 2000, p95UtskickMs: 500, maxUtskickMs: 2000, maxMinneMB: 300 };
const ROOT = new URL('../', import.meta.url).pathname;
const OUT = mkdtempSync(join(tmpdir(), 'tornstriden-belastning-'));
console.log(`Data och resultat: ${OUT}`);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok, extra }); console.log(`${ok ? 'OK ' : 'FEL'} ${name}${extra ? ' – ' + extra : ''}`); };
const vanta = ms => new Promise(r => setTimeout(r, ms));
const random = styrdSlump(2026);
const pick = list => list[Math.floor(random() * list.length)];
const percentil = (lista, p) => { if (!lista.length) return null; const s = [...lista].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]); };

/* ---- Serverprocessen ---- */
const ledigPort = () => new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const PORT = await ledigPort();
const base = `http://127.0.0.1:${PORT}`;
/* Alla simulerade spelare delar loopback-adress. IP-begränsningen provas separat i serverproven;
   här höjs den bara för den egna testprocessen så att kapaciteten och sessionstaket kan mätas. */
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'online/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), TORNSTRIDEN_DATA_DIR: join(OUT, 'data'), TORNSTRIDEN_REGISTRERINGAR_PER_MINUT: '500' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverlogg = '';
server.stdout.on('data', d => { serverlogg += d; });
server.stderr.on('data', d => { serverlogg += d; });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/halsa`)).ok) break; } catch { /* startar */ } await vanta(100); }

/* Serverns CPU och minne var 500 ms: ur /proc på Linux, annars ur `ps` (macOS och andra Unix). Ett misslyckat
   prov medan servern lever räknas – minneskontrollen godkänns bara med verkliga mätvärden. */
const MATNING = process.env.TORNSTRIDEN_MATNING ?? (existsSync(`/proc/${server.pid}/stat`) ? 'proc' : 'ps');
const sekunder = text => { const [d, rest] = text.includes('-') ? text.split('-') : [0, text]; return Number(d) * 86400 + rest.split(':').reduce((sum, del) => sum * 60 + Number(del), 0); };
const lasProcess = {
  proc: () => {
    const stat = readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const cpuSek = (Number(stat[11]) + Number(stat[12])) / 100;
    const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${server.pid}/status`, 'utf8'))[1]) / 1024;
    return { cpuSek, rss };
  },
  ps: () => {
    const [rssKB, tid] = execFileSync('ps', ['-o', 'rss=', '-o', 'time=', '-p', String(server.pid)], { encoding: 'utf8' }).trim().split(/\s+/);
    return { cpuSek: sekunder(tid), rss: Number(rssKB) / 1024 };
  },
  ingen: () => { throw new Error('mätning avstängd'); }
};
const resurser = [];
const matfel = [];
let forraCpu = null;
const sampla = () => {
  if (server.exitCode !== null || server.signalCode !== null) return;
  try {
    const { cpuSek, rss } = (lasProcess[MATNING] ?? lasProcess.ingen)();
    if (!Number.isFinite(cpuSek) || !Number.isFinite(rss) || rss <= 0) throw new Error(`ogiltigt mätvärde (cpu ${cpuSek}, rss ${rss})`);
    const t = Date.now();
    resurser.push({ t, rss, cpu: forraCpu && t > forraCpu.t ? (cpuSek - forraCpu.cpuSek) / ((t - forraCpu.t) / 1000) * 100 : null });
    forraCpu = { t, cpuSek };
  } catch (e) { if (matfel.length < 5) matfel.push(`${MATNING}: ${e.message.split('\n')[0]}`); else matfel.push(''); }
};
const samplare = setInterval(sampla, 500);

/* ---- Mätvärden och kontroller som samlas under körningen ---- */
const latens = { lobby: [], match: [] };
const utskick = [];                 // ms från att ett godkänt drag skickades tills alla anslutna i matchen fått dess händelse
const statuskoder = new Map();
const avvisningar = new Map();
const brister = [];                 // hemligheter, läckor, fel match, dubbla händelser
const brist = text => { if (brister.length < 50) brister.push(text); };
const saAvbrott = new Set();        // "match|spelare/plats" som någon såg som frånkopplad
const livsteckenMs = [];            // svarstid för livstecken (ping-svar)
const strombrott_ovantade = [];     // strömmar som servern stängde utan att provet bad om det

/* Händer och synliga kort per match och revision: syns någon annans hand i min vy vid samma revision är det en läcka. */
const register = new Map();          // matchId -> revision -> { hand: Map(spelare -> Set), syns: Map(spelare -> Set) }
const INSTANS = /"([^"]+):kort:(\d+)"/g;
function registrera(view) {
  const per = register.get(view.matchId) ?? new Map();
  register.set(view.matchId, per);
  const r = per.get(view.revision) ?? { hand: new Map(), syns: new Map() };
  per.set(view.revision, r);
  const hand = new Set(view.me.hand.map(c => c.instanceId));
  const syns = new Set();
  for (const [, mid, n] of JSON.stringify(view).matchAll(INSTANS)) {
    if (mid !== view.matchId) brist(`${view.viewer}: kort från en annan match (${mid}) i vyn`);
    const id = `${mid}:kort:${n}`;
    if (!hand.has(id)) syns.add(id);
  }
  r.hand.set(view.viewer, hand);
  r.syns.set(view.viewer, syns);
  for (const [annan, h] of r.hand) if (annan !== view.viewer) for (const id of h) if (syns.has(id)) brist(`${view.viewer} ser ${annan}s handkort ${id} (revision ${view.revision})`);
  for (const [annan, s] of r.syns) if (annan !== view.viewer) for (const id of hand) if (s.has(id)) brist(`${annan} ser ${view.viewer}s handkort ${id} (revision ${view.revision})`);
}

/* En testklients val ur sin egen vy (samma som i online/server.test.js): byt inget eller några, välj mål,
   spela eller avstå, bekräfta. */
function val(view) {
  const valbara = view.allowed.filter(a => a.type !== 'GE_UPP');
  if (!valbara.length) return null;
  const a = pick(valbara);
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

let kommandoNr = 0;
let stoppat = false;                // sätts när servern stängs; botarna slutar då agera
const MATCHKOMMANDON = new Set(Object.values(MATCH_COMMAND));
class Klient {
  constructor(nick, { bot = true } = {}) { Object.assign(this, { nick, bot, cookie: null, id: null, vy: null, status: null, lobby: null, senasteHandelse: 0, agerar: false, tyst: false, borta: false, lamnat: false, strom: null, matchId: null }); }
  /* I en duell är vyns egen identitet platsen (A/B), i lagmatchen spelar-ID. */
  egen(data) { return data?.view?.me?.id ?? this.id; }
  async anrop(path, { method = 'GET', body, typ = null } = {}) {
    const t0 = performance.now();
    const svar = await fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base, ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const ms = performance.now() - t0;
    statuskoder.set(svar.status, (statuskoder.get(svar.status) ?? 0) + 1);
    const satt = svar.headers.get('set-cookie');
    if (satt) this.cookie = satt.split(';')[0];
    const text = await svar.text();
    const data = text ? JSON.parse(text) : null;
    if (data) { try { assertNoSecrets(data, this.egen(data)); } catch (e) { brist(`${this.nick}: ${path}: ${e.message}`); } }
    if (typ) latens[typ].push(ms);
    return { status: svar.status, data, ms };
  }
  kommando(type, extra = {}) {
    return this.anrop('/api/kommando', { method: 'POST', body: { protocolVersion: PROTOCOL_VERSION, commandId: `b${++kommandoNr}`, type, payload: {}, ...extra }, typ: MATCHKOMMANDON.has(type) ? 'match' : 'lobby' });
  }
  async gaIn() { const s = await this.anrop('/api/session', { method: 'POST', body: { nick: this.nick } }); this.id = s.data.me.playerId; }
  /* SSE-strömmen: svarar på ping (om inte "tyst"), tar emot lobby- och matchvyer. */
  oppnaStrom() {
    const kontroll = new AbortController();
    this.strom = kontroll;
    const oppnad = performance.now();
    const egen = (async () => {
      const svar = await fetch(`${base}/api/handelser`, { headers: { cookie: this.cookie }, signal: kontroll.signal });
      const reader = svar.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, i); buffer = buffer.slice(i + 2);
          const typ = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (!typ || !data) continue;
          if (typ === 'ping') {
            if (this.tyst) continue;
            const t = performance.now();
            void this.anrop('/api/livstecken', { method: 'POST', body: JSON.parse(data) }).then(s => { livsteckenMs.push(performance.now() - t); if (s.status !== 204) brist(`${this.nick}: livstecken ${s.status}`); }, e => brist(`${this.nick}: livstecken misslyckades: ${e.message}`));
            continue;
          }
          const innehall = JSON.parse(data);
          try { assertNoSecrets(innehall, this.egen(innehall)); } catch (e) { brist(`${this.nick}: ström ${typ}: ${e.message}`); }
          if (typ === 'lobby') this.lobby = innehall;
          if (typ === 'match') this.taEmot(innehall);
        }
      }
      if (this.strom === kontroll && !kontroll.signal.aborted) this.ovantatSlut(`servern stängde strömmen efter ${Math.round((performance.now() - oppnad) / 1000)} s`, kontroll);
    })().catch(e => { if (!kontroll.signal.aborted) this.ovantatSlut(`strömfel ${e.message}`, kontroll); });
    return egen;
  }
  stangStrom() { this.strom?.abort(); this.strom = null; slapp(this); }
  /* Som EventSource: en ström som servern stänger öppnas igen efter 3 s (retry: 3000). */
  ovantatSlut(orsak, kontroll) {
    strombrott_ovantade.push(`${this.nick} (${this.vy?.phase ?? 'lobby'}, strid ${this.vy?.battleNumber ?? '-'}): ${orsak}`);
    slapp(this);   // utan ström kan inget nå fram; återkomsten ger en aktuell vy (och strömslutet räknas som fel om det inte var avsiktligt)
    if (!this.tyst) setTimeout(() => { if (this.strom === kontroll) this.oppnaStrom(); }, 3000);   // utan nät (tyst) går det inte
  }
  taEmot({ view, events = [], status }) {
    if (this.matchId && view.matchId !== this.matchId) brist(`${this.nick}: vy från en annan match`);
    for (const e of events) {
      if (e.matchId !== view.matchId) brist(`${this.nick}: händelse från en annan match`);
      if (e.eventId <= this.senasteHandelse) brist(`${this.nick}: händelse ${e.eventId} kom två gånger eller i fel ordning`);
      this.senasteHandelse = Math.max(this.senasteHandelse, e.eventId);
    }
    this.senasteHandelse = Math.max(this.senasteHandelse, view.lastEventId);
    try { validatePrivateView(view); } catch (e) { brist(`${this.nick}: ogiltig vy: ${e.message}`); }
    registrera(view);
    for (const id of Object.keys(view.disconnects ?? {})) saAvbrott.add(`${view.matchId}|${id}`);
    const forra = this.vy;
    this.vy = view;
    this.status = status ?? this.status;
    if (!forra || view.lastEventId > forra.lastEventId) nyHandelse(this, view.lastEventId);
    this.planera();
  }
  planera() {
    if (stoppat || !this.bot || this.agerar || this.borta || this.lamnat || this.tyst || !this.vy) return;
    if (!this.vy.allowed.some(a => a.type !== 'GE_UPP')) return;
    this.agerar = true;
    setTimeout(() => void this.agera(), TANKE_MIN + random() * (TANKE_MAX - TANKE_MIN));
  }
  async agera() {
    try {
      const v = this.vy;
      if (this.borta || this.lamnat || this.tyst) return;
      const drag = val(v);
      if (!drag) return;
      const skickat = performance.now();
      const s = await this.kommando(drag.type, { matchId: v.matchId, revision: v.revision, payload: drag.payload });
      if (s.data?.status === 'GODKÄND') vantaUtskick(v.matchId, s.data.eventId, skickat, this);
      else avvisningar.set(s.data?.message ?? `HTTP ${s.status}`, (avvisningar.get(s.data?.message ?? `HTTP ${s.status}`) ?? 0) + 1);
    } catch (e) {
      if (!stoppat) brist(`${this.nick}: draget kunde inte skickas: ${e.message}`);   // en bot med gammal vy får inte krascha provet
    } finally {
      this.agerar = false;
      this.planera();
    }
  }
}

/* Utskick: när har alla anslutna i matchen fått händelsen som ett godkänt drag gav? Nyckeln är händelse-ID ur
   kvittensen – en bekräftelse ger en ny händelse men samma revision. Varje godkänt drag räknas: levererat till
   alla (latensen mäts), släppt (alla väntade mottagare lämnade eller tappade strömmen avsiktligt) eller saknat. */
const matchKlienter = new Map();    // matchId -> Klient[]
const vantande = [];                // { matchId, eventId, skickat, kvar: Set, levererat }
const utskickRakning = { godkanda: 0, levererade: 0, slappta: 0 };
function vantaUtskick(matchId, eventId, skickat, avsandare) {
  utskickRakning.godkanda++;
  if (!Number.isInteger(eventId)) { brist(`${avsandare.nick}: godkänd kvittens utan händelse-ID`); return; }
  const kvar = new Set((matchKlienter.get(matchId) ?? []).filter(k => !k.lamnat && k.strom && (k.vy?.lastEventId ?? -1) < eventId));
  if (!kvar.size) { utskickRakning.levererade++; utskick.push(performance.now() - skickat); return; }
  vantande.push({ matchId, eventId, skickat, kvar, levererat: 0 });
}
function avklarad(i, w) {
  vantande.splice(i, 1);
  if (w.levererat) { utskickRakning.levererade++; utskick.push(performance.now() - w.skickat); } else utskickRakning.slappta++;
}
function nyHandelse(klient, lastEventId) {
  for (let i = vantande.length - 1; i >= 0; i--) {
    const w = vantande[i];
    if (w.matchId !== klient.vy.matchId || lastEventId < w.eventId || !w.kvar.delete(klient)) continue;
    w.levererat++;
    if (!w.kvar.size) avklarad(i, w);
  }
}
/* En klient som avsiktligt lämnar eller tappar strömmen väntas inte längre in. */
function slapp(klient) {
  for (let i = vantande.length - 1; i >= 0; i--) {
    const w = vantande[i];
    if (w.kvar.delete(klient) && !w.kvar.size) avklarad(i, w);
  }
}

/* ---- 1. Lobbyn: alla går in och öppnar sin ström ---- */
const start = performance.now();
const grupper = STORLEKAR.map((storlek, m) => Array.from({ length: storlek }, (_, i) => new Klient(`M${m + 1}-${'ABCDEFGH'[i]}`)));
const alla = grupper.flat();
await Promise.all(alla.map(k => k.gaIn()));
alla.forEach(k => k.oppnaStrom());
await vanta(1500);
check(`${alla.length} sessioner med egna strömmar i lobbyn`, alla.every(k => k.lobby?.players?.length === alla.length), `${alla.filter(k => k.lobby).length} har lobbyvyn`);

/* ---- 2. Rum: alla grupper samtidigt – inbjudan, acceptans, lag, Redo och Starta ---- */
async function ordnaRum(grupp) {
  const [vard, ...ovriga] = grupp;
  await vard.kommando('SKAPA_RUM');
  const roomId = (await vard.anrop('/api/lobby')).data.rum.id;
  const inbjudan = await vard.kommando('BJUD_IN', { roomId, payload: { playerIds: ovriga.map(k => k.id) } });
  if (inbjudan.data.status !== 'GODKÄND') throw new Error(`${vard.nick}: ${inbjudan.data.message}`);
  await Promise.all(ovriga.map(async k => { const inv = (await k.anrop('/api/lobby')).data.inbjudningar.inkommande[0]; await k.kommando('ACCEPTERA', { payload: { invitationId: inv.id } }); }));
  await Promise.all(grupp.map((k, i) => k.kommando('VÄLJ_LAG', { roomId, payload: { teamId: i % 2 ? 'B' : 'A' } })));
  for (let forsok = 0; forsok < 5; forsok++) {
    const rv = (await vard.anrop('/api/lobby')).data.rum.rosterVersion;
    const svar = await Promise.all(grupp.map(k => k.kommando('REDO', { roomId, payload: { ready: true, rosterVersion: rv } })));
    if (svar.every(s => s.data.status === 'GODKÄND')) {
      const s = await vard.kommando('STARTA', { roomId, payload: { rosterVersion: rv } });
      if (s.data.status === 'GODKÄND') break;
    }
  }
  const lobby = (await vard.anrop('/api/lobby')).data;
  const matchId = (await vard.anrop('/api/match')).data?.view?.matchId;
  if (!matchId) throw new Error(`${vard.nick}: matchen startade inte (${JSON.stringify(lobby.start)})`);
  for (const k of grupp) k.matchId = matchId;
  matchKlienter.set(matchId, grupp);
  return { roomId, matchId };
}
const tLobby = performance.now();
const rum = await Promise.all(grupper.map(ordnaRum));
const lobbyTid = performance.now() - tLobby;
check(`${rum.length} rum ordnade och startade samtidigt över HTTP`, rum.every(r => r.matchId), `${Math.round(lobbyTid)} ms`);

/* Händelser i vissa matcher: avhopp till 1 mot 4, ett strömavbrott och ett tyst avbrott. */
const attor = grupper.filter(g => g.length === 8);
const avhopp = attor.slice(0, 2);                 // lag A lämnar ner till en spelare
const strombrott = attor[2]?.[1];                // tappar strömmen 6 s och kommer tillbaka
const tystnad = attor[3]?.[2];                    // svarar inte på ping förrän servern stänger strömmen
const handelseLogg = [];
const iMatch = k => k.vy && k.vy.phase !== 'AVSLUTAD';
(async () => {
  while (!grupper.every(g => g.every(k => k.vy?.phase === 'AVSLUTAD' || k.lamnat))) {
    for (const g of avhopp) {
      if (!g[0].vy || g[0].vy.battleNumber < 2 || !iMatch(g[0])) continue;
      for (const k of [g[2], g[4], g[6]]) {   // lag A: index 0, 2, 4, 6 – kvar blir index 0
        if (k.lamnat || !k.vy?.allowed.some(a => a.type === 'GE_UPP')) continue;
        const s = await k.kommando('GE_UPP', { matchId: k.matchId, revision: k.vy.revision });
        k.lamnat = s.data?.status === 'GODKÄND';
        if (k.lamnat) slapp(k);
        handelseLogg.push(`${k.nick} lämnade: ${s.data?.status}${k.lamnat ? '' : ` (${s.data?.message})`}`);
      }
    }
    if (strombrott && !strombrott.brutet && strombrott.vy?.battleNumber >= 2 && iMatch(strombrott)) {
      strombrott.brutet = true;
      strombrott.stangStrom();
      handelseLogg.push(`${strombrott.nick} tappade strömmen`);
      setTimeout(() => { strombrott.oppnaStrom(); handelseLogg.push(`${strombrott.nick} tillbaka`); }, 6000);
    }
    if (tystnad && !tystnad.brutet && tystnad.vy?.battleNumber >= 2 && iMatch(tystnad)) {
      tystnad.brutet = true;
      tystnad.tyst = true;
      handelseLogg.push(`${tystnad.nick} slutade svara på ping`);
      setTimeout(() => { tystnad.tyst = false; tystnad.stangStrom(); tystnad.oppnaStrom(); handelseLogg.push(`${tystnad.nick} tillbaka`); }, 24_000);   // servern märker tystnaden efter 15–20 s
    }
    await vanta(250);
  }
})();

/* ---- 3. Matcherna spelas till slut ---- */
const tMatch = performance.now();
const deadline = Date.now() + 25 * 60_000;
let senastLage = 0;
const klara = new Set();
while (Date.now() < deadline && klara.size < grupper.length) {
  await vanta(2000);
  await Promise.all(grupper.map(async (g, m) => { if (klara.has(m)) return; const k = g.find(x => !x.lamnat) ?? g[0]; if ((await k.anrop('/api/match')).data?.view?.phase === 'AVSLUTAD') klara.add(m); }));
  if (Date.now() - senastLage > 30_000) { senastLage = Date.now(); console.log(`LÄGE ${Math.round((performance.now() - tMatch) / 1000)} s:`, grupper.map(g => `${g[0].nick.split('-')[0]}:${g[0].vy?.phase?.slice(0, 4)}/${g[0].vy?.battleNumber}`).join(' '), `| ovantade strömslut ${strombrott_ovantade.length}`); }
}
const matchTid = performance.now() - tMatch;
await vanta(1500);
const slut = await Promise.all(rum.map(async (r, m) => { const k = grupper[m].find(x => !x.lamnat) ?? grupper[m][0]; return (await k.anrop('/api/match')).data; }));
check(`alla ${rum.length} matcher spelades till slut`, slut.every(s => s?.view?.phase === 'AVSLUTAD'), slut.map(s => `${s?.view?.phase}/${s?.status}`).join(', '));
for (const g of avhopp) {
  const s = slut[grupper.indexOf(g)];
  check(`ojämna lag (${g[0].nick}: 1 mot 4) spelades till slut`, s?.view?.phase === 'AVSLUTAD' && g.filter((k, i) => i % 2 === 0 && k.lamnat).length === 3, `vinnare ${s?.view?.winnerTeam}`);
}
const sagsSomBorta = k => saAvbrott.has(`${k.matchId}|${k.id}`);
if (strombrott) check(`strömavbrottet (${strombrott.nick}): de andra såg avbrottet, han kom tillbaka och matchen avslutades`, strombrott.brutet && sagsSomBorta(strombrott) && Boolean(strombrott.strom) && slut[grupper.findIndex(g => g.includes(strombrott))]?.view?.phase === 'AVSLUTAD');
if (tystnad) check(`det tysta avbrottet (${tystnad.nick}): upptäckt av servern, tillbaka och matchen avslutad`, tystnad.brutet && sagsSomBorta(tystnad) && Boolean(tystnad.strom) && slut[grupper.findIndex(g => g.includes(tystnad))]?.view?.phase === 'AVSLUTAD');

/* Leveranserna: inget godkänt drag får vänta kvar, och alla som är anslutna har fått matchens sista händelse. */
for (let i = 0; i < 25 && vantande.length; i++) await vanta(200);
const saknade = vantande.map(w => `${[...w.kvar].map(k => k.nick).join('/')} saknar händelse ${w.eventId} i ${w.matchId.slice(-4)} (${Math.round((performance.now() - w.skickat) / 1000)} s)`);
check('varje godkänt drag nådde alla anslutna i matchen (inga utskick väntar kvar)', saknade.length === 0 && utskickRakning.godkanda === utskickRakning.levererade + utskickRakning.slappta + vantande.length,
  `${utskickRakning.godkanda} godkända: ${utskickRakning.levererade} levererade, ${utskickRakning.slappta} släppta, ${vantande.length} saknas${saknade.length ? ' – ' + saknade.slice(0, 3).join(' | ') : ''}`);
const utanSista = grupper.flatMap((g, m) => g.filter(k => !k.lamnat && k.strom && k.vy?.lastEventId !== slut[m]?.view?.lastEventId).map(k => `${k.nick} har ${k.vy?.lastEventId}, matchen ${slut[m]?.view?.lastEventId}`));
check('alla anslutna fick matchens sista händelse över strömmen', utanSista.length === 0, utanSista.slice(0, 4).join(' | '));

/* ---- 4. Tillbaka till lobbyn ---- */
await Promise.all(alla.map((k, i) => k.kommando('LÄMNA', { roomId: rum[grupper.findIndex(g => g.includes(k))].roomId })));
await vanta(800);
const lobbyEfter = (await alla[0].anrop('/api/lobby')).data;
check('alla är tillbaka i lobbyn som lediga', lobbyEfter.players.length === alla.length && lobbyEfter.players.every(p => p.activity === 'LEDIG'), `${lobbyEfter.players.filter(p => p.activity !== 'LEDIG').length} inte lediga`);

/* ---- Mätning mot kapacitetsmålet ---- */
sampla();
const cpu = resurser.map(r => r.cpu).filter(Number.isFinite), rss = resurser.map(r => r.rss);
const minneVerifierat = rss.length >= 10 && matfel.length === 0;
const matt = {
  matcher: rum.length, anslutningar: alla.length, tankeMs: [TANKE_MIN, TANKE_MAX],
  lobbyMs: Math.round(lobbyTid), matchMs: Math.round(matchTid), totalMs: Math.round(performance.now() - start),
  kommandon: { lobby: latens.lobby.length, match: latens.match.length },
  matchKommandoMs: { p50: percentil(latens.match, 50), p95: percentil(latens.match, 95), p99: percentil(latens.match, 99), max: percentil(latens.match, 100) },
  lobbyKommandoMs: { p50: percentil(latens.lobby, 50), p95: percentil(latens.lobby, 95), max: percentil(latens.lobby, 100) },
  utskickMs: { antal: utskick.length, p50: percentil(utskick, 50), p95: percentil(utskick, 95), max: percentil(utskick, 100), ...utskickRakning, saknade: vantande.length },
  matning: { satt: MATNING, prov: rss.length, fel: matfel.length, forstaFel: matfel.find(Boolean) ?? null },
  cpuProcent: cpu.length ? { medel: Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length), max: Math.round(Math.max(...cpu)) } : null,
  minneMB: rss.length ? { max: Math.round(Math.max(...rss)), slut: Math.round(rss.at(-1)) } : null,
  livsteckenMs: { p95: percentil(livsteckenMs, 95), max: percentil(livsteckenMs, 100) },
  statuskoder: Object.fromEntries(statuskoder), avvisningar: Object.fromEntries(avvisningar), handelser: handelseLogg, ovantadeStromslut: strombrott_ovantade
};
console.log('MÄTNING', JSON.stringify(matt, null, 2));
check('kapacitetsmålet täcks av körningen (matcher och anslutningar)', rum.length >= MAL.matcher && alla.length >= MAL.anslutningar || STORLEKAR.join() !== '8,8,8,8,8,8,8,8,8,8', `${rum.length} matcher, ${alla.length} anslutningar`);
check(`matchkommandon: p95 ≤ ${MAL.p95KommandoMs} ms och max ≤ ${MAL.maxKommandoMs} ms`, matt.matchKommandoMs.p95 <= MAL.p95KommandoMs && matt.matchKommandoMs.max <= MAL.maxKommandoMs, JSON.stringify(matt.matchKommandoMs));
check(`utskick till hela matchen: p95 ≤ ${MAL.p95UtskickMs} ms och max ≤ ${MAL.maxUtskickMs} ms`, matt.utskickMs.p95 !== null && matt.utskickMs.p95 <= MAL.p95UtskickMs && matt.utskickMs.max <= MAL.maxUtskickMs, JSON.stringify(matt.utskickMs));
check(`serverns minne ≤ ${MAL.maxMinneMB} MB`, minneVerifierat && matt.minneMB.max <= MAL.maxMinneMB,
  minneVerifierat ? `${matt.minneMB.max} MB, CPU medel ${matt.cpuProcent?.medel} %, max ${matt.cpuProcent?.max} % (${MATNING}, ${rss.length} prov)`
    : `EJ VERIFIERAT – ${rss.length} mätvärden, ${matfel.length} misslyckade prov (${matt.matning.forstaFel ?? 'inga prov'})`);
check('inga strömmar stängdes av servern utöver de avsiktliga avbrotten', strombrott_ovantade.filter(t => !t.startsWith(tystnad?.nick ?? '-')).length === 0, strombrott_ovantade.slice(0, 4).join(' | '));
check('inga serverfel (5xx) under belastningen', ![...statuskoder.keys()].some(k => k >= 500), JSON.stringify(matt.statuskoder));
const ovantade = [...avvisningar].filter(([text]) => !/ändrats|inte din tur|redan|väntar|bekräfta|Fortsätt först|inte tillåt|gått vidare|kan inte/i.test(text));
check('inga oväntade avvisningar (bara krockar mellan samtidiga val)', ovantade.length === 0, JSON.stringify(Object.fromEntries(avvisningar)));
check('inga hemligheter, andras händer, andra matchers kort eller dubbla händelser i någon vy, ström eller svar', brister.length === 0, brister.slice(0, 5).join(' | '));

/* ---- 5. Missbruk och gränser ---- */
const statiska = ['/online/server.js', '/online/lagring.js', '/online/session.js', '/package.json', '/deploy.sh', '/.git/config', '/.git/HEAD', '/KONTRAKT.md', '/arbetsordning%20lobby.md',
  '/node_modules/playwright/package.json', '/scripts/prova-belastning.mjs', '/match.test.js', '/online/server.test.js', '/apache/tornstriden.conf', '/teststod.js',
  '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc%2fpasswd', '/online%2fserver.js', '/assets/../online/server.js', '/assets/%2e%2e/package.json', '/assets/.hemlig.png', '/data/tornstriden.sqlite', '/tornstriden.sqlite'];
const statSvar = await Promise.all(statiska.map(async p => [p, (await fetch(base + p)).status]));
check('serverkod, tester, git, databas och dokument kan inte hämtas', statSvar.every(([, s]) => s === 404 || s === 403 || s === 400), statSvar.filter(([, s]) => ![400, 403, 404].includes(s)).map(([p, s]) => `${p} ${s}`).join(', '));
const klientfiler = ['/match.html', '/lagmatch.html', '/lobby.html', '/ljud.js', '/lagmatchvy.js', '/onlinematch.js', '/kontrakt.js'];
check('klientfilerna går att hämta', (await Promise.all(klientfiler.map(async p => (await fetch(base + p)).status))).every(s => s === 200));
check('databasen ligger utanför webbroten', existsSync(join(OUT, 'data', 'tornstriden.sqlite')) && !join(OUT, 'data').startsWith(ROOT));

const [ada, ben, utom] = ['Ada-L20', 'Ben-L20', 'Utom-L20'].map(n => new Klient(n, { bot: false }));
for (const k of [ada, ben, utom]) { await k.gaIn(); k.oppnaStrom(); }
await vanta(500);
await ada.kommando('SKAPA_RUM');
const roomId = (await ada.anrop('/api/lobby')).data.rum.id;
await vanta(1100);   // högst ett inbjudningskommando per sekund
await ada.kommando('BJUD_IN', { roomId, payload: { playerIds: [ben.id] } });
await ben.kommando('ACCEPTERA', { payload: { invitationId: (await ben.anrop('/api/lobby')).data.inbjudningar.inkommande[0].id } });
await ada.kommando('VÄLJ_LAG', { roomId, payload: { teamId: 'A' } });
await ben.kommando('VÄLJ_LAG', { roomId, payload: { teamId: 'B' } });
const rv = (await ada.anrop('/api/lobby')).data.rum.rosterVersion;
for (const k of [ada, ben]) await k.kommando('REDO', { roomId, payload: { ready: true, rosterVersion: rv } });
await ada.kommando('STARTA', { roomId, payload: { rosterVersion: rv } });
const duell = (await ada.anrop('/api/match')).data.view;
const post = (k, body, headers = {}) => fetch(`${base}/api/kommando`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie: k.cookie, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const giltigt = { protocolVersion: PROTOCOL_VERSION, commandId: 'miss-1', type: 'BEKRÄFTA_BYTE', matchId: duell.matchId, revision: duell.revision, payload: { cards: [] } };
check('främmande ursprung avvisas (403)', (await post(ada, giltigt, { origin: 'https://annan.example' })).status === 403);
check('utan session avvisas (401)', (await fetch(`${base}/api/kommando`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(giltigt) })).status === 401);
check('för stort kommando avvisas (413)', (await post(ada, { ...giltigt, payload: { fyll: 'x'.repeat(4000) } })).status === 413);
check('ogiltig JSON avvisas (400)', (await post(ada, '{"protocolVersion":')).status === 400);
check('påstådd identitet, lag och liv avvisas (400)', (await Promise.all([{ playerId: ben.id }, { teamId: 'B' }, { life: 3 }].map(async extra => (await post(ada, { ...giltigt, commandId: 'miss-id', ...extra })).status))).every(s => s === 400));
const okand = await post(ada, { ...giltigt, commandId: 'miss-typ', type: 'VINN_MATCHEN' });
check('okänd kommandotyp avvisas (400)', okand.status === 400);
const fore = (await ben.anrop('/api/match')).data.view.revision;
const fram = await utom.kommando('BEKRÄFTA_BYTE', { matchId: duell.matchId, revision: duell.revision, payload: { cards: [] } });
check('ett drag i någon annans match avvisas och ändrar inget', fram.data.status === 'AVVISAD' && (await ben.anrop('/api/match')).data.view.revision === fore, fram.data.message);
const forsta = await (await post(ada, giltigt)).json();
const igen = await (await post(ada, { ...giltigt, payload: { cards: duell.me.hand.slice(0, 1).map(c => c.instanceId) } })).json();
check('samma commandId med annat innehåll avvisas; första draget gäller', forsta.status === 'GODKÄND' && igen.status === 'AVVISAD', igen.message);
const t0 = performance.now();
const skur = await Promise.all(Array.from({ length: 200 }, (_, i) => post(ben, { ...giltigt, commandId: `skur-${i}`, revision: 0 }).then(r => r.json())));
const skurMs = performance.now() - t0;
const efterSkur = (await ben.anrop('/api/match')).data.view;
check('en skur av 200 gamla drag avvisas utan effekt och servern svarar fortfarande', skur.every(s => s.status === 'AVVISAD') && efterSkur.revision === forsta.revision, `${Math.round(skurMs)} ms för skuren`);
const giltigtEfter = await ben.kommando('BEKRÄFTA_BYTE', { matchId: duell.matchId, revision: efterSkur.revision, payload: { cards: [] } });
check('ett giltigt drag direkt efter skuren går igenom', giltigtEfter.data.status === 'GODKÄND', `${Math.round(giltigtEfter.ms)} ms`);
/* En bekräftelse ger ett nytt händelse-ID men samma revision. Den ska nå båda strömmarna direkt, utan att något
   annat drag behövs för att föra fram den (ett utskick som väntar på nästa händelse syns här). */
for (let i = 0; i < 12; i++) {
  const vyer = await Promise.all([ada, ben].map(async k => [k, (await k.anrop('/api/match')).data.view]));
  if (vyer.every(([, v]) => v.allowed.some(a => a.type === 'BEKRÄFTA_START'))) break;
  for (const [k, v] of vyer) if (v.allowed.some(a => a.type === 'BEKRÄFTA_BYTE')) await k.kommando('BEKRÄFTA_BYTE', { matchId: v.matchId, revision: v.revision, payload: { cards: [] } });
}
await vanta(300);
const foreBekraftelse = { ada: ada.vy?.lastEventId, ben: ben.vy?.lastEventId, revision: ben.vy?.revision };
const startVy = (await ada.anrop('/api/match')).data.view;
const bekraftelse = await ada.kommando('BEKRÄFTA_START', { matchId: startVy.matchId, revision: startVy.revision });
const nadde = async k => { for (let i = 0; i < 50 && !((k.vy?.lastEventId ?? 0) >= bekraftelse.data.eventId); i++) await vanta(20); return (k.vy?.lastEventId ?? 0) >= bekraftelse.data.eventId; };
const naddeBada = await Promise.all([ada, ben].map(nadde));
check('en bekräftelse (nytt händelse-ID, samma revision) når båda strömmarna inom 1 s utan att något annat händer',
  bekraftelse.data.status === 'GODKÄND' && bekraftelse.data.revision === foreBekraftelse.revision && naddeBada.every(Boolean),
  `${bekraftelse.data.status}, händelse ${foreBekraftelse.ben} → ${bekraftelse.data.eventId}, revision ${foreBekraftelse.revision} → ${bekraftelse.data.revision}; Ada ${ada.vy?.lastEventId}, Ben ${ben.vy?.lastEventId}`);
check('någon annans kvittens går inte att läsa', (await ben.anrop(`/api/status?commandId=miss-1&scope=${encodeURIComponent(`match:${duell.matchId}`)}`)).data.status === 'OKÄND');
/* Flera strömmar för samma session: den senaste tar över, de äldre stängs. */
const extra = [];
for (let i = 0; i < 4; i++) { const svar = await fetch(`${base}/api/handelser`, { headers: { cookie: ada.cookie } }); extra.push(svar); await vanta(150); }
const oppna = await Promise.all(extra.slice(0, 3).map(async s => { const r = s.body.getReader(); let text = ''; const slutTid = Date.now() + 1500; while (Date.now() < slutTid) { const { value, done } = await Promise.race([r.read(), vanta(300).then(() => ({}))]); if (done) return { ersatt: /event: ersatt/.test(text), stangd: true }; if (value) text += new TextDecoder().decode(value); } return { ersatt: /event: ersatt/.test(text), stangd: false }; }));
check('flera strömmar för samma session: de äldre får "ersatt" och stängs', oppna.every(o => o.ersatt && o.stangd), JSON.stringify(oppna));
extra.at(-1).body.cancel().catch(() => {});
/* Taket för antalet sessioner (MAX_SESSIONS = 200). */
const fler = [];
let tak = null;
for (let i = 0; i < 250 && !tak; i++) { const k = new Klient(`Fyll${i}`, { bot: false }); const s = await k.anrop('/api/session', { method: 'POST', body: { nick: k.nick } }); if (s.status === 503) tak = s; else fler.push(k); }
check('lobbyn tar emot högst 200 sessioner, sedan 503 med begripligt besked', tak?.status === 503 && /full/i.test(tak.data.message), `${alla.length + 3 + fler.length} sessioner innan taket`);

clearInterval(samplare);
for (const k of [...alla, ada, ben, utom]) k.stangStrom();
stoppat = true;
server.kill('SIGTERM');
await vanta(500);
check('serverloggen saknar sessionstoken och kakor', !/tornstriden_session=|[0-9a-f]{64}/.test(serverlogg));
writeFileSync(join(OUT, 'resultat.json'), JSON.stringify({ storlekar: STORLEKAR, mal: MAL, matt, kontroller: results, brister }, null, 2));
const fail = results.filter(r => !r.ok);
console.log(`\n${results.length - fail.length}/${results.length} kontroller OK (${join(OUT, 'resultat.json')})`);
process.exit(fail.length ? 1 : 0);
