/* Serverstyrd lagmatch (arbetsordning L14): lagmotorn (lagmatch.js, lag-v1) körs på servern för rum med
   4, 6 eller 8 deltagare. Starttransaktionen låser regel- och kortleksversion, medlemskap och lag:
   rummets ordning blir lagens fasta ordning, och motorns spelar-ID är sessionernas spelar-ID. Identiteten
   kommer alltid från sessionen; klienten anger bara matchId, revision och sina val.

   Samma kö, transaktion och kvittenshantering som duellen (tjanst.js): ett godkänt kommando sparar motorläge,
   händelser och kvittens tillsammans. Avvisning lämnar matchen orörd; ett motorfel rullar tillbaka allt och
   ger ingen vinnare. Ingen spelregel finns här – allt avgörs av lagmotorn.

   Samtidiga val: under startbyten och bekräftelser väljer flera spelare samtidigt utifrån samma vy. Byte,
   start- och Fortsätt-bekräftelse godtas därför med en revision från den pågående samlingen (samlingFran),
   inte bara den allra senaste. Lämna (GE_UPP) godtas med vilken tidigare revision som helst. Övriga val
   (mål, kort, avstående) kräver exakt revision. En upprepad bekräftelse är ofarlig.

   Utslagna (liv eller Lämna) blir FÖLJER_AVSLUT: de ser fortfarande den offentliga vyn men har inga val,
   och kan gå till lobbyn med LÄMNA utan att matchen påverkas.

   Spelarklockor (L16, klockor.js): den som har ett val enligt motorns allowedActions har en klocka. Ett
   kommando som tas emot på eller efter spelarens deadline avvisas; när timern går ut slås alla vars tid
   gått ut ut tillsammans med slaUt (orsak TIDSGRÄNS). Slutar matchen utan levande lag blir den AVBRUTEN
   utan vinnare (huvudplan §10). */
import { newLagmatch, processLag, slaUt, allowedActions, LAG_FAS, LAG_HANDLING, UTSLAG, STATUS } from '../lagmatch.js';
import { isAlive } from '../lagkortlek.js';
import { lagVy, lagHandelser, LAG_FORMAT } from '../lagvy.js';
import { ACTIVITY, CONNECTION, MATCH_STATUS, RECEIPT } from '../kontrakt.js';
import { uppdateraKlockor, utgangna, forSent, TIDEN_UTE } from './klockor.js';

export { LAG_FORMAT };
const SAMLING = new Set([LAG_HANDLING.swap, LAG_HANDLING.confirmStart, LAG_HANDLING.next]);
const BEKRAFTELSER = new Set([LAG_HANDLING.confirmStart, LAG_HANDLING.next]);
const ANDRAT = 'Matchläget har ändrats – försök igen.';

/* Nyckel för en pågående samling där flera väljer samtidigt; null när en spelare åt gången väljer. */
export const samlingsnyckel = m => [LAG_FAS.swap, LAG_FAS.start, LAG_FAS.result].includes(m.phase) ? `${m.phase}:${m.swapRound}:${m.battleNumber}` : null;

/* Vilka spelare servern väntar på och vilket val det gäller (nyckeln byts när valet är ett nytt). */
export function kravLag(m) {
  const krav = {};
  for (const p of m.players) {
    if (!allowedActions(m, p.id).length) continue;
    krav[p.id] = samlingsnyckel(m) ?? `${m.phase}:${m.battleNumber}:${m.battle?.attackingTeam}:${m.battle?.turns.length ?? 0}`;
  }
  return krav;
}
const slutstatus = m => m.phase !== LAG_FAS.over ? MATCH_STATUS.active : m.winnerTeam ? MATCH_STATUS.finished : MATCH_STATUS.aborted;

export function skapaLagspel({ lagring, klocka, rum }) {
  const now = () => klocka.now();
  const avvisa = (message, revision = null) => ({ status: RECEIPT.rejected, message, revision });

  /* ---- Motorfabrik för rummets start: skapar matchen i starttransaktionen ---- */
  function fabrik({ ops, room, players, slump }) {
    const engine = newLagmatch({ matchId: `m-${room.id.slice(2)}`, players: players.map(p => ({ id: p.playerId, name: p.nick, teamId: p.teamId })), random: slump });
    const post = { id: engine.id, format: LAG_FORMAT, revision: engine.revision, rulesVersion: engine.rulesVersion, deckVersion: engine.deckVersion, roomId: room.id, engine, lastEventId: 0, samlingFran: engine.revision, klockor: uppdateraKlockor({}, kravLag(engine), now()), createdAt: now() };
    ops.sparaMatch(post, MATCH_STATUS.active);
    return { matchId: post.id, rulesVersion: post.rulesVersion, deckVersion: post.deckVersion };
  }

  function revisionsfel(post, command) {
    const current = post.engine.revision;
    if (!Number.isInteger(command.revision) || command.revision > current) return ANDRAT;
    if (command.type === LAG_HANDLING.leave) return null;
    if (SAMLING.has(command.type) && samlingsnyckel(post.engine) !== null && command.revision >= post.samlingFran) return null;
    return command.revision === current ? null : ANDRAT;
  }

  /* Kommando enligt kontraktet -> lagmotorns handling. Spelaren kommer från sessionen. */
  const handling = (engine, playerId, { type, payload = {} }) => ({
    matchId: engine.id, revision: engine.revision, type, playerId,
    cards: payload.cards, target: payload.targetPlayerId, card: payload.instanceId, usage: payload.usage,
    targetCard: payload.targetInstanceId ?? null, targetPlayer: type === LAG_HANDLING.defend ? payload.targetPlayerId ?? null : null
  });

  function hantera({ playerId, command, ops, slump, mottagen = now() }) {
    const rad = ops.hamtaMatch(command.matchId);
    if (!rad) return avvisa('Matchen finns inte.');
    const post = rad.match;
    const session = ops.hamtaSession(playerId);
    if (session?.matchId !== post.id || !post.engine.players.some(p => p.id === playerId)) return avvisa('Du deltar inte i den här matchen.');
    /* Den vars tid gick ut strax före kommandot är redan utslagen (tidsgränsen behandlas före kommandot) och får veta varför. */
    if (post.engine.players.find(p => p.id === playerId)?.eliminationReason === UTSLAG.timeout) return avvisa(TIDEN_UTE, post.engine.revision);
    if (rad.status !== MATCH_STATUS.active) return avvisa(rad.status === MATCH_STATUS.aborted ? 'Matchen avbröts. Gå till lobbyn.' : 'Matchen är avslutad. Gå till lobbyn.', post.engine.revision);
    if (forSent(post.klockor, playerId, mottagen)) return avvisa(TIDEN_UTE, post.engine.revision);
    const before = post.engine;
    const fel = revisionsfel(post, command);
    if (fel) return avvisa(fel, before.revision);
    if (BEKRAFTELSER.has(command.type) && before.confirm?.kind === command.type && before.confirm.by[playerId]) return { status: RECEIPT.ok, revision: before.revision, eventId: post.lastEventId };
    const action = handling(before, playerId, command);
    const reply = processLag(before, action, slump);
    if (reply.status === STATUS.rejected) return avvisa(reply.message, before.revision);
    if (reply.status !== STATUS.ok) throw new Error(`Lagmotorfel: ${reply.message}`);   // rullar tillbaka allt; ingen falsk vinst
    spara(ops, post, reply, action);
    return { status: RECEIPT.ok, revision: post.engine.revision, eventId: post.lastEventId };
  }

  /* Ett godkänt motorsteg (spelarens val eller en tidsgräns) sparas med händelser, klockor och sessioner. */
  function spara(ops, post, reply, action) {
    const before = post.engine;
    const after = reply.match;
    const events = lagHandelser({ before, after, replyEvents: reply.events, action, nextEventId: post.lastEventId + 1, at: now() });
    if (samlingsnyckel(after) !== samlingsnyckel(before)) post.samlingFran = after.revision;
    post.engine = after;
    post.revision = after.revision;
    post.lastEventId += events.length;
    post.klockor = uppdateraKlockor(post.klockor, kravLag(after), now());
    const status = slutstatus(after);
    ops.sparaMatch(post, status);
    ops.sparaHandelser(events);
    /* Nyss utslagna följer matchen utan val och kan gå till lobbyn. */
    for (const p of after.players) {
      if (isAlive(p) || !isAlive(before.players.find(q => q.id === p.id))) continue;
      const s = ops.hamtaSession(p.id);
      if (s?.matchId === post.id && s.activity === ACTIVITY.playing) ops.sparaSession({ ...s, activity: ACTIVITY.finished });
    }
    if (status !== MATCH_STATUS.active) rum.markeraMatchAvslutad(ops, post.roomId);
  }

  /* Timern (klockor.js) i matchens kö: alla vars tid gått ut vid `tid` slås ut i samma händelse, så att
     timerordningen aldrig avgör vinnaren. En sen eller dubbel timer hittar inget utgånget krav. */
  function tidsgrans({ ops, matchId, now: tid, slump }) {
    const rad = ops.hamtaMatch(matchId);
    if (!rad || rad.status !== MATCH_STATUS.active || rad.match.format !== LAG_FORMAT) return false;
    const post = rad.match;
    const ute = utgangna(post.klockor, tid).filter(id => isAlive(post.engine.players.find(p => p.id === id)));
    if (!ute.length) return false;
    const reply = slaUt(post.engine, ute, UTSLAG.timeout, slump);
    if (reply.status === STATUS.rejected) return false;
    if (reply.status !== STATUS.ok) throw new Error(`Lagmotorfel vid tidsgräns: ${reply.message}`);
    spara(ops, post, reply, { type: UTSLAG.timeout, playerId: null, players: ute });
    return true;
  }

  /* Vy och händelser för en deltagare (sidladdning, återanslutning och utskick efter kommandon). */
  function matchFor(playerId, { efterEventId = null } = {}) {
    const session = lagring.hamtaSession(playerId);
    if (!session?.matchId) return null;
    const rad = lagring.hamtaMatch(session.matchId);
    if (!rad || rad.match.format !== LAG_FORMAT) return null;
    const post = rad.match;
    const anslutning = Object.fromEntries(post.engine.players.map(p => [p.id, lagring.hamtaSession(p.id)?.connection ?? CONNECTION.offline]));
    const view = lagVy(post.engine, playerId, { lastEventId: post.lastEventId, anslutning, matchStatus: rad.status, klockor: post.klockor ?? null, serverTid: now() });
    if (!view) return null;
    const events = efterEventId === null ? [] : lagring.hamtaHandelser(post.id, efterEventId).filter(e => e.recipient === null || e.recipient === playerId);
    return { view, events, status: rad.status };
  }

  return { fabrik, hantera, tidsgrans, matchFor };
}
