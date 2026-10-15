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
   utan vinnare (huvudplan §10).

   Avbrott (L17, klockor.js): ett upptäckt avbrott hos en levande deltagare ger en frist; under den pausas bara
   den spelarens turklocka och de andra spelar vidare tills hens val behövs. Återkomst i tid återupptar klockan;
   slut på fristen ger utslagning (AVBROTT) i samma grupp som samtidiga tidsgränser. Händelserna AVBROTT och
   ÅTERANSLUTEN är offentliga, så att alla ser vem som saknas och hur länge. */
import { newLagmatch, processLag, slaUt, serveravbrott as serveravbrottMotor, allowedActions, LAG_FAS, LAG_HANDLING, LAG_SLUT, UTSLAG, STATUS } from '../lagmatch.js';
import { isAlive } from '../lagkortlek.js';
import { lagVy, lagHandelser, LAG_FORMAT, LAG_EVENT } from '../lagvy.js';
import { ACTIVITY, CONNECTION, MATCH_STATUS, RECEIPT } from '../kontrakt.js';
import { uppdateraKlockor, forSent, registreraAvbrott, avslutaAvbrott, utgangnaMedOrsak, skaVanta, gaUtUnderNaden, stadaAvbrott, TIDEN_UTE, ANSLUTNINGSHANDELSE, fristSlut, FOR_SENT_TILLBAKA } from './klockor.js';

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
    /* Den vars tid eller frist gick ut strax före kommandot är redan utslagen (det behandlas före kommandot) och får veta varför. */
    const orsak = post.engine.players.find(p => p.id === playerId)?.eliminationReason;
    if (orsak === UTSLAG.timeout) return avvisa(TIDEN_UTE, post.engine.revision);
    if (orsak === UTSLAG.disconnect) return avvisa('Du kom inte tillbaka i tid och är utslagen.', post.engine.revision);
    if (rad.status !== MATCH_STATUS.active) return avvisa(rad.status === MATCH_STATUS.aborted ? 'Matchen avbröts. Gå till lobbyn.' : 'Matchen är avslutad. Gå till lobbyn.', post.engine.revision);
    if (forSent(post.klockor, playerId, mottagen)) return avvisa(TIDEN_UTE, post.engine.revision);
    if (fristSlut(post, playerId, mottagen)) return avvisa(FOR_SENT_TILLBAKA, post.engine.revision);   // avgörandet kan vänta på andra, men platsen är förlorad
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
    const status = slutstatus(after);
    stadaAvbrott(post, after.players.filter(isAlive).map(p => p.id), status !== MATCH_STATUS.active);
    post.klockor = uppdateraKlockor(post.klockor, kravLag(after), now(), post.avbrott ?? {});
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

  const aktivPost = (ops, matchId) => {
    const rad = ops.hamtaMatch(matchId);
    return rad && rad.status === MATCH_STATUS.active && rad.match.format === LAG_FORMAT ? rad.match : null;
  };
  const levandeIds = post => post.engine.players.filter(isAlive).map(p => p.id);

  /* Timern (klockor.js) i matchens kö: alla vars turklocka eller avbrottsfrist gått ut vid `tid` slås ut i samma
     händelse, så att timerordningen aldrig avgör vinnaren. Är alla övriga levande frånkopplade väntar avgörandet
     på deras frister (26B). En sen eller dubbel timer hittar inget utgånget. */
  function tidsgrans({ ops, matchId, now: tid, slump }) {
    const post = aktivPost(ops, matchId);
    if (!post) return false;
    const levande = levandeIds(post);
    const ut = utgangnaMedOrsak(post, levande, tid, { tid: UTSLAG.timeout, avbrott: UTSLAG.disconnect });
    if (!Object.keys(ut).length || skaVanta(post, levande, ut)) return false;
    const reply = slaUt(post.engine, Object.keys(ut), ut, slump);
    if (reply.status === STATUS.rejected) return false;
    if (reply.status !== STATUS.ok) throw new Error(`Lagmotorfel vid tidsgräns: ${reply.message}`);
    spara(ops, post, reply, { type: 'TIDSGRÄNS', playerId: null, players: Object.keys(ut) });
    return true;
  }

  /* En händelse utan motorsteg (avbrott eller återkomst): revisionen är oförändrad, men vyn och händelserna ändras. */
  function sparaAnslutning(ops, post, type, data) {
    const event = { eventId: post.lastEventId + 1, matchId: post.id, revision: post.engine.revision, type, at: now(), data, recipient: null };
    post.lastEventId += 1;
    ops.sparaMatch(post, MATCH_STATUS.active);
    ops.sparaHandelser([event]);
  }

  /* Upptäckt avbrott för anslutningen `generation` (i matchens kö). En gammal generation – spelaren har redan
     anslutit igen – och utslagna ignoreras; samma avbrott ger ingen ny frist. */
  function avbrott({ ops, matchId, playerId, generation, now: tid, nad = 0 }) {
    const post = aktivPost(ops, matchId);
    if (!post || !levandeIds(post).includes(playerId)) return false;
    const session = ops.hamtaSession(playerId);
    if (session?.matchId !== post.id || session.connectionGeneration !== generation || session.connection !== CONNECTION.offline) return false;
    if (nad && !gaUtUnderNaden(post, playerId, tid, nad)) return false;   // nåden räcker: avbrottet registreras när den är slut
    const a = registreraAvbrott(post, playerId, generation, tid);
    if (!a) return false;
    sparaAnslutning(ops, post, ANSLUTNINGSHANDELSE.disconnected, { playerId, deadline: a.deadline });
    return true;
  }

  /* Återkomst med anslutningen `generation`, mottagen vid `tid`. För sent: inget ändras, fristkontrollen slår ut. */
  function ateranslutning({ ops, matchId, playerId, generation, now: tid }) {
    const post = aktivPost(ops, matchId);
    if (!post || !levandeIds(post).includes(playerId)) return false;
    if (ops.hamtaSession(playerId)?.connectionGeneration !== generation) return false;
    if (avslutaAvbrott(post, playerId, tid) !== 'återansluten') return false;
    sparaAnslutning(ops, post, ANSLUTNINGSHANDELSE.reconnected, { playerId });
    return true;
  }

  /* Serveromstart (L18, 27B): matchen avbryts utan vinnare i samma transaktion som sluthändelsen. Ingen
     utslagning, inga liv eller budgetavdrag; väntande val, klockor och avbrott avslutas, rummet stängs och
     deltagarna kan gå till lobbyn. Anropas bara för en match som fortfarande är PÅGÅR. */
  function serveravbrott({ ops, post }) {
    const text = 'Servern startades om – matchen avbröts utan vinnare.';
    const after = serveravbrottMotor(post.engine, text);
    const at = now();
    const events = [
      { eventId: post.lastEventId + 1, matchId: post.id, revision: after.revision, type: LAG_EVENT.matchOver, at, data: { winnerTeam: null, endReason: LAG_SLUT.serverAbort }, recipient: null },
      { eventId: post.lastEventId + 2, matchId: post.id, revision: after.revision, type: LAG_EVENT.log, at, data: { text }, recipient: null }
    ];
    Object.assign(post, { engine: after, revision: after.revision, klockor: {}, avbrott: {}, lastEventId: post.lastEventId + events.length });
    ops.sparaMatch(post, MATCH_STATUS.aborted);
    ops.sparaHandelser(events);
    rum.markeraMatchAvslutad(ops, post.roomId);
  }

  /* Vy och händelser för en deltagare (sidladdning, återanslutning och utskick efter kommandon). */
  function matchFor(playerId, { efterEventId = null } = {}) {
    const session = lagring.hamtaSession(playerId);
    if (!session?.matchId) return null;
    const rad = lagring.hamtaMatch(session.matchId);
    if (!rad || rad.match.format !== LAG_FORMAT) return null;
    const post = rad.match;
    /* Levande deltagare: frånkopplad bara under ett registrerat avbrott (en omladdning syns inte). */
    const anslutning = Object.fromEntries(post.engine.players.map(p => [p.id, post.avbrott?.[p.id] ? CONNECTION.offline : isAlive(p) && rad.status === MATCH_STATUS.active ? CONNECTION.online : lagring.hamtaSession(p.id)?.connection ?? CONNECTION.offline]));
    const view = lagVy(post.engine, playerId, { lastEventId: post.lastEventId, anslutning, matchStatus: rad.status, klockor: post.klockor ?? null, avbrott: post.avbrott ?? null, serverTid: now() });
    if (!view) return null;
    const events = efterEventId === null ? [] : lagring.hamtaHandelser(post.id, efterEventId).filter(e => e.recipient === null || e.recipient === playerId);
    return { view, events, status: rad.status };
  }

  return { fabrik, hantera, tidsgrans, avbrott, ateranslutning, serveravbrott, matchFor };
}
