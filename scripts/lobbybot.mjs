#!/usr/bin/env node
/* Lobbybot: en motståndare att öva mot online. Går in i lobbyn med ett nick, accepterar inbjudningar, väljer det lag
   som behöver fyllas, trycker Redo och spelar sedan matchen med slumpade giltiga drag (samma val som testklienterna
   i scripts/prova-belastning.mjs). Efter matchslut lämnar den rummet och väntar på nästa inbjudan.
     node scripts/lobbybot.mjs [--nick Claude2] [--bas http://127.0.0.1:8766] [--origin https://tornstriden.landychev.se]
   På servern körs den direkt mot tjänsten (bas 127.0.0.1:8766); Origin måste vara spelets adress eller stämma med
   Host, annars avvisas kommandona (403). Ctrl+C lämnar lobbyn snyggt. Ingen spelkod ändras; boten är bara en klient. */
import { PROTOCOL_VERSION, LOBBY_COMMAND, MATCH_STATUS, ACTIVITY, TEAM_IDS, ROOM } from '../kontrakt.js';

const arg = (namn, standard) => { const i = process.argv.indexOf(`--${namn}`); return i === -1 ? standard : process.argv[i + 1]; };
const NICK = arg('nick', 'Claude2');
const BAS = arg('bas', 'http://127.0.0.1:8766').replace(/\/$/, '');
const ORIGIN = arg('origin', process.env.TORNSTRIDEN_ORIGINS?.split(',')[0]?.trim() || BAS);
const TANKE = [800, 2500];   // ms "betänketid" per drag
const logg = (...t) => console.log(new Date().toISOString().slice(11, 19), ...t);
const vanta = ms => new Promise(r => setTimeout(r, ms));
const pick = lista => lista[Math.floor(Math.random() * lista.length)];

let cookie = null, me = null, lobby = null, vy = null, matchStatus = null, agerar = false, nr = 0, slut = false;

async function anrop(path, { method = 'GET', body } = {}) {
  const svar = await fetch(BAS + path, { method, headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const satt = svar.headers.get('set-cookie');
  if (satt) cookie = satt.split(';')[0];
  const text = await svar.text();
  return { status: svar.status, data: text ? JSON.parse(text) : null };
}
const kommando = (type, extra = {}) => anrop('/api/kommando', { method: 'POST', body: { protocolVersion: PROTOCOL_VERSION, commandId: `bot-${process.pid}-${++nr}`, type, payload: {}, ...extra } });

/* Ett drag ur vyn: byt 0–2 kort, välj mål, spela eller avstå, bekräfta. Aldrig Ge upp. */
function val(view) {
  const valbara = view.allowed.filter(a => a.type !== 'GE_UPP');
  if (!valbara.length) return null;
  const a = pick(valbara);
  if (a.type === 'BEKRÄFTA_BYTE') return { type: a.type, payload: { cards: a.cards.slice(0, Math.floor(Math.random() * 3)).map(c => c.instanceId) } };
  if (a.type === 'VÄLJ_MÅL') return { type: a.type, payload: { targetPlayerId: pick(a.players) } };
  if (a.type === 'SPELA_ATTACK') return a.normal.length ? { type: a.type, payload: { instanceId: pick(a.normal).instanceId } } : { type: a.type, payload: { instanceId: pick(a.simple).instanceId, usage: 'simple' } };
  if (a.type === 'SPELA_FÖRSVAR') {
    if (!a.cards.length || Math.random() < 0.3) return { type: 'AVSTÅ_FÖRSVAR', payload: {} };
    const c = pick(a.cards);
    return { type: a.type, payload: { instanceId: c.instanceId, ...(c.cardTargets?.length ? { targetInstanceId: pick(c.cardTargets) } : {}), ...(c.playerTargets?.length ? { targetPlayerId: pick(c.playerTargets) } : {}) } };
  }
  return { type: a.type, payload: {} };
}

/* Lobbyn: acceptera inbjudan, fyll laget som har färre, tryck Redo när rummet ändrats. */
async function lobbysteg() {
  if (!lobby || agerar) return;
  agerar = true;
  try {
    const inbjudan = lobby.inbjudningar?.inkommande?.[0];
    if (!lobby.rum && inbjudan) {
      const s = await kommando(LOBBY_COMMAND.accept, { payload: { invitationId: inbjudan.id } });
      logg(`inbjudan från ${inbjudan.from?.nick ?? '?'}: ${s.data?.status} ${s.data?.message ?? ''}`);
      return;
    }
    const rum = lobby.rum;
    if (!rum) return;
    const jag = rum.players.find(p => p.playerId === me.playerId);
    if (!jag) return;
    if (lobby.me.activity === ACTIVITY.finished || rum.status === ROOM.closed) {   // matchen är slut: tillbaka till lobbyn
      const s = await kommando(LOBBY_COMMAND.leave, { roomId: rum.id });
      logg(`lämnar rummet: ${s.data?.status}`);
      vy = null; matchStatus = null;
      return;
    }
    if (rum.status !== ROOM.preparing) return;
    /* Laget: fyll den sida där de andra är färre, så att lagen blir jämna. Har ingen annan valt ännu väntar boten –
       värden väljer först. Byter om de andra flyttar på sig. */
    const andra = Object.fromEntries(TEAM_IDS.map(id => [id, rum.players.filter(p => p.playerId !== me.playerId && p.teamId === id).length]));
    const onskat = andra.A > andra.B ? 'B' : andra.A < andra.B ? 'A' : null;
    if (onskat === null) { if (jag.teamId !== null) return; logg('väntar på att någon annan väljer lag'); return; }
    if (jag.teamId !== onskat) {
      const s = await kommando(LOBBY_COMMAND.team, { roomId: rum.id, payload: { teamId: onskat } });
      logg(`väljer lag ${onskat}: ${s.data?.status}`);
      return;
    }
    if (!(jag.ready && jag.readyRosterVersion === rum.rosterVersion)) {
      const s = await kommando(LOBBY_COMMAND.ready, { roomId: rum.id, payload: { ready: true, rosterVersion: rum.rosterVersion } });
      logg(`redo: ${s.data?.status}`);
    }
  } catch (e) { logg(`lobbyfel: ${e.message}`); } finally { agerar = false; }
}

async function matchsteg() {
  if (!vy || agerar || slut) return;
  if (!vy.allowed?.some(a => a.type !== 'GE_UPP')) return;
  agerar = true;
  const v = vy;
  try {
    await vanta(TANKE[0] + Math.random() * (TANKE[1] - TANKE[0]));
    if (vy !== v) return;   // ny vy hann komma
    const drag = val(v);
    if (!drag) return;
    const s = await kommando(drag.type, { matchId: v.matchId, revision: v.revision, payload: drag.payload });
    logg(`${drag.type} (strid ${v.battleNumber ?? '-'}): ${s.data?.status}${s.data?.status !== 'GODKÄND' ? ' – ' + s.data?.message : ''}`);
  } catch (e) { logg(`dragfel: ${e.message}`); } finally { agerar = false; if (vy !== v) void matchsteg(); }
}

async function strom() {
  const kontroll = new AbortController();
  const stang = () => kontroll.abort();
  process.once('SIGINT', stang); process.once('SIGTERM', stang);
  try {
    const svar = await fetch(`${BAS}/api/handelser`, { headers: { cookie, origin: ORIGIN }, signal: kontroll.signal });
    if (svar.status !== 200) { logg(`strömmen gav ${svar.status}`); return false; }
    const reader = svar.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const typ = /^event: (.+)$/m.exec(block)?.[1]; const data = /^data: (.+)$/m.exec(block)?.[1];
        if (!typ || !data) continue;
        const d = JSON.parse(data);
        if (typ === 'ping') { void anrop('/api/livstecken', { method: 'POST', body: d }).catch(() => {}); continue; }
        if (typ === 'halsa') { if (d.protocolVersion !== PROTOCOL_VERSION) { logg('fel protokollversion – uppdatera boten'); process.exit(1); } continue; }
        if (typ === 'ersatt') { logg('en annan flik tog över sessionen – avslutar'); process.exit(0); }
        if (typ === 'lobby') { lobby = d; void lobbysteg(); }
        if (typ === 'match') {
          if (d.status === MATCH_STATUS.finished || d.status === MATCH_STATUS.aborted) { if (matchStatus !== d.status) logg(`matchen är ${d.status.toLowerCase()}`); matchStatus = d.status; vy = null; void lobbysteg(); continue; }
          matchStatus = d.status; vy = d.view; void matchsteg();
        }
      }
    }
    return !kontroll.signal.aborted;
  } catch (e) {
    if (kontroll.signal.aborted) return false;   // Ctrl+C
    logg(`strömfel: ${e.message}`);
    return true;
  } finally { process.off('SIGINT', stang); process.off('SIGTERM', stang); }
}

const halsa = await anrop('/api/halsa');
if (halsa.status !== 200) { console.error(`Ingen tjänst på ${BAS}`); process.exit(1); }
const s = await anrop('/api/session', { method: 'POST', body: { nick: NICK } });
if (s.status >= 400) { console.error(`Kunde inte gå in i lobbyn: ${s.status} ${s.data?.message ?? ''}`); process.exit(1); }
me = s.data.me; lobby = s.data;
logg(`${NICK} är i lobbyn på ${BAS} (origin ${ORIGIN}). Bjud in mig! Ctrl+C lämnar.`);
await lobbysteg();
for (;;) {
  const igen = await strom();
  if (!igen) break;
  logg('strömmen stängdes – ansluter igen om 3 s'); await vanta(3000);
}
slut = true;
await anrop('/api/session', { method: 'DELETE' }).catch(() => {});
logg(`${NICK} lämnade lobbyn.`);
process.exit(0);
