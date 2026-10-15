/* Serverstyrd duell (arbetsordning L08): dagens duellmotor (match.js, duell-v1) körs på servern för
   matcher med två deltagare. Sessioner mappas till motorns platser A/B via starttransaktionen; en
   spelares kommandon får alltid platsen från medlemskapet, aldrig från klienten. Varje godkänt
   kommando sparar motorläge, händelser och kvittens i samma transaktion (tjanst.js).
   Start- och Fortsätt-bekräftelser är egna kommandon: övergången sker exakt en gång när båda
   levande spelare har bekräftat, och ingen kan använda motorns FORTSÄTT för att hoppa över den andre.

   Spelarklockor (L16, klockor.js): platsen som ska välja (eller bekräfta) har 90 sekunder. Ett kommando på
   eller efter deadline avvisas; när timern går ut förlorar den spelaren matchen (match.js tidsgrans). Går
   båda bekräftelseklockorna ut samtidigt avbryts matchen utan vinnare.

   Avbrott (L17, klockor.js): en frånkopplad spelare får en frist och sin turklocka pausad; den andra kan göra
   sina val tills den frånkopplades val behövs. Slut på fristen ger förlust (`AVBROTT`). Är båda frånkopplade
   väntar avgörandet in den andras frist; går båda ut vinner ingen. */
import { newMatch, process, tidsgrans as tidsgransMotor, serveravbrott as serveravbrottMotor, PHASE, ACTION, STATUS, END } from '../match.js';
import { privatVy, typadeHandelser, EVENT } from '../lokalmatch.js';
import { MATCH_COMMAND, MATCH_STATUS, RECEIPT, ACTIVITY, TEAM_FORMAT, CONNECTION } from '../kontrakt.js';
import { uppdateraKlockor, forSent, registreraAvbrott, avslutaAvbrott, utgangnaMedOrsak, skaVanta, gaUtUnderNaden, klockvy as offentligaKlockor, TIDEN_UTE, ANSLUTNINGSHANDELSE, fristSlut, FOR_SENT_TILLBAKA } from './klockor.js';

export const DUELL_EVENT = Object.freeze({ confirm: 'BEKRÄFTELSE', aborted: 'AVBRUTEN' });
export const SEATS = Object.freeze(['A', 'B']);

export class DuellFel extends Error {}

export function skapaDuell({ lagring, klocka, rum }) {
  const now = () => klocka.now();

  /* ---- Motorfabrik för rummets start (L05): skapar matchen i starttransaktionen ---- */
  function fabrik({ ops, room, players, slump }) {
    const seats = { A: players.find(p => p.teamId === 'A').playerId, B: players.find(p => p.teamId === 'B').playerId };
    const nick = id => players.find(p => p.playerId === id).nick;
    const engine = newMatch({ matchId: `m-${room.id.slice(2)}`, random: slump, names: { A: nick(seats.A), B: nick(seats.B) } });
    const post = { id: engine.id, revision: engine.revision, rulesVersion: engine.rulesVersion, deckVersion: engine.deckVersion, roomId: room.id, seats, engine, lastEventId: 0, confirm: null, createdAt: now() };
    post.klockor = uppdateraKlockor({}, kravDuell(post), now());
    ops.sparaMatch(post, MATCH_STATUS.active);
    return { matchId: post.id, rulesVersion: post.rulesVersion, deckVersion: post.deckVersion };
  }

  const seatOf = (post, playerId) => SEATS.find(seat => post.seats[seat] === playerId) ?? null;
  const alive = (post, seat) => post.engine.players.find(p => p.id === seat).life > 0;
  const aliveSeats = post => SEATS.filter(seat => alive(post, seat));
  const slutstatus = e => e.phase !== PHASE.over ? MATCH_STATUS.active : e.winner ? MATCH_STATUS.finished : MATCH_STATUS.aborted;

  /* Vem servern väntar på: obekräftade levande platser under en bekräftelse, annars den som är på tur. */
  function kravDuell(post) {
    const e = post.engine;
    const krav = {};
    if (post.confirm) { for (const seat of aliveSeats(post)) if (!post.confirm.by[seat]) krav[post.seats[seat]] = `${post.confirm.kind}:${e.revision}`; }
    else if ([PHASE.swap, PHASE.attack, PHASE.defence].includes(e.phase) && e.activePlayer) krav[post.seats[e.activePlayer]] = `${e.phase}:${e.revision}`;
    return krav;
  }
  /* Klockorna för vyn per plats: löpande turklockor och avbrottsfrister (offentliga – alla ser vems tur det är
     och vem som saknas) samt den egna deadline. En pausad klocka visas inte. */
  function klockvy(post, seat) {
    const { clocks, disconnects } = offentligaKlockor(post, id => seatOf(post, id));
    return { clocks, disconnects, deadline: clocks[seat] === undefined ? null : { playerId: seat, at: clocks[seat] }, serverTime: now() };
  }

  /* Privat vy för en spelare: motorns vy för platsen + vem som sitter var + väntande bekräftelse. */
  function vyFor(post, playerId) {
    const seat = seatOf(post, playerId);
    if (!seat) return null;
    const v = privatVy(post.engine, seat, { lastEventId: post.lastEventId });
    const confirm = post.confirm ? { kind: post.confirm.kind, confirmed: SEATS.filter(s => post.confirm.by[s]), waitingFor: aliveSeats(post).filter(s => !post.confirm.by[s]), mine: Boolean(post.confirm.by[seat]) } : null;
    let allowed = v.allowed.filter(a => a.type !== ACTION.next);   // FORTSÄTT går alltid via bekräftelsen
    if (confirm) {
      allowed = allowed.filter(a => a.type === ACTION.surrender);
      if (!confirm.mine && alive(post, seat)) allowed.push({ type: confirm.kind });
    }
    const players = v.players.map(p => ({ ...p, connection: post.avbrott?.[post.seats[p.id]] ? CONNECTION.offline : CONNECTION.online }));
    return { ...v, players, seats: { ...post.seats }, mySeat: seat, confirm, allowed, matchStatus: post.status ?? MATCH_STATUS.active, ...klockvy(post, seat) };
  }

  /* ---- Kommandon ---- */
  function kor(post, action, ops) {
    const before = post.engine;
    const reply = process(before, action, post.slump ?? Math.random);
    if (reply.status === STATUS.rejected) throw new DuellFel(reply.message);
    const events = reply.status === STATUS.ok
      ? typadeHandelser({ before, after: reply.match, replyEvents: reply.events, action, nextEventId: post.lastEventId + 1, at: now() })
      : [{ eventId: post.lastEventId + 1, matchId: post.id, revision: reply.match.revision, type: EVENT.log, at: now(), data: { text: `Internt fel: ${reply.message}` }, recipient: null }];
    post.engine = reply.match;
    post.revision = reply.match.revision;
    post.lastEventId += events.length;
    if (reply.status === STATUS.error) throw new Error(`Motorfel: ${reply.message}`);   // rullar tillbaka allt; ingen falsk vinst
    /* Övergångar som kräver gemensam bekräftelse */
    if (before.phase === PHASE.swap && post.engine.phase === PHASE.attack) post.confirm = { kind: MATCH_COMMAND.confirmStart, by: { A: false, B: false } };
    if (post.engine.phase === PHASE.result) post.confirm = { kind: MATCH_COMMAND.next, by: { A: false, B: false } };
    if (post.engine.phase === PHASE.over) post.confirm = null;
    return events;
  }

  function bekrafta(post, seat, kind) {
    if (!post.confirm || post.confirm.kind !== kind) throw new DuellFel(kind === MATCH_COMMAND.next ? 'Det finns inget resultat att gå vidare från.' : 'Matchen väntar inte på en startbekräftelse.');
    if (!alive(post, seat)) throw new DuellFel('Ett fallet torn behöver inte bekräfta.');
    if (post.confirm.by[seat]) return { events: [], done: false, already: true };
    post.confirm.by[seat] = true;
    const waiting = aliveSeats(post).filter(s => !post.confirm.by[s]);
    const events = [{ eventId: post.lastEventId + 1, matchId: post.id, revision: post.engine.revision, type: DUELL_EVENT.confirm, at: now(), data: { kind, playerId: seat, waitingFor: waiting }, recipient: null }];
    post.lastEventId += 1;
    return { events, done: waiting.length === 0 };
  }

  function hantera({ playerId, command, ops, slump, mottagen = now() }) {
    const rad = ops.hamtaMatch(command.matchId);
    if (!rad) return { status: RECEIPT.rejected, message: 'Matchen finns inte.' };
    const post = rad.match;
    post.slump = slump;
    const session = ops.hamtaSession(playerId);
    const seat = session?.matchId === post.id ? seatOf(post, playerId) : null;
    if (!seat) return { status: RECEIPT.rejected, message: 'Du deltar inte i den här matchen.' };
    const e = post.engine;
    if (e.phase === PHASE.over && e.endReason === END.noWinner) return { status: RECEIPT.rejected, message: 'Ingen av er hann fortsätta i tid – matchen avbröts utan vinnare.', revision: e.revision };
    if (e.phase === PHASE.over && e.endReason === END.timeout && e.winner !== seat) return { status: RECEIPT.rejected, message: TIDEN_UTE, revision: e.revision };   // förlorade på tid strax före kommandot
    if (e.phase === PHASE.over && e.endReason === END.disconnect && e.winner !== seat) return { status: RECEIPT.rejected, message: 'Du kom inte tillbaka i tid och har förlorat matchen.', revision: e.revision };
    if (rad.status !== MATCH_STATUS.active) return { status: RECEIPT.rejected, message: rad.status === MATCH_STATUS.aborted ? 'Matchen avbröts. Gå till lobbyn.' : 'Matchen är avslutad. Gå till lobbyn.', revision: post.revision };
    if (forSent(post.klockor, playerId, mottagen)) return { status: RECEIPT.rejected, message: TIDEN_UTE, revision: post.engine.revision };
    if (fristSlut(post, playerId, mottagen)) return { status: RECEIPT.rejected, message: FOR_SENT_TILLBAKA, revision: post.engine.revision };
    if (command.revision !== post.engine.revision) return { status: RECEIPT.rejected, message: 'Matchläget har ändrats – försök igen.', revision: post.engine.revision };
    try {
      let events = [];
      const { type, payload } = command;
      if (type === MATCH_COMMAND.confirmStart || type === MATCH_COMMAND.next) {
        const r = bekrafta(post, seat, type);
        events = r.events;
        if (r.done) { post.confirm = null; events = events.concat(korEfterBekraftelse(post, type, ops)); }
      } else {
        if (post.confirm && type !== ACTION.surrender) throw new DuellFel(post.confirm.kind === MATCH_COMMAND.next ? 'Bekräfta Fortsätt först.' : 'Bekräfta starten först.');
        events = kor(post, { matchId: post.id, revision: post.engine.revision, type, playerId: seat, card: payload.instanceId, usage: payload.usage, cards: payload.cards }, ops);
      }
      delete post.slump;
      const status = slutstatus(post.engine);
      if (status !== MATCH_STATUS.active) post.avbrott = {};
      post.klockor = uppdateraKlockor(post.klockor, kravDuell(post), now(), post.avbrott ?? {});
      ops.sparaMatch(post, status);
      ops.sparaHandelser(events);
      if (status !== MATCH_STATUS.active) rum.markeraMatchAvslutad(ops, post.roomId);
      return { status: RECEIPT.ok, revision: post.engine.revision, eventId: post.lastEventId };
    } catch (error) {
      if (error instanceof DuellFel) return { status: RECEIPT.rejected, message: error.message, revision: post.engine.revision };
      throw error;
    }
  }

  const aktivPost = (ops, matchId) => {
    const rad = ops.hamtaMatch(matchId);
    return rad && rad.status === MATCH_STATUS.active && rad.match.format !== TEAM_FORMAT ? rad.match : null;
  };
  const levandeIds = post => aliveSeats(post).map(seat => post.seats[seat]);

  /* Timern (klockor.js) i matchens kö: den vars turklocka eller avbrottsfrist gått ut förlorar; båda samtidigt
     ger ingen vinnare. Är den andra frånkopplad med tid kvar väntar avgörandet på hens frist (26B). */
  function tidsgrans({ ops, matchId, now: tid }) {
    const post = aktivPost(ops, matchId);
    if (!post) return false;
    const levande = levandeIds(post);
    const ut = utgangnaMedOrsak(post, levande, tid, { tid: END.timeout, avbrott: END.disconnect });
    if (!Object.keys(ut).length || skaVanta(post, levande, ut)) return false;
    const orsaker = Object.fromEntries(Object.entries(ut).map(([id, orsak]) => [seatOf(post, id), orsak]));
    const before = post.engine;
    const reply = tidsgransMotor(before, Object.keys(orsaker), orsaker);
    if (reply.status === STATUS.rejected) return false;
    if (reply.status !== STATUS.ok) throw new Error(`Motorfel vid tidsgräns: ${reply.message}`);
    const events = typadeHandelser({ before, after: reply.match, replyEvents: reply.events, action: { type: 'TIDSGRÄNS', playerId: null }, nextEventId: post.lastEventId + 1, at: now() });
    Object.assign(post, { engine: reply.match, revision: reply.match.revision, confirm: null, klockor: {}, avbrott: {} });
    post.lastEventId += events.length;
    ops.sparaMatch(post, slutstatus(post.engine));
    ops.sparaHandelser(events);
    rum.markeraMatchAvslutad(ops, post.roomId);
    return true;
  }

  function sparaAnslutning(ops, post, type, data) {
    const event = { eventId: post.lastEventId + 1, matchId: post.id, revision: post.engine.revision, type, at: now(), data, recipient: null };
    post.lastEventId += 1;
    ops.sparaMatch(post, MATCH_STATUS.active);
    ops.sparaHandelser([event]);
  }

  /* Upptäckt avbrott (i matchens kö); gammal generation och samma avbrott ignoreras. */
  function avbrott({ ops, matchId, playerId, generation, now: tid, nad = 0 }) {
    const post = aktivPost(ops, matchId);
    if (!post || !levandeIds(post).includes(playerId)) return false;
    const session = ops.hamtaSession(playerId);
    if (session?.matchId !== post.id || session.connectionGeneration !== generation || session.connection !== CONNECTION.offline) return false;
    if (nad && !gaUtUnderNaden(post, playerId, tid, nad)) return false;   // nåden räcker: avbrottet registreras när den är slut
    const a = registreraAvbrott(post, playerId, generation, tid);
    if (!a) return false;
    sparaAnslutning(ops, post, ANSLUTNINGSHANDELSE.disconnected, { playerId: seatOf(post, playerId), deadline: a.deadline });
    return true;
  }

  /* Återkomst mottagen vid `tid`; för sent ändrar inget (fristkontrollen avgör). */
  function ateranslutning({ ops, matchId, playerId, generation, now: tid }) {
    const post = aktivPost(ops, matchId);
    if (!post || !levandeIds(post).includes(playerId)) return false;
    if (ops.hamtaSession(playerId)?.connectionGeneration !== generation) return false;
    if (avslutaAvbrott(post, playerId, tid) !== 'återansluten') return false;
    sparaAnslutning(ops, post, ANSLUTNINGSHANDELSE.reconnected, { playerId: seatOf(post, playerId) });
    return true;
  }

  /* Serveromstart (L18, 27B): avbruten utan vinnare, ingen förlust för någon. Bara för en match som är PÅGÅR. */
  function serveravbrott({ ops, post }) {
    const text = 'Servern startades om – matchen avbröts utan vinnare.';
    const after = serveravbrottMotor(post.engine, text);
    const at = now();
    const events = [
      { eventId: post.lastEventId + 1, matchId: post.id, revision: after.revision, type: EVENT.matchOver, at, data: { winner: null, endReason: END.serverAbort }, recipient: null },
      { eventId: post.lastEventId + 2, matchId: post.id, revision: after.revision, type: EVENT.log, at, data: { text }, recipient: null }
    ];
    Object.assign(post, { engine: after, revision: after.revision, confirm: null, klockor: {}, avbrott: {}, lastEventId: post.lastEventId + events.length });
    ops.sparaMatch(post, MATCH_STATUS.aborted);
    ops.sparaHandelser(events);
    rum.markeraMatchAvslutad(ops, post.roomId);
  }

  /* Startbekräftelsen avslutas utan motorsteg; Fortsätt-bekräftelsen kör motorns FORTSÄTT en gång. */
  const korEfterBekraftelse = (post, type, ops) => type === MATCH_COMMAND.next ? kor(post, { matchId: post.id, revision: post.engine.revision, type: ACTION.next, playerId: aliveSeats(post)[0] }, ops) : [];

  function registrera(tjanst) {
    rum.registreraMotor(2, fabrik);
    for (const type of Object.values(MATCH_COMMAND)) tjanst.registrera(type, hantera);
  }

  /* Vy och händelser för en spelare (sidladdning, återanslutning och utskick efter kommandon). */
  function matchFor(playerId, { efterEventId = null } = {}) {
    const session = lagring.hamtaSession(playerId);
    if (!session?.matchId) return null;
    const rad = lagring.hamtaMatch(session.matchId);
    if (!rad) return null;
    const post = { ...rad.match, status: rad.status };
    const view = vyFor(post, playerId);
    if (!view) return null;
    const events = efterEventId === null ? [] : lagring.hamtaHandelser(post.id, efterEventId).filter(e => e.recipient === null || e.recipient === view.mySeat);
    return { view, events, status: rad.status };
  }

  return { fabrik, vyFor, matchFor, registrera, hantera, tidsgrans, avbrott, ateranslutning, serveravbrott, seatOf, korEfterBekraftelse };
}
